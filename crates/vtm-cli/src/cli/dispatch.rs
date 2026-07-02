use std::io::Write;
use std::time::Duration;

use anyhow::Result;
use vtm_core::export::{ExportClientInput, build_state_export};
use vtm_core::runtime::resolve_ghq_root;
use vtm_core::state::{
    SessionResolutionContext, category_last_session_option_key, current_category_option_key,
    cycle_session_in_current_category, get_ordered_categories,
    get_ordered_categories_with_sessions, refresh_session_categories,
    remember_current_session_for_current_client, remember_session_for_client,
    resolve_adjacent_category, set_session_category_override,
    use_category_and_switch_to_last_session,
};

use crate::app_context::AppContext;
use crate::cli::project::switch_project_session;
use crate::cli::session_manager::run_session_manager;
use crate::cli::statusline::{run_statusline_category, run_statusline_sessions};
use crate::cli::{CliResponse, EXIT_ERROR, EXIT_OK, EXIT_USAGE};

const SUBSCRIBE_POLL_MS: u64 = 500;

fn render_global_help(program_name: &str) -> String {
    [
        format!("{program_name} v{}", env!("CARGO_PKG_VERSION")),
        String::new(),
        format!("Usage: {program_name} <command>"),
        String::new(),
        "Commands:".to_string(),
        "  category              Manage current tmux client category".to_string(),
        "  export                Export machine-readable state".to_string(),
        "  hooks                 Update client state from tmux hook events".to_string(),
        "  project               Create or switch tmux sessions by project path".to_string(),
        "  session               Manage tmux session metadata".to_string(),
        "  session-cycle         Cycle tmux sessions within the current category".to_string(),
        "  session-manager       Manage tmux sessions interactively".to_string(),
        "  sessions              Bulk tmux session metadata operations".to_string(),
        "  statusline-category   Render current category statusline segment".to_string(),
        "  statusline-sessions   Render tmux statusline session segments".to_string(),
        String::new(),
        "Global options:".to_string(),
        "  -h, --help            Show help".to_string(),
        "  -v, --version         Show version".to_string(),
    ]
    .join("\n")
}

fn collect_export_clients(
    tmux: &vtm_core::tmux::TmuxClient,
    categories: &[String],
) -> Result<Vec<ExportClientInput>> {
    tmux.list_clients()?
        .into_iter()
        .map(|client| {
            let current_category =
                tmux.show_client_option(&client.name, current_category_option_key())?;
            let mut last_sessions = std::collections::BTreeMap::new();
            for category in categories {
                let session = tmux.show_client_option(
                    &client.name,
                    &category_last_session_option_key(category),
                )?;
                if !session.trim().is_empty() {
                    last_sessions.insert(category.clone(), session);
                }
            }
            Ok(ExportClientInput {
                client: client.name,
                current_category: if current_category.trim().is_empty() {
                    None
                } else {
                    Some(current_category)
                },
                last_sessions,
            })
        })
        .collect()
}

fn run_export_command(
    args: &[String],
    ctx: &AppContext,
    tmux: &vtm_core::tmux::TmuxClient,
    config: &vtm_core::config::ResolvedConfig,
    home_directory: &str,
    ghq_root: Option<&str>,
) -> Result<CliResponse> {
    if args != ["state", "--json"] {
        return Ok(CliResponse {
            exit_code: EXIT_USAGE,
            stdout: String::new(),
            stderr: "Usage: vtm export state --json\n       vtm export subscribe --json"
                .to_string(),
        });
    }

    let sessions = ctx.list_session_details(tmux)?;
    let categories = get_ordered_categories(config);
    let clients = collect_export_clients(tmux, &categories)?;
    let export = build_state_export(&sessions, &clients, config, home_directory, ghq_root);
    Ok(CliResponse {
        exit_code: EXIT_OK,
        stdout: format!("{}\n", serde_json::to_string_pretty(&export)?),
        stderr: String::new(),
    })
}

fn build_subscribe_payload(ctx: &AppContext) -> Result<String> {
    let tmux = ctx.tmux();
    let load = ctx.load_config()?;
    let config = load.config;
    let home_directory = ctx.home_dir()?;
    let ghq_root = resolve_ghq_root(Some(&config), &ctx.env)?;
    let sessions = ctx.list_session_details(&tmux)?;
    let categories = get_ordered_categories(&config);
    let clients = collect_export_clients(&tmux, &categories)?;
    let export = build_state_export(
        &sessions,
        &clients,
        &config,
        &home_directory,
        ghq_root.as_deref(),
    );
    Ok(serde_json::to_string(&export)?)
}

fn subscribe_should_emit(last_payload: &mut Option<String>, payload: &str) -> bool {
    if last_payload.as_deref() == Some(payload) {
        return false;
    }
    *last_payload = Some(payload.to_string());
    true
}

fn run_export_subscribe_command(args: &[String], ctx: &AppContext) -> Result<CliResponse> {
    if args != ["subscribe", "--json"] {
        return Ok(CliResponse {
            exit_code: EXIT_USAGE,
            stdout: String::new(),
            stderr: "Usage: vtm export state --json\n       vtm export subscribe --json"
                .to_string(),
        });
    }
    let mut last_payload = None::<String>;
    loop {
        let payload = build_subscribe_payload(ctx)?;
        if subscribe_should_emit(&mut last_payload, &payload) {
            println!("{payload}");
            std::io::stdout().flush()?;
        }
        std::thread::sleep(Duration::from_millis(SUBSCRIBE_POLL_MS));
    }
}

pub fn run_cli_with_context(args: &[String], ctx: &AppContext) -> Result<CliResponse> {
    let program_name = "vtm";
    if args.is_empty() {
        return Ok(CliResponse {
            exit_code: EXIT_OK,
            stdout: format!("{}\n", render_global_help(program_name)),
            stderr: String::new(),
        });
    }
    match args[0].as_str() {
        "-h" | "--help" => {
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: format!("{}\n", render_global_help(program_name)),
                stderr: String::new(),
            });
        }
        "-v" | "--version" => {
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: format!("{}\n", env!("CARGO_PKG_VERSION")),
                stderr: String::new(),
            });
        }
        _ => {}
    }

    match args[0].as_str() {
        "export" if args.get(1).map(String::as_str) == Some("subscribe") => {
            return run_export_subscribe_command(&args[1..], ctx);
        }
        "session-manager" => return run_session_manager(&args[1..], ctx),
        "statusline-category" => return run_statusline_category(&args[1..], ctx),
        "statusline-sessions" => return run_statusline_sessions(&args[1..], ctx),
        _ => {}
    }

    let tmux = ctx.tmux();
    let load = ctx.load_config()?;
    let config = load.config;
    let home_directory = ctx.home_dir()?;
    let ghq_root = resolve_ghq_root(Some(&config), &ctx.env)?;

    match args[0].as_str() {
        "category" => match args.get(1).map(String::as_str) {
            Some("next") | Some("prev") if args.len() == 2 => {
                let direction = args[1].as_str();
                let sessions = ctx.list_session_details(&tmux)?;
                let ordered_categories = get_ordered_categories_with_sessions(
                    &sessions,
                    &config,
                    &home_directory,
                    ghq_root.as_deref(),
                );
                if ordered_categories.is_empty() {
                    return Ok(CliResponse {
                        exit_code: EXIT_OK,
                        stdout: String::new(),
                        stderr: String::new(),
                    });
                }
                let current_category = vtm_core::state::get_current_category(&tmux, &config)?;
                let next_category =
                    resolve_adjacent_category(&current_category, direction, &ordered_categories)?;
                use_category_and_switch_to_last_session(
                    &tmux,
                    &config,
                    &next_category,
                    &home_directory,
                    ghq_root.as_deref(),
                    &sessions,
                )?;
                Ok(CliResponse {
                    exit_code: EXIT_OK,
                    stdout: String::new(),
                    stderr: String::new(),
                })
            }
            Some("use") if args.len() == 3 => {
                let sessions = ctx.list_session_details(&tmux)?;
                use_category_and_switch_to_last_session(
                    &tmux,
                    &config,
                    &args[2],
                    &home_directory,
                    ghq_root.as_deref(),
                    &sessions,
                )?;
                Ok(CliResponse {
                    exit_code: EXIT_OK,
                    stdout: String::new(),
                    stderr: String::new(),
                })
            }
            _ => Ok(CliResponse {
                exit_code: EXIT_USAGE,
                stdout: String::new(),
                stderr: "Usage: vtm category use <name>\n       vtm category next\n       vtm category prev".to_string(),
            }),
        },
        "export" => run_export_command(
            &args[1..],
            ctx,
            &tmux,
            &config,
            &home_directory,
            ghq_root.as_deref(),
        ),
        "session-cycle" => {
            let Some(direction) = args.get(1) else {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: "Usage: vtm session-cycle <next|prev>".to_string(),
                });
            };
            if !matches!(direction.as_str(), "next" | "prev") {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: "Usage: vtm session-cycle <next|prev>".to_string(),
                });
            }
            let sessions = ctx.list_session_details(&tmux)?;
            cycle_session_in_current_category(
                &tmux,
                &config,
                direction,
                &home_directory,
                ghq_root.as_deref(),
                &sessions,
            )?;
            Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            })
        }
        "project" => {
            if args.get(1).map(String::as_str) != Some("switch") || args.len() != 3 {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: "Usage: vtm project switch <path>".to_string(),
                });
            }
            switch_project_session(ctx, &tmux, &config, &args[2])?;
            Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            })
        }
        "session" => {
            if args.get(1).map(String::as_str) != Some("set-category") || args.len() != 4 {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: "Usage: vtm session set-category <session> <category>".to_string(),
                });
            }
            set_session_category_override(&tmux, &config, &args[2], &args[3])?;
            Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            })
        }
        "sessions" => {
            if args.get(1).map(String::as_str) != Some("refresh-category") || args.len() != 2 {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: "Usage: vtm sessions refresh-category".to_string(),
                });
            }
            let sessions = ctx.list_session_details(&tmux)?;
            let _ = refresh_session_categories(
                &tmux,
                &config,
                &home_directory,
                ghq_root.as_deref(),
                &sessions,
            )?;
            Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            })
        }
        "hooks" => {
            if args.get(1).map(String::as_str) != Some("on-client-session-changed") {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: "Usage: vtm hooks on-client-session-changed [<client-name> <session-name>]".to_string(),
                });
            }
            let sessions = ctx.list_session_details(&tmux)?;
            if args.len() == 2 {
                remember_current_session_for_current_client(
                    &tmux,
                    &config,
                    &home_directory,
                    ghq_root.as_deref(),
                    None,
                    &sessions,
                    true,
                )?;
            } else if args.len() == 4 {
                remember_session_for_client(
                    &tmux,
                    &config,
                    &args[2],
                    &args[3],
                    SessionResolutionContext {
                        home_directory: &home_directory,
                        ghq_root: ghq_root.as_deref(),
                        sessions: &sessions,
                    },
                    true,
                )?;
            } else {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: "Usage: vtm hooks on-client-session-changed [<client-name> <session-name>]".to_string(),
                });
            }
            Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            })
        }
        _ => Ok(CliResponse {
            exit_code: EXIT_ERROR,
            stdout: String::new(),
            stderr: format!("[UNKNOWN_COMMAND] Unknown command: {}", args[0]),
        }),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::run_cli_with_context;
    use crate::app_context::AppContext;
    use crate::cli::{EXIT_ERROR, EXIT_OK};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("vtm-{label}-{stamp}-{}", std::process::id()));
        fs::create_dir_all(&path).expect("temp dir");
        path
    }

    fn install_fake_tmux(bin_dir: &Path) {
        let script_path = bin_dir.join("tmux");
        fs::write(
            &script_path,
            r##"#!/bin/sh
if [ "$1" = "display-message" ] && [ "$2" = "-p" ] && [ "$3" = "#{client_name}" ]; then
  printf ''
  exit 0
fi
if [ "$1" = "list-sessions" ]; then
  printf '$1	alpha	1	100	default	/tmp/project	\n'
  exit 0
fi
printf 'unexpected args: %s\n' "$*" >&2
exit 1
"##,
        )
        .expect("write fake tmux");
        let mut perms = fs::metadata(&script_path).expect("metadata").permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script_path, perms).expect("chmod");
    }

    fn install_fake_export_tmux(bin_dir: &Path) {
        let script_path = bin_dir.join("tmux");
        fs::write(
            &script_path,
            r##"#!/bin/sh
if [ "$1" = "list-sessions" ]; then
  printf '$1	manual	1	1751400000		/tmp/manual	private\n'
  printf '$2	company	0	1751400001		/home/me/ghq/github.com/company/app	\n'
  printf '$3	oss-tool	0	1751400002			\n'
  exit 0
fi
if [ "$1" = "list-clients" ]; then
  printf '/dev/ttys003\n'
  exit 0
fi
if [ "$1" = "show-option" ] && [ "$2" = "-sqv" ] && [ "$3" = "@client_2f6465762f74747973303033_current_category" ]; then
  printf 'private\n'
  exit 0
fi
if [ "$1" = "show-option" ] && [ "$2" = "-sqv" ] && [ "$3" = "@client_2f6465762f74747973303033_category_last_session_70726976617465" ]; then
  printf 'manual\n'
  exit 0
fi
if [ "$1" = "show-option" ] && [ "$2" = "-sqv" ]; then
  printf ''
  exit 0
fi
printf 'unexpected args: %s\n' "$*" >&2
exit 1
"##,
        )
        .expect("write fake tmux");
        let mut perms = fs::metadata(&script_path).expect("metadata").permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script_path, perms).expect("chmod");
    }

    fn write_test_config(home_dir: &Path) {
        let config_dir = home_dir.join(".config").join("vde").join("tmux-manager");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("config.yml"),
            "categories:\n  defaultCategory: default\n",
        )
        .expect("config file");
    }

    fn write_export_test_config(home_dir: &Path) {
        let config_dir = home_dir.join(".config").join("vde").join("tmux-manager");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("config.yml"),
            r#"ghqRoot: /home/me/ghq
categories:
  defaultCategory: private
  displayNames:
    private: Private
    public: Public
    work: Work
  order:
    private: 0
    public: 1
    work: 2
  rules:
    - category: work
      ghqPatterns:
        - github.com/company/**
  sessionNameRules:
    - category: public
      patterns:
        - oss-*
"#,
        )
        .expect("config file");
    }

    #[test]
    fn subscribe_emits_initial_payload() {
        let mut last = None;
        assert!(super::subscribe_should_emit(&mut last, "{\"version\":1}"));
        assert_eq!(last.as_deref(), Some("{\"version\":1}"));
    }

    #[test]
    fn subscribe_skips_unchanged_payload() {
        let mut last = Some(String::from("{\"version\":1}"));
        assert!(!super::subscribe_should_emit(&mut last, "{\"version\":1}"));
        assert_eq!(last.as_deref(), Some("{\"version\":1}"));
    }

    #[test]
    fn subscribe_emits_changed_payload() {
        let mut last = Some(String::from("{\"version\":1}"));
        assert!(super::subscribe_should_emit(&mut last, "{\"version\":2}"));
        assert_eq!(last.as_deref(), Some("{\"version\":2}"));
    }

    #[test]
    fn builds_subscribe_payload_as_single_line_json() {
        let temp_dir = unique_temp_dir("dispatch-subscribe-test");
        let bin_dir = temp_dir.join("bin");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        install_fake_export_tmux(&bin_dir);
        write_export_test_config(&temp_dir);

        let path_value = std::env::var("PATH").unwrap_or_default();
        let ctx = AppContext::new(
            BTreeMap::from([
                (String::from("HOME"), temp_dir.display().to_string()),
                (
                    String::from("PATH"),
                    format!("{}:{}", bin_dir.display(), path_value),
                ),
            ]),
            None,
        );
        let payload = super::build_subscribe_payload(&ctx).expect("payload");
        assert!(!payload.contains('\n'));
        let value: serde_json::Value = serde_json::from_str(&payload).expect("json");
        assert_eq!(value["version"], 1);
        assert_eq!(value["clients"][0]["client"], "/dev/ttys003");
    }

    #[test]
    fn returns_unknown_command_error() {
        let ctx = AppContext::new(
            BTreeMap::from([(String::from("HOME"), String::from("/tmp"))]),
            None,
        );
        let response = run_cli_with_context(&[String::from("unknown")], &ctx).expect("response");
        assert_eq!(response.exit_code, EXIT_ERROR);
        assert!(response.stderr.contains("Unknown command"));
    }

    #[test]
    fn renders_statusline_category_with_fake_tmux() {
        let temp_dir = unique_temp_dir("dispatch-test");
        let bin_dir = temp_dir.join("bin");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        install_fake_tmux(&bin_dir);
        write_test_config(&temp_dir);

        let path_value = std::env::var("PATH").unwrap_or_default();
        let ctx = AppContext::new(
            BTreeMap::from([
                (String::from("HOME"), temp_dir.display().to_string()),
                (
                    String::from("PATH"),
                    format!("{}:{}", bin_dir.display(), path_value),
                ),
            ]),
            None,
        );
        let response =
            run_cli_with_context(&[String::from("statusline-category")], &ctx).expect("response");
        assert_eq!(response.exit_code, EXIT_OK);
        assert!(!response.stdout.trim().is_empty());
    }

    #[test]
    fn exports_state_as_json() {
        let temp_dir = unique_temp_dir("dispatch-export-test");
        let bin_dir = temp_dir.join("bin");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        install_fake_export_tmux(&bin_dir);
        write_export_test_config(&temp_dir);

        let path_value = std::env::var("PATH").unwrap_or_default();
        let ctx = AppContext::new(
            BTreeMap::from([
                (String::from("HOME"), temp_dir.display().to_string()),
                (
                    String::from("PATH"),
                    format!("{}:{}", bin_dir.display(), path_value),
                ),
            ]),
            None,
        );
        let response = run_cli_with_context(
            &[
                String::from("export"),
                String::from("state"),
                String::from("--json"),
            ],
            &ctx,
        )
        .expect("response");

        assert_eq!(response.exit_code, EXIT_OK);
        let value: serde_json::Value = serde_json::from_str(&response.stdout).expect("json");
        assert_eq!(value["version"], 1);
        assert_eq!(value["sessions"][0]["categorySource"], "override");
        assert_eq!(value["sessions"][1]["categorySource"], "pathRule");
        assert_eq!(value["sessions"][2]["categorySource"], "sessionNameRule");
        assert_eq!(value["clients"][0]["client"], "/dev/ttys003");
        assert_eq!(value["clients"][0]["currentCategory"], "private");
        assert_eq!(value["clients"][0]["lastSessions"]["private"], "manual");
    }
}
