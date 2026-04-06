use std::path::PathBuf;

use anyhow::Result;

use crate::config::ResolvedConfig;
use crate::format::{pad_visible, truncate_visible};
use crate::parse::{parse_int_safe, split_non_empty_lines, split_window_target};
use crate::tmux::TmuxClient;

const HEADER_BOX_FALLBACK_WIDTH: usize = 60;
const PREVIEW_BOX_FALLBACK_WIDTH: usize = 76;
const PREVIEW_BOX_MIN_WIDTH: usize = 24;
const ACTIVE_ACTIVITY_THRESHOLD_SECONDS: i64 = 60 * 60;

#[derive(Debug, Clone)]
struct RepoInfo {
    name: String,
    root_path: String,
}

#[derive(Debug, Clone)]
struct PreviewPane {
    index: String,
    command: String,
    width: i64,
    height: i64,
    active: bool,
}

pub fn compute_session_capture_lines(
    preview_lines: Option<i64>,
    window_count: usize,
    fallback: i64,
) -> i64 {
    let safe_preview_lines = preview_lines.unwrap_or(0).max(0);
    let static_lines = 11i64;
    let dynamic_lines = 1 + window_count as i64 + 1;
    let margin = static_lines + dynamic_lines;
    if safe_preview_lines > margin + 3 {
        safe_preview_lines - margin
    } else {
        fallback
    }
}

pub fn compute_per_pane_capture_lines(
    preview_lines: Option<i64>,
    pane_count: usize,
    fallback: i64,
) -> i64 {
    let safe_pane_count = pane_count.max(1) as i64;
    let safe_preview_lines = preview_lines.unwrap_or(0).max(0);
    let static_lines = 4 + 1 + safe_pane_count + 1;
    if safe_preview_lines > 0 {
        let available = safe_preview_lines - static_lines;
        if available > 2 * safe_pane_count + 1 {
            let computed = (available / safe_pane_count) - 2;
            return computed.max(fallback).max(3);
        }
    }
    fallback
}

fn read_preview_lines(env: &std::collections::BTreeMap<String, String>) -> Option<i64> {
    env.get("FZF_PREVIEW_LINES")
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
}

fn read_preview_columns(env: &std::collections::BTreeMap<String, String>) -> Option<usize> {
    env.get("FZF_PREVIEW_COLUMNS")
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
}

fn fit_preview_line(
    line: &str,
    env: &std::collections::BTreeMap<String, String>,
    padding: usize,
) -> String {
    let Some(columns) = read_preview_columns(env) else {
        return line.to_string();
    };
    let max = columns.saturating_sub(padding).max(20);
    truncate_visible(line, max)
}

fn resolve_box_width(env: &std::collections::BTreeMap<String, String>, fallback: usize) -> usize {
    match read_preview_columns(env) {
        Some(columns) => columns.saturating_sub(2).max(PREVIEW_BOX_MIN_WIDTH),
        None => fallback,
    }
}

fn render_header_box(title: &str, env: &std::collections::BTreeMap<String, String>) -> Vec<String> {
    let width = resolve_box_width(env, HEADER_BOX_FALLBACK_WIDTH);
    let normalized = pad_visible(
        &format!(" {} ", truncate_visible(title, width.saturating_sub(2))),
        width,
    );
    vec![
        format!("╔{}╗", "═".repeat(width)),
        format!("║{}║", normalized),
        format!("╚{}╝", "═".repeat(width)),
    ]
}

fn render_info_block(rows: &[(String, String)], title: &str) -> Vec<String> {
    let mut lines = vec![format!("┌─ {title}")];
    if rows.is_empty() {
        lines.push("└─ (none)".to_string());
        return lines;
    }
    for (index, row) in rows.iter().enumerate() {
        let branch = if index + 1 == rows.len() {
            "└─"
        } else {
            "├─"
        };
        lines.push(format!("{branch} {:<14} {}", row.0, row.1));
    }
    lines
}

fn render_pane_preview_block(
    title: &str,
    pane_lines: &[String],
    empty_label: &str,
    env: &std::collections::BTreeMap<String, String>,
) -> Vec<String> {
    let inner_width = resolve_box_width(env, PREVIEW_BOX_FALLBACK_WIDTH);
    let normalized_title = pad_visible(
        &format!(
            " {} ",
            truncate_visible(title, inner_width.saturating_sub(2))
        ),
        inner_width,
    );
    let body = if pane_lines.is_empty() {
        vec![empty_label.to_string()]
    } else {
        pane_lines.to_vec()
    };
    let mut lines = Vec::new();
    lines.push(format!("┌{}┐", "─".repeat(inner_width)));
    lines.push(format!("│{}│", normalized_title));
    lines.push(format!("├{}┤", "─".repeat(inner_width)));
    for line in body {
        let content = pad_visible(&truncate_visible(&line, inner_width), inner_width);
        lines.push(format!("│{}│", content));
    }
    lines.push(format!("└{}┘", "─".repeat(inner_width)));
    lines
}

fn format_ago_from_epoch(epoch_seconds: i64) -> String {
    if epoch_seconds <= 0 {
        return "unknown".to_string();
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(epoch_seconds);
    let delta = (now - epoch_seconds).max(0);
    if delta < 60 {
        format!("{delta}s ago")
    } else if delta < 3600 {
        format!("{}m ago", delta / 60)
    } else if delta < 86_400 {
        format!("{}h ago", delta / 3600)
    } else {
        format!("{}d ago", delta / 86_400)
    }
}

fn activity_badge(last_activity: i64) -> &'static str {
    if last_activity <= 0 {
        return "·";
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(last_activity);
    if (now - last_activity).max(0) <= ACTIVE_ACTIVITY_THRESHOLD_SECONDS {
        "*"
    } else {
        "·"
    }
}

fn shorten_path(path: &str, env: &std::collections::BTreeMap<String, String>) -> String {
    let Some(home) = env.get("HOME") else {
        return path.to_string();
    };
    if path == home {
        "~".to_string()
    } else if let Some(rest) = path.strip_prefix(&format!("{home}/")) {
        format!("~/{rest}")
    } else {
        path.to_string()
    }
}

fn find_git_root(start_path: &str) -> Option<PathBuf> {
    if start_path.is_empty() {
        return None;
    }
    let mut cursor = PathBuf::from(start_path);
    loop {
        if cursor.join(".git").exists() {
            return Some(cursor);
        }
        let parent = cursor.parent()?.to_path_buf();
        if parent == cursor {
            return None;
        }
        cursor = parent;
    }
}

fn collect_repo_info(path: &str) -> Option<RepoInfo> {
    let root_path = find_git_root(path)?;
    let name = root_path.file_name()?.to_string_lossy().into_owned();
    Some(RepoInfo {
        name,
        root_path: root_path.display().to_string(),
    })
}

fn get_pane_icon(command: &str) -> &'static str {
    match command {
        "nvim" | "vim" | "vi" => "",
        "zsh" | "bash" | "fish" | "sh" => "",
        "node" | "bun" | "deno" => "",
        "git" => "",
        "cargo" | "rustc" => "",
        _ => "•",
    }
}

fn parse_preview_panes(output: &str) -> Vec<PreviewPane> {
    split_non_empty_lines(output)
        .into_iter()
        .filter_map(|line| {
            let parts = line.split('\t').collect::<Vec<_>>();
            let index = parts.first()?.trim().to_string();
            Some(PreviewPane {
                index,
                command: parts.get(1).copied().unwrap_or("").trim().to_string(),
                width: parse_int_safe(parts.get(2).copied(), 0),
                height: parse_int_safe(parts.get(3).copied(), 0),
                active: parts.get(4).copied().unwrap_or("") == "1",
            })
        })
        .collect()
}

fn collect_pane_current_path(tmux: &TmuxClient, target: &str) -> Result<String> {
    tmux.pane_current_path(target)
}

fn render_session_preview(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    session_name: &str,
    env: &std::collections::BTreeMap<String, String>,
) -> Result<String> {
    let sessions = tmux.list_session_details()?;
    let windows = tmux.list_windows(session_name)?;
    let Some(session) = sessions.iter().find(|session| session.name == session_name) else {
        return Ok(format!("Session not found: {session_name}"));
    };
    let active_window = windows
        .iter()
        .find(|window| window.active)
        .or_else(|| windows.first());
    let active_pane_target = active_window
        .map(|window| format!("{session_name}:{}.0", window.index))
        .unwrap_or_default();
    let active_pane_path = if active_pane_target.is_empty() {
        String::new()
    } else {
        collect_pane_current_path(tmux, &active_pane_target)?
    };
    let repo_info = collect_repo_info(&active_pane_path);
    let capture_lines = compute_session_capture_lines(
        read_preview_lines(env),
        windows.len(),
        config.session_manager.preview.session_capture_lines,
    );
    let pane_tail = if active_pane_target.is_empty() {
        Vec::new()
    } else {
        tmux.capture_pane_tail(&active_pane_target, capture_lines)?
    };

    let mut lines = Vec::new();
    lines.extend(render_header_box(&format!("Session {session_name}"), env));
    lines.push(String::new());
    lines.extend(render_info_block(
        &[
            (
                "Status".to_string(),
                if session.attached_clients > 0 {
                    format!("attached ({})", session.attached_clients)
                } else {
                    "detached".to_string()
                },
            ),
            ("Windows".to_string(), windows.len().to_string()),
            (
                "Last Activity".to_string(),
                format!(
                    "{} {}",
                    activity_badge(session.last_activity),
                    format_ago_from_epoch(session.last_activity)
                ),
            ),
            (
                "Repo".to_string(),
                repo_info
                    .as_ref()
                    .map(|repo| {
                        format!(
                            "{} ({})",
                            repo.name,
                            truncate_visible(&shorten_path(&repo.root_path, env), 44)
                        )
                    })
                    .unwrap_or_else(|| "(not git repo)".to_string()),
            ),
            (
                "Path".to_string(),
                if active_pane_path.is_empty() {
                    "(unknown)".to_string()
                } else {
                    truncate_visible(&shorten_path(&active_pane_path, env), 52)
                },
            ),
        ],
        "Session Info",
    ));
    lines.push(String::new());
    lines.push("┌─ Windows".to_string());
    if windows.is_empty() {
        lines.push("└─ (no windows)".to_string());
    } else {
        for (index, window) in windows.iter().enumerate() {
            let branch = if index + 1 == windows.len() {
                "└─"
            } else {
                "├─"
            };
            let marker = if window.active { "▸" } else { "·" };
            let command_label = if window.command.is_empty() {
                String::new()
            } else {
                format!(" cmd:{}", truncate_visible(&window.command, 28))
            };
            lines.push(format!(
                "{branch} {marker} {} {} [{}P]{}",
                window.index,
                truncate_visible(&window.name, 26),
                window.panes,
                command_label
            ));
        }
    }
    lines.push(String::new());
    let preview_title = active_window
        .map(|window| {
            format!(
                "Active Pane {session_name}:{}.0 (last {capture_lines} lines)",
                window.index
            )
        })
        .unwrap_or_else(|| format!("Active Pane (last {capture_lines} lines)"));
    lines.extend(render_pane_preview_block(
        &preview_title,
        &pane_tail
            .into_iter()
            .map(|line| fit_preview_line(&line, env, 3))
            .collect::<Vec<_>>(),
        if active_window.is_some() {
            "(preview not available)"
        } else {
            "(active window not found)"
        },
        env,
    ));
    Ok(lines.join("\n"))
}

fn render_window_preview(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    target: &str,
    env: &std::collections::BTreeMap<String, String>,
) -> Result<String> {
    let Some((session_name, window_index)) = split_window_target(target) else {
        return Ok(format!("Invalid window target: {target}"));
    };
    let windows = tmux.list_windows(&session_name)?;
    let Some(window) = windows.iter().find(|window| window.index == window_index) else {
        return Ok(format!("Window not found: {target}"));
    };
    let pane_list = tmux.run(
        &[
            "list-panes",
            "-t",
            &format!("{session_name}:{window_index}"),
            "-F",
            "#{pane_index}\t#{pane_current_command}\t#{pane_width}\t#{pane_height}\t#{pane_active}",
        ],
        true,
    )?;
    let panes = parse_preview_panes(&pane_list.stdout);
    let per_pane_lines = compute_per_pane_capture_lines(
        read_preview_lines(env),
        panes.len(),
        config.session_manager.preview.pane_capture_lines,
    );
    let active_pane = panes
        .iter()
        .find(|pane| pane.active)
        .or_else(|| panes.first());
    let active_pane_target = active_pane
        .map(|pane| format!("{session_name}:{window_index}.{}", pane.index))
        .unwrap_or_default();
    let active_pane_path = if active_pane_target.is_empty() {
        String::new()
    } else {
        collect_pane_current_path(tmux, &active_pane_target)?
    };
    let repo_info = collect_repo_info(&active_pane_path);

    let mut lines = Vec::new();
    lines.extend(render_header_box(&format!("Window {target}"), env));
    lines.push(String::new());
    lines.extend(render_info_block(
        &[
            ("Name".to_string(), truncate_visible(&window.name, 40)),
            ("Panes".to_string(), window.panes.to_string()),
            (
                "Command".to_string(),
                if window.command.is_empty() {
                    "(unknown)".to_string()
                } else {
                    window.command.clone()
                },
            ),
            (
                "Repo".to_string(),
                repo_info
                    .as_ref()
                    .map(|repo| {
                        format!(
                            "{} ({})",
                            repo.name,
                            truncate_visible(&shorten_path(&repo.root_path, env), 44)
                        )
                    })
                    .unwrap_or_else(|| "(not git repo)".to_string()),
            ),
            (
                "Path".to_string(),
                if active_pane_path.is_empty() {
                    "(unknown)".to_string()
                } else {
                    truncate_visible(&shorten_path(&active_pane_path, env), 52)
                },
            ),
        ],
        "Window Info",
    ));
    lines.push(String::new());
    lines.push("┌─ Pane List".to_string());
    if panes.is_empty() {
        lines.push("└─ (no panes)".to_string());
        return Ok(lines.join("\n"));
    }
    for (index, pane) in panes.iter().enumerate() {
        let branch = if index + 1 == panes.len() {
            "└─"
        } else {
            "├─"
        };
        let marker = if pane.active { "▸" } else { "·" };
        lines.push(format!(
            "{branch} {marker} {}: {} {} ({}x{})",
            pane.index,
            get_pane_icon(&pane.command),
            truncate_visible(
                if pane.command.is_empty() {
                    "(unknown)"
                } else {
                    &pane.command
                },
                20
            ),
            pane.width,
            pane.height
        ));
    }
    lines.push(String::new());
    lines.push(format!(
        "┌─ Pane Preview (last {per_pane_lines} lines each)"
    ));
    let pane_tails = panes
        .iter()
        .map(|pane| {
            tmux.capture_pane_tail(
                &format!("{session_name}:{window_index}.{}", pane.index),
                per_pane_lines,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    for (index, pane) in panes.iter().enumerate() {
        lines.extend(render_pane_preview_block(
            &format!(
                "{} Pane {} ({})",
                if pane.active { "▸" } else { "·" },
                pane.index,
                truncate_visible(
                    if pane.command.is_empty() {
                        "unknown"
                    } else {
                        &pane.command
                    },
                    24
                )
            ),
            &pane_tails[index]
                .iter()
                .map(|line| fit_preview_line(line, env, 3))
                .collect::<Vec<_>>(),
            "(preview not available)",
            env,
        ));
        if index + 1 != panes.len() {
            lines.push(String::new());
        }
    }
    Ok(lines.join("\n"))
}

fn render_server_preview(env: &std::collections::BTreeMap<String, String>) -> String {
    let mut lines = render_header_box("tmux server", env);
    lines.push(String::new());
    lines.push("Selecting this row with Ctrl-Q runs:".to_string());
    lines.push("tmux kill-server".to_string());
    lines.push(String::new());
    lines.push("All sessions are terminated.".to_string());
    lines.join("\n")
}

pub fn render_preview_once(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    action: &str,
    name: &str,
    env: &std::collections::BTreeMap<String, String>,
) -> Result<String> {
    match action {
        "session" => render_session_preview(tmux, config, name, env),
        "window" => render_window_preview(tmux, config, name, env),
        "server" => Ok(render_server_preview(env)),
        _ => Ok("Preview not available".to_string()),
    }
}
