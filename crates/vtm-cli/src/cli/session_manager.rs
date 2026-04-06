use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result, anyhow};
use vtm_core::command::{CommandOptions, command_exists, run_command};
use vtm_core::config::ResolvedConfig;
use vtm_core::format::{pad_visible, strip_ansi, truncate_visible, visible_width};
use vtm_core::matcher::sort_categories;
use vtm_core::parse::{
    SessionDetails, WindowInfo, parse_int_safe, split_non_empty_lines, split_window_target,
};
use vtm_core::preview::render_preview_once;
use vtm_core::runtime::resolve_ghq_root;
use vtm_core::state::{
    get_current_category, resolve_effective_session_category, switch_client_and_remember_session,
};

use crate::app_context::{AppContext, is_in_tmux};
use crate::cli::session_ops::{
    kill_pane_clean, kill_server_clean, kill_session_clean, kill_window_clean,
    resolve_session_name_from_selection,
};
use crate::cli::{CliResponse, EXIT_OK, EXIT_USAGE};

const FZF_DEFAULT_PREVIEW_WIDTH: &str = "65";
const ACTIVE_ACTIVITY_THRESHOLD_SECONDS: i64 = 60 * 60;

#[derive(Debug, Clone)]
struct SessionWithWindows {
    session: SessionDetails,
    windows: Vec<WindowInfo>,
    total_windows: usize,
    total_panes: i32,
    is_current: bool,
}

#[derive(Debug, Clone)]
struct SelectorEntry {
    action: String,
    name: String,
    display: String,
}

#[derive(Debug, Clone)]
struct SelectorRow {
    action: String,
    name: String,
    columns: Vec<String>,
}

fn ansi(code: &str, text: impl AsRef<str>) -> String {
    format!("\u{1b}[{code}m{}\u{1b}[0m", text.as_ref())
}

fn bold(text: impl AsRef<str>) -> String {
    ansi("1", text)
}

fn red(text: impl AsRef<str>) -> String {
    ansi("31", text)
}

fn green(text: impl AsRef<str>) -> String {
    ansi("32", text)
}

fn yellow(text: impl AsRef<str>) -> String {
    ansi("33", text)
}

fn magenta(text: impl AsRef<str>) -> String {
    ansi("35", text)
}

fn cyan(text: impl AsRef<str>) -> String {
    ansi("36", text)
}

fn gray(text: impl AsRef<str>) -> String {
    ansi("90", text)
}

fn parse_all_windows_by_session(output: &str) -> BTreeMap<String, Vec<WindowInfo>> {
    let mut grouped = BTreeMap::new();
    for line in split_non_empty_lines(output) {
        let parts = line.split('\t').collect::<Vec<_>>();
        let session_name = parts.first().copied().unwrap_or("").trim().to_string();
        let index = parts.get(1).copied().unwrap_or("").trim().to_string();
        if session_name.is_empty() || index.is_empty() {
            continue;
        }
        grouped
            .entry(session_name)
            .or_insert_with(Vec::new)
            .push(WindowInfo {
                index,
                panes: parse_int_safe(parts.get(2).copied(), 0) as i32,
                active: parts.get(3).copied().unwrap_or("") == "1",
                name: {
                    let value = parts.get(4).copied().unwrap_or("").trim();
                    if value.is_empty() {
                        "(unnamed)".to_string()
                    } else {
                        value.to_string()
                    }
                },
                command: parts.get(5).copied().unwrap_or("").trim().to_string(),
            });
    }
    grouped
}

fn build_selector_rows(
    sessions: &[SessionWithWindows],
    current_category: &str,
    category_order: &BTreeMap<String, i64>,
) -> Vec<SelectorRow> {
    let mut sorted = sessions.to_vec();
    let category_ranks = sort_categories(
        &sessions
            .iter()
            .map(|session| session.session.category.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>(),
        category_order,
    )
    .into_iter()
    .enumerate()
    .map(|(index, category)| (category, index))
    .collect::<BTreeMap<_, _>>();
    sorted.sort_by(|left, right| {
        let left_rank = category_ranks
            .get(&left.session.category)
            .copied()
            .unwrap_or(usize::MAX);
        let right_rank = category_ranks
            .get(&right.session.category)
            .copied()
            .unwrap_or(usize::MAX);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.session.name.cmp(&right.session.name))
    });

    let mut rows = Vec::new();
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0);
    for session in sorted {
        let delta = (now - session.session.last_activity).max(0);
        let activity = if delta <= ACTIVE_ACTIVITY_THRESHOLD_SECONDS {
            yellow("*")
        } else {
            gray("·")
        };
        let state_symbol = if session.is_current {
            green("●")
        } else if session.session.attached_clients > 0 {
            yellow("○")
        } else {
            gray("·")
        };
        let attached_state = if session.session.attached_clients > 0 {
            yellow(format!("attached:{}", session.session.attached_clients))
        } else {
            gray("detached")
        };
        let category_label = if session.session.category == current_category {
            green(format!("[{}]", session.session.category))
        } else {
            cyan(format!("[{}]", session.session.category))
        };

        rows.push(SelectorRow {
            action: "session".to_string(),
            name: session.session.name.clone(),
            columns: vec![
                format!("{state_symbol} {activity} {}", bold(&session.session.name)),
                category_label.clone(),
                format!(
                    "{} {}",
                    gray("win"),
                    cyan(session.total_windows.to_string())
                ),
                format!("{} {}", gray("pane"), cyan(session.total_panes.to_string())),
                attached_state,
            ],
        });
        for (index, window) in session.windows.iter().enumerate() {
            let branch = if index + 1 == session.windows.len() {
                "└─"
            } else {
                "├─"
            };
            let marker = if window.active {
                green("▸")
            } else {
                gray("·")
            };
            let command = if window.command.is_empty() {
                gray("-")
            } else {
                magenta(truncate_visible(&window.command, 28))
            };
            rows.push(SelectorRow {
                action: "window".to_string(),
                name: format!("{}:{}", session.session.name, window.index),
                columns: vec![
                    format!(
                        "  {branch} {marker} {}:{} {}",
                        bold(&session.session.name),
                        cyan(&window.index),
                        truncate_visible(&window.name, 24),
                    ),
                    category_label.clone(),
                    format!("{} {}", gray("pane"), cyan(window.panes.to_string())),
                    format!("{} {command}", gray("cmd")),
                    String::new(),
                ],
            });
        }
    }
    if sessions.len() > 1 {
        rows.push(SelectorRow {
            action: "server".to_string(),
            name: String::new(),
            columns: vec![
                format!("  {} {}", red("✕"), bold("tmux server")),
                cyan("tmux kill-server"),
                String::new(),
                String::new(),
            ],
        });
    }
    rows
}

fn is_blank_column(value: Option<&str>) -> bool {
    value.is_none_or(|value| strip_ansi(value).trim().is_empty())
}

fn last_used_column_index(columns: &[String]) -> usize {
    for index in (0..columns.len()).rev() {
        if !is_blank_column(columns.get(index).map(String::as_str)) {
            return index;
        }
    }
    0
}

fn compute_column_widths(rows: &[SelectorRow]) -> Vec<usize> {
    let max_columns = rows.iter().map(|row| row.columns.len()).max().unwrap_or(0);
    let mut widths = vec![0usize; max_columns];

    for row in rows {
        let limit = last_used_column_index(&row.columns);
        for index in 0..limit {
            let column = row.columns.get(index).map(String::as_str).unwrap_or("");
            widths[index] = widths[index].max(visible_width(column));
        }
    }

    widths
}

fn render_selector_rows(rows: &[SelectorRow]) -> Vec<SelectorEntry> {
    let widths = compute_column_widths(rows);
    rows.iter()
        .map(|row| {
            let limit = last_used_column_index(&row.columns);
            let mut segments = Vec::new();
            for index in 0..=limit {
                let column = row.columns.get(index).cloned().unwrap_or_default();
                if index < limit {
                    segments.push(pad_visible(&column, *widths.get(index).unwrap_or(&0)));
                } else {
                    segments.push(column);
                }
            }
            SelectorEntry {
                action: row.action.clone(),
                name: row.name.clone(),
                display: segments.join(&format!(" {} ", gray("|"))),
            }
        })
        .collect()
}

fn build_selector_entries(
    sessions: &[SessionWithWindows],
    current_category: &str,
    category_order: &BTreeMap<String, i64>,
) -> Vec<SelectorEntry> {
    render_selector_rows(&build_selector_rows(
        sessions,
        current_category,
        category_order,
    ))
}

fn normalize_refresh_ms(value: Option<&str>) -> i64 {
    value
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0)
}

fn build_preview_window_option(width_value: &str) -> String {
    let normalized = width_value.trim();
    if normalized.chars().all(|char| char.is_ascii_digit()) {
        return format!("right:{normalized}%:border-left");
    }
    if normalized.ends_with('%')
        && normalized[..normalized.len() - 1]
            .chars()
            .all(|char| char.is_ascii_digit())
    {
        return format!("right:{normalized}:border-left");
    }
    format!("right:{}%:border-left", FZF_DEFAULT_PREVIEW_WIDTH)
}

fn run_fzf(
    entries: &[SelectorEntry],
    prompt: &str,
    header_text: &str,
    border: &str,
    preview_width: &str,
    preview_command: &str,
    popup_width: &str,
    popup_height: &str,
    force_plain: bool,
    in_tmux: bool,
    env: &BTreeMap<String, String>,
) -> Result<Vec<String>> {
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let use_fzf_tmux = !force_plain && in_tmux && command_exists("fzf-tmux", env)?;
    let binary = if use_fzf_tmux { "fzf-tmux" } else { "fzf" };
    let border_option = if in_tmux {
        "--border=none".to_string()
    } else {
        match border.trim().to_lowercase().as_str() {
            "" | "none" | "0" | "false" | "off" => "--border=none".to_string(),
            _ => format!("--border={}", border.trim()),
        }
    };
    let mut args = vec![
        "--ansi".to_string(),
        format!("--prompt={prompt}"),
        format!("--header={header_text}"),
        border_option,
        "--delimiter=\t".to_string(),
        "--with-nth=3".to_string(),
        "--cycle".to_string(),
        "--reverse".to_string(),
        "--height=100%".to_string(),
        "--no-info".to_string(),
        "--no-sort".to_string(),
        "--exact".to_string(),
        "--expect=enter,ctrl-q,ctrl-t,ctrl-r".to_string(),
        "--multi".to_string(),
        format!("--preview={preview_command}"),
        format!(
            "--preview-window={}",
            build_preview_window_option(preview_width)
        ),
        "--bind=ctrl-d:preview-page-down".to_string(),
        "--bind=ctrl-u:preview-page-up".to_string(),
    ];
    if use_fzf_tmux {
        args.splice(
            0..0,
            [String::from("-p"), format!("{popup_width},{popup_height}")],
        );
    }
    let payload = format!(
        "{}\n",
        entries
            .iter()
            .map(|entry| format!("{}\t{}\t{}", entry.action, entry.name, entry.display))
            .collect::<Vec<_>>()
            .join("\n")
    );
    let options = CommandOptions {
        allow_fail: true,
        env: env.clone(),
        input: Some(payload),
        ..CommandOptions::default()
    };
    let result = run_command(binary, args, &options)?;
    if result.exit_code != 0 {
        return Ok(Vec::new());
    }
    let stdout = result.stdout.trim();
    if stdout.is_empty() {
        return Ok(Vec::new());
    }
    Ok(stdout.lines().map(ToOwned::to_owned).collect())
}

fn parse_selection_lines(lines: &[String]) -> (String, Vec<String>) {
    if lines.is_empty() {
        return ("enter".to_string(), Vec::new());
    }
    let first = lines[0].trim();
    if matches!(first, "enter" | "ctrl-q" | "ctrl-t" | "ctrl-r") {
        (first.to_string(), lines[1..].to_vec())
    } else {
        ("enter".to_string(), lines.to_vec())
    }
}

fn parse_entry_line(line: &str) -> Option<(String, String)> {
    let parts = line.split('\t').collect::<Vec<_>>();
    let action = parts.first()?.to_string();
    if !matches!(action.as_str(), "session" | "window" | "server") {
        return None;
    }
    Some((
        action,
        parts.get(1).copied().unwrap_or("").trim().to_string(),
    ))
}

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn open_popup_if_needed(
    tmux: &vtm_core::tmux::TmuxClient,
    config: &ResolvedConfig,
    popup: bool,
    env: &BTreeMap<String, String>,
) -> Result<bool> {
    if popup || !config.session_manager.popup.enabled || !is_in_tmux(env) {
        return Ok(false);
    }
    let pane_path = tmux
        .run(&["display-message", "-p", "#{pane_current_path}"], true)?
        .stdout
        .trim()
        .to_string();
    let pane_path = if pane_path.is_empty() {
        env.get("HOME")
            .cloned()
            .unwrap_or_else(|| String::from("."))
    } else {
        pane_path
    };
    let executable = std::env::current_exe().context("failed to resolve current executable")?;
    tmux.run(
        &[
            "display-popup",
            "-E",
            "-w",
            &config.session_manager.popup.width,
            "-h",
            &config.session_manager.popup.height,
            "-d",
            &pane_path,
            executable.to_string_lossy().as_ref(),
            "session-manager",
            "--popup",
        ],
        false,
    )?;
    Ok(true)
}

fn collect_sessions_for_selector(
    ctx: &AppContext,
    tmux: &vtm_core::tmux::TmuxClient,
    config: &ResolvedConfig,
) -> Result<Vec<SessionWithWindows>> {
    let ghq_root = resolve_ghq_root(Some(config), &ctx.env)?;
    let in_tmux = is_in_tmux(&ctx.env);
    let sessions = ctx.list_session_details(tmux)?;
    let current_session = if in_tmux {
        tmux.current_session()?
    } else {
        String::new()
    };
    let windows_output = tmux.run(
        &[
            "list-windows",
            "-a",
            "-F",
            "#{session_name}\t#{window_index}\t#{window_panes}\t#{window_active}\t#{window_name}\t#{pane_current_command}",
        ],
        true,
    )?;
    let windows_by_session = parse_all_windows_by_session(&windows_output.stdout);
    let mut result = Vec::new();
    for session in sessions {
        let mut session = session;
        session.category = resolve_effective_session_category(
            &session,
            config,
            &ctx.home_dir()?,
            ghq_root.as_deref(),
        );
        let windows = windows_by_session
            .get(&session.name)
            .cloned()
            .unwrap_or_default();
        let total_panes = windows.iter().map(|window| window.panes).sum::<i32>();
        result.push(SessionWithWindows {
            is_current: in_tmux && session.name == current_session,
            total_windows: windows.len(),
            total_panes,
            session,
            windows,
        });
    }
    Ok(result)
}

fn run_selection(
    ctx: &AppContext,
    tmux: &vtm_core::tmux::TmuxClient,
    config: &ResolvedConfig,
    popup: bool,
    lines: &[String],
) -> Result<()> {
    let (key, selections) = parse_selection_lines(lines);
    if key == "ctrl-t" {
        if is_in_tmux(&ctx.env) {
            let created = tmux.new_session_detached()?;
            if !created.is_empty() {
                tmux.switch_client(&created)?;
            } else {
                tmux.new_session_interactive(true)?;
            }
            return Ok(());
        }
        tmux.new_session_interactive(true)?;
        return Ok(());
    }

    if key == "ctrl-q" {
        let mut targets = BTreeSet::new();
        for selection in &selections {
            if let Some((action, name)) = parse_entry_line(selection) {
                let session_name = resolve_session_name_from_selection(&action, &name);
                if !session_name.is_empty() {
                    targets.insert(session_name);
                }
            }
        }
        if is_in_tmux(&ctx.env) && !targets.is_empty() {
            let sessions = tmux.list_sessions()?;
            let current = tmux.current_session()?;
            if targets.contains(&current) {
                if let Some(fallback) = sessions
                    .iter()
                    .find(|session| !targets.contains(&session.name))
                {
                    tmux.switch_client(&fallback.name)?;
                }
            }
        }
        for selection in &selections {
            if let Some((action, name)) = parse_entry_line(selection) {
                match action.as_str() {
                    "session" => kill_session_clean(tmux, config, &name, &ctx.env)?,
                    "window" => kill_window_clean(tmux, config, &name, &ctx.env)?,
                    "server" => kill_server_clean(tmux, config, &ctx.env)?,
                    _ => {}
                }
            }
        }
        return Ok(());
    }

    if key == "ctrl-r" {
        let Some(first) = selections.first() else {
            return Ok(());
        };
        let Some((action, name)) = parse_entry_line(first) else {
            return Ok(());
        };
        let session_name = resolve_session_name_from_selection(&action, &name);
        if session_name.is_empty() {
            return Ok(());
        }
        if !is_in_tmux(&ctx.env) {
            return Err(anyhow!(
                "[SESSION_RENAME_UNAVAILABLE] session rename requires tmux client context"
            ));
        }
        let escaped = session_name.replace('\'', "''");
        tmux.run(
            &[
                "command-prompt",
                "-I",
                &session_name,
                &format!("rename-session -t '{escaped}' '%%'"),
            ],
            true,
        )?;
        return Ok(());
    }

    let Some(first) = selections.first() else {
        return Ok(());
    };
    let Some((action, name)) = parse_entry_line(first) else {
        return Ok(());
    };
    let load = ctx.load_config()?;
    let ghq_root = resolve_ghq_root(Some(&load.config), &ctx.env)?;
    let sessions = ctx.list_session_details(tmux)?;
    match action.as_str() {
        "session" => {
            if is_in_tmux(&ctx.env) {
                switch_client_and_remember_session(
                    tmux,
                    &load.config,
                    &name,
                    None,
                    &ctx.home_dir()?,
                    ghq_root.as_deref(),
                    None,
                    &sessions,
                    false,
                )?;
            } else {
                tmux.attach_session(&name, true)?;
            }
        }
        "window" => {
            let session_name = split_window_target(&name)
                .map(|(session_name, _)| session_name)
                .unwrap_or(name.clone());
            if is_in_tmux(&ctx.env) {
                switch_client_and_remember_session(
                    tmux,
                    &load.config,
                    &session_name,
                    None,
                    &ctx.home_dir()?,
                    ghq_root.as_deref(),
                    None,
                    &sessions,
                    false,
                )?;
                tmux.select_window(&name)?;
            } else {
                tmux.select_window(&name)?;
                tmux.attach_session(&session_name, true)?;
            }
        }
        _ => {}
    }
    if popup {
        return Ok(());
    }
    Ok(())
}

pub fn run_session_manager(args: &[String], ctx: &AppContext) -> Result<CliResponse> {
    let usage = "Usage: vtm session-manager [--popup]\n       vtm session-manager kill-window <target>\n       vtm session-manager kill-pane <target>";
    if matches!(args.first().map(String::as_str), Some("-h" | "--help")) {
        return Ok(CliResponse {
            exit_code: EXIT_OK,
            stdout: format!(
                "{usage}\n\nInteractive controls:\n  Enter   switch/attach\n  Ctrl-T  create session\n  Ctrl-Q  clean kill target\n  Ctrl-R  rename session\n"
            ),
            stderr: String::new(),
        });
    }
    let mut popup = false;
    let mut render_preview = None::<String>;
    let mut preview_name = None::<String>;
    let mut positional = Vec::new();
    let mut index = 0usize;
    while index < args.len() {
        match args[index].as_str() {
            "--popup" => {
                popup = true;
                index += 1;
            }
            "--render-preview" => {
                let Some(value) = args.get(index + 1) else {
                    return Ok(CliResponse {
                        exit_code: EXIT_USAGE,
                        stdout: String::new(),
                        stderr: "[USAGE] --render-preview requires a value".to_string(),
                    });
                };
                render_preview = Some(value.clone());
                index += 2;
            }
            "--preview-name" => {
                let Some(value) = args.get(index + 1) else {
                    return Ok(CliResponse {
                        exit_code: EXIT_USAGE,
                        stdout: String::new(),
                        stderr: "[USAGE] --preview-name requires a value".to_string(),
                    });
                };
                preview_name = Some(value.clone());
                index += 2;
            }
            value => {
                positional.push(value.to_string());
                index += 1;
            }
        }
    }

    let tmux = ctx.tmux();
    let load = ctx.load_config()?;
    let config = load.config;

    if let (Some(action), Some(name)) = (render_preview.as_deref(), preview_name.as_deref()) {
        let refresh_ms =
            normalize_refresh_ms(ctx.env.get("PREVIEW_REFRESH_MS").map(String::as_str));
        if refresh_ms <= 0 {
            let preview = render_preview_once(&tmux, &config, action, name, &ctx.env)?;
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: format!("{preview}\n"),
                stderr: String::new(),
            });
        }
        loop {
            let preview = render_preview_once(&tmux, &config, action, name, &ctx.env)?;
            print!("\u{1b}[H\u{1b}[2J{preview}\n");
            let _ = std::io::stdout().flush();
            std::thread::sleep(Duration::from_millis(refresh_ms as u64));
        }
    }

    if let Some(name) = positional.first() {
        if name == "kill-window" || name == "kill-pane" {
            let Some(target) = positional.get(1) else {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: format!("Usage: vtm session-manager {name} <target>"),
                });
            };
            if name == "kill-window" {
                kill_window_clean(&tmux, &config, target, &ctx.env)?;
            } else {
                kill_pane_clean(&tmux, &config, target, &ctx.env)?;
            }
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            });
        }
        return Ok(CliResponse {
            exit_code: EXIT_USAGE,
            stdout: String::new(),
            stderr: format!("[USAGE] {usage}"),
        });
    }

    if open_popup_if_needed(&tmux, &config, popup, &ctx.env)? {
        return Ok(CliResponse {
            exit_code: EXIT_OK,
            stdout: String::new(),
            stderr: String::new(),
        });
    }

    let in_tmux = is_in_tmux(&ctx.env);
    let current_category = get_current_category(&tmux, &config)?;
    let sessions = collect_sessions_for_selector(ctx, &tmux, &config)?;
    if !in_tmux && sessions.is_empty() {
        tmux.new_session_interactive(true)?;
        return Ok(CliResponse {
            exit_code: EXIT_OK,
            stdout: String::new(),
            stderr: String::new(),
        });
    }
    let entries = build_selector_entries(&sessions, &current_category, &config.categories.order);
    let executable = std::env::current_exe().context("failed to resolve current executable")?;
    let preview_command = format!(
        "FORCE_COLOR=1 PREVIEW_REFRESH_MS={} {} session-manager --popup --render-preview {{1}} --preview-name {{2}}",
        config.session_manager.fzf.preview_refresh_ms,
        shell_escape(executable.to_string_lossy().as_ref())
    );
    let header_text = format!(
        "Current [{current_category}] | Enter switch | C-q kill | C-t new | C-r rename | C-d/C-u scroll"
    );
    let lines = run_fzf(
        &entries,
        &config.session_manager.fzf.prompt,
        &header_text,
        &config.session_manager.fzf.border,
        &config.session_manager.fzf.preview_width,
        &preview_command,
        &config.session_manager.popup.width,
        &config.session_manager.popup.height,
        popup,
        in_tmux,
        &ctx.env,
    )?;
    run_selection(ctx, &tmux, &config, popup, &lines)?;
    Ok(CliResponse {
        exit_code: EXIT_OK,
        stdout: String::new(),
        stderr: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use vtm_core::format::strip_ansi;
    use vtm_core::parse::{SessionDetails, WindowInfo};

    use super::{
        SessionWithWindows, build_selector_entries, parse_entry_line, parse_selection_lines,
    };

    #[test]
    fn parses_expected_selection_lines() {
        let (key, selections) = parse_selection_lines(&[
            String::from("ctrl-q"),
            String::from("session\talpha\talpha"),
        ]);
        assert_eq!(key, "ctrl-q");
        assert_eq!(selections, vec![String::from("session\talpha\talpha")]);
    }

    #[test]
    fn parses_entry_line() {
        let parsed = parse_entry_line("window\talpha:1\talpha");
        assert_eq!(
            parsed,
            Some((String::from("window"), String::from("alpha:1")))
        );
    }

    #[test]
    fn builds_selector_entries_for_sessions_and_windows() {
        let entries = build_selector_entries(
            &[
                SessionWithWindows {
                    session: SessionDetails {
                        id: String::from("$1"),
                        name: String::from("alpha"),
                        attached_clients: 1,
                        last_activity: i64::MAX,
                        category: String::from("work"),
                        project_path: String::new(),
                        category_override: String::new(),
                    },
                    windows: vec![WindowInfo {
                        index: String::from("1"),
                        panes: 2,
                        active: true,
                        name: String::from("editor"),
                        command: String::from("nvim"),
                    }],
                    total_windows: 1,
                    total_panes: 2,
                    is_current: true,
                },
                SessionWithWindows {
                    session: SessionDetails {
                        id: String::from("$2"),
                        name: String::from("very-long-session-name"),
                        attached_clients: 0,
                        last_activity: 0,
                        category: String::from("work"),
                        project_path: String::new(),
                        category_override: String::new(),
                    },
                    windows: Vec::new(),
                    total_windows: 0,
                    total_panes: 0,
                    is_current: false,
                },
            ],
            "work",
            &BTreeMap::new(),
        );
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].action, "session");
        assert_eq!(entries[1].action, "window");
        assert!(entries[0].display.contains("\u{1b}["));
        assert!(entries[1].display.contains("\u{1b}["));

        let session_sep = strip_ansi(&entries[0].display)
            .find(" | ")
            .expect("session separator");
        let second_session_sep = strip_ansi(&entries[2].display)
            .find(" | ")
            .expect("second session separator");
        assert_eq!(session_sep, second_session_sep);
    }
}
