use anyhow::Result;
use vtm_core::config::{ResolvedConfig, StatuslineCategoryMode, StatuslineSegmentConfig};
use vtm_core::format::render_tmux_statusline_segment;
use vtm_core::parse::SessionIdentity;
use vtm_core::state::{
    SessionResolutionContext, SwitchClientSessionRequest, get_current_category,
    get_ordered_categories_with_sessions, get_sessions_in_category,
    switch_client_and_remember_session, use_category_and_switch_to_last_session,
};

use crate::app_context::AppContext;
use crate::cli::{CliResponse, EXIT_ERROR, EXIT_OK, EXIT_USAGE};

fn positive_index(value: &str) -> Option<usize> {
    if !value.chars().all(|char| char.is_ascii_digit()) {
        return None;
    }
    let parsed = value.parse::<usize>().ok()?;
    (parsed > 0).then_some(parsed)
}

pub fn render_statusline_category(
    current_category_name: &str,
    ordered_categories: &[String],
    config: &ResolvedConfig,
) -> String {
    let resolve_display_name = |category_name: &str| -> String {
        if category_name.is_empty() {
            String::new()
        } else {
            config
                .categories
                .display_names
                .get(category_name)
                .cloned()
                .unwrap_or_else(|| category_name.to_string())
        }
    };

    let to_content = |category_name: &str| -> String {
        config
            .statusline_category
            .format
            .replace("{category}", &resolve_display_name(category_name))
    };

    match config.statusline_category.mode {
        StatuslineCategoryMode::List => ordered_categories
            .iter()
            .filter(|category| !category.is_empty())
            .enumerate()
            .map(|(index, category_name)| {
                let colors = if category_name == current_category_name {
                    config.statusline_category.colors.clone()
                } else {
                    config.statusline_category.inactive_colors.clone()
                };
                let segment = render_tmux_statusline_segment(
                    &to_content(category_name),
                    &StatuslineSegmentConfig {
                        format: config.statusline_category.format.clone(),
                        prefix: config.statusline_category.prefix.clone(),
                        suffix: config.statusline_category.suffix.clone(),
                        bold: config.statusline_category.bold,
                        colors,
                    },
                );
                if segment.is_empty() {
                    String::new()
                } else {
                    format!("#[range=user|{}]{segment}#[norange]", index + 1)
                }
            })
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
        StatuslineCategoryMode::Current => {
            if !ordered_categories
                .iter()
                .any(|category| category == current_category_name)
            {
                return String::new();
            }
            let content = to_content(current_category_name);
            if current_category_name.is_empty() || content.is_empty() {
                return String::new();
            }
            render_tmux_statusline_segment(
                &content,
                &StatuslineSegmentConfig {
                    format: config.statusline_category.format.clone(),
                    prefix: config.statusline_category.prefix.clone(),
                    suffix: config.statusline_category.suffix.clone(),
                    bold: config.statusline_category.bold,
                    colors: config.statusline_category.colors.clone(),
                },
            )
        }
    }
}

fn build_session_label(index: usize, name: &str, show_index: bool) -> String {
    if show_index && index <= 9 {
        format!("{index} {name}")
    } else {
        name.to_string()
    }
}

pub fn render_statusline_sessions(
    sessions: &[SessionIdentity],
    current_session: &str,
    config: &vtm_core::config::StatuslineSessionsConfig,
) -> String {
    let mut output = String::new();
    for (index, session) in sessions.iter().enumerate() {
        let segment_config = if session.name == current_session {
            config.current.clone()
        } else {
            config.other.clone()
        };
        let label = build_session_label(index + 1, &session.name, config.show_index);
        output.push(' ');
        output.push_str(&format!("#[range=session|{}]", session.id));
        output.push_str(&render_tmux_statusline_segment(
            &segment_config.format.replace("{session}", &label),
            &segment_config,
        ));
        output.push_str("#[norange]");
    }
    output
}

pub fn run_statusline_category(args: &[String], ctx: &AppContext) -> Result<CliResponse> {
    let tmux = ctx.tmux();
    let load = ctx.load_config()?;
    let config = load.config;
    let home_directory = ctx.home_dir()?;
    let ghq_root = vtm_core::runtime::resolve_ghq_root(Some(&config), &ctx.env)?;

    if matches!(args.first().map(String::as_str), Some("-h" | "--help")) {
        return Ok(CliResponse {
            exit_code: EXIT_OK,
            stdout: "Usage: vtm statusline-category\n       vtm statusline-category switch <index>\n\nPrint the current tmux client category as a statusline segment or switch categories by index.\n".to_string(),
            stderr: String::new(),
        });
    }
    if args.first().map(String::as_str) == Some("switch") {
        let Some(value) = args.get(1) else {
            return Ok(CliResponse {
                exit_code: EXIT_USAGE,
                stdout: String::new(),
                stderr: "[USAGE] Usage: vtm statusline-category switch <index>".to_string(),
            });
        };
        let Some(target_index) = positive_index(value) else {
            return Ok(CliResponse {
                exit_code: EXIT_USAGE,
                stdout: String::new(),
                stderr: format!(
                    "vtm statusline-category: index must be a positive integer: {value}"
                ),
            });
        };
        let session_details = ctx.list_session_details(&tmux)?;
        let visible_categories = get_ordered_categories_with_sessions(
            &session_details,
            &config,
            &home_directory,
            ghq_root.as_deref(),
        );
        let visible = visible_categories
            .into_iter()
            .filter(|category| !category.is_empty())
            .collect::<Vec<_>>();
        let Some(target_category_name) = visible.get(target_index - 1).cloned() else {
            return Ok(CliResponse {
                exit_code: EXIT_ERROR,
                stdout: String::new(),
                stderr: format!(
                    "vtm statusline-category: category not found at index {target_index}"
                ),
            });
        };
        use_category_and_switch_to_last_session(
            &tmux,
            &config,
            &target_category_name,
            &home_directory,
            ghq_root.as_deref(),
            &session_details,
        )?;
        ctx.invalidate_snapshot();
        return Ok(CliResponse {
            exit_code: EXIT_OK,
            stdout: String::new(),
            stderr: String::new(),
        });
    }
    if !args.is_empty() {
        return Ok(CliResponse {
            exit_code: EXIT_USAGE,
            stdout: String::new(),
            stderr: "[USAGE] Usage: vtm statusline-category".to_string(),
        });
    }
    let current_category = get_current_category(&tmux, &config)?;
    let session_details = ctx.list_session_details(&tmux)?;
    let ordered_categories = get_ordered_categories_with_sessions(
        &session_details,
        &config,
        &home_directory,
        ghq_root.as_deref(),
    );
    Ok(CliResponse {
        exit_code: EXIT_OK,
        stdout: format!(
            "{}\n",
            render_statusline_category(&current_category, &ordered_categories, &config)
        ),
        stderr: String::new(),
    })
}

pub fn run_statusline_sessions(args: &[String], ctx: &AppContext) -> Result<CliResponse> {
    let tmux = ctx.tmux();
    let load = ctx.load_config()?;
    let config = load.config;
    let home_directory = ctx.home_dir()?;
    let ghq_root = vtm_core::runtime::resolve_ghq_root(Some(&config), &ctx.env)?;

    if matches!(args.first().map(String::as_str), Some("-h" | "--help")) {
        return Ok(CliResponse {
            exit_code: EXIT_OK,
            stdout: "Usage: vtm statusline-sessions [--show-index]\n       vtm statusline-sessions switch <index>\n\nPrint tmux statusline session segments or switch sessions by index.\n".to_string(),
            stderr: String::new(),
        });
    }
    if args.first().map(String::as_str) == Some("switch") {
        let Some(value) = args.get(1) else {
            return Ok(CliResponse {
                exit_code: EXIT_USAGE,
                stdout: String::new(),
                stderr: "[USAGE] Usage: vtm statusline-sessions switch <index>".to_string(),
            });
        };
        let Some(target_index) = positive_index(value) else {
            return Ok(CliResponse {
                exit_code: EXIT_USAGE,
                stdout: String::new(),
                stderr: format!(
                    "vtm statusline-sessions: index must be a positive integer: {value}"
                ),
            });
        };
        let client_name = tmux.current_client_name()?;
        let current_category = get_current_category(&tmux, &config)?;
        let session_details = ctx.list_session_details(&tmux)?;
        let sessions = get_sessions_in_category(
            &session_details,
            &current_category,
            &config,
            &home_directory,
            ghq_root.as_deref(),
        )
        .into_iter()
        .map(|session| SessionIdentity {
            id: session.id,
            name: session.name,
        })
        .collect::<Vec<_>>();
        let Some(target_session) = sessions.get(target_index - 1) else {
            return Ok(CliResponse {
                exit_code: EXIT_ERROR,
                stdout: String::new(),
                stderr: format!(
                    "vtm statusline-sessions: session not found at index {target_index}"
                ),
            });
        };
        switch_client_and_remember_session(
            &tmux,
            &config,
            SwitchClientSessionRequest {
                session_name: &target_session.name,
                category_name: Some(&current_category),
                client_name: Some(&client_name),
                skip_current_category_update: true,
            },
            SessionResolutionContext {
                home_directory: &home_directory,
                ghq_root: ghq_root.as_deref(),
                sessions: &session_details,
            },
        )?;
        ctx.invalidate_snapshot();
        return Ok(CliResponse {
            exit_code: EXIT_OK,
            stdout: String::new(),
            stderr: String::new(),
        });
    }
    let mut show_index_override = None::<bool>;
    for arg in args {
        if arg == "--show-index" {
            show_index_override = Some(true);
        } else {
            return Ok(CliResponse {
                exit_code: EXIT_USAGE,
                stdout: String::new(),
                stderr: "[USAGE] Usage: vtm statusline-sessions [--show-index]".to_string(),
            });
        }
    }
    let current_category = get_current_category(&tmux, &config)?;
    let current_session = tmux.current_client_session()?;
    let sessions = get_sessions_in_category(
        &ctx.list_session_details(&tmux)?,
        &current_category,
        &config,
        &home_directory,
        ghq_root.as_deref(),
    )
    .into_iter()
    .map(|session| SessionIdentity {
        id: session.id,
        name: session.name,
    })
    .collect::<Vec<_>>();
    let mut status_config = config.statusline_sessions.clone();
    status_config.show_index = show_index_override.unwrap_or(status_config.show_index);
    Ok(CliResponse {
        exit_code: EXIT_OK,
        stdout: format!(
            "{}\n",
            render_statusline_sessions(&sessions, &current_session, &status_config)
        ),
        stderr: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use vtm_core::config::{StatuslineCategoryMode, default_config};
    use vtm_core::parse::SessionIdentity;

    use super::{render_statusline_category, render_statusline_sessions};

    fn sample_config() -> vtm_core::config::ResolvedConfig {
        let mut config = default_config();
        config.statusline_category.mode = StatuslineCategoryMode::Current;
        config.statusline_category.format = "{category}".to_string();
        config.categories.display_names =
            BTreeMap::from([("work".to_string(), "Work".to_string())]);
        config
    }

    #[test]
    fn renders_current_category_display_name() {
        let config = sample_config();
        let rendered = render_statusline_category("work", &[String::from("work")], &config);
        assert!(rendered.contains("Work"));
    }

    #[test]
    fn renders_session_ranges() {
        let config = sample_config();
        let rendered = render_statusline_sessions(
            &[
                SessionIdentity {
                    id: String::from("$1"),
                    name: String::from("alpha"),
                },
                SessionIdentity {
                    id: String::from("$2"),
                    name: String::from("beta"),
                },
            ],
            "alpha",
            &config.statusline_sessions,
        );
        assert!(rendered.contains("#[range=session|$1]"));
        assert!(rendered.contains("alpha"));
        assert!(rendered.contains("beta"));
    }
}
