use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use vtm_core::command::{CommandOptions, command_exists, file_mtime, run_command};
use vtm_core::config::{LoadConfigResult, ResolvedConfig, StatuslineCategoryMode, load_config};
use vtm_core::format::{render_tmux_statusline_segment, truncate_visible};
use vtm_core::matcher::{resolve_project_path_category, sort_categories};
use vtm_core::parse::{
    PaneInfo, SessionDetails, SessionIdentity, WindowInfo, parse_int_safe, split_non_empty_lines,
    split_window_target,
};
use vtm_core::preview::render_preview_once;
use vtm_core::runtime::resolve_ghq_root;
use vtm_core::state::{
    cycle_session_in_current_category, get_current_category,
    get_ordered_categories_with_sessions, get_sessions_in_category,
    remember_current_session_for_current_client, remember_session_for_client,
    refresh_session_categories, resolve_adjacent_category,
    resolve_effective_session_category, set_session_category_override,
    switch_client_and_remember_session, use_category_and_switch_to_last_session,
};
use vtm_core::tmux::TmuxClient;

const EXIT_OK: i32 = 0;
const EXIT_ERROR: i32 = 1;
const EXIT_USAGE: i32 = 2;
const PROTOCOL_VERSION: &str = "1";
const SNAPSHOT_TTL_MS: u64 = 150;
const FZF_DEFAULT_PREVIEW_WIDTH: &str = "65";
const ACTIVE_ACTIVITY_THRESHOLD_SECONDS: i64 = 60 * 60;

#[derive(Debug)]
struct CachedConfig {
    path: PathBuf,
    mtime: Option<SystemTime>,
    loaded: bool,
    config: ResolvedConfig,
}

#[derive(Debug, Clone)]
struct CachedSnapshot {
    generation: u64,
    synced_at: SystemTime,
    sessions: Vec<SessionDetails>,
}

#[derive(Debug)]
struct DaemonSharedState {
    started_at: SystemTime,
    last_error: Option<String>,
    config_cache: Option<CachedConfig>,
    snapshot_cache: Option<CachedSnapshot>,
    next_generation: u64,
}

impl Default for DaemonSharedState {
    fn default() -> Self {
        Self {
            started_at: SystemTime::now(),
            last_error: None,
            config_cache: None,
            snapshot_cache: None,
            next_generation: 1,
        }
    }
}

#[derive(Debug, Clone)]
struct AppContext {
    env: BTreeMap<String, String>,
    cwd: Option<PathBuf>,
    daemon_state: Option<Arc<Mutex<DaemonSharedState>>>,
}

impl AppContext {
    fn new(
        env: BTreeMap<String, String>,
        cwd: Option<PathBuf>,
        daemon_state: Option<Arc<Mutex<DaemonSharedState>>>,
    ) -> Self {
        Self {
            env,
            cwd,
            daemon_state,
        }
    }

    fn tmux(&self) -> TmuxClient {
        TmuxClient::new(self.env.clone()).with_cwd(self.cwd.clone())
    }

    fn home_dir(&self) -> Result<String> {
        self.env
            .get("HOME")
            .cloned()
            .ok_or_else(|| anyhow!("HOME is required"))
    }

    fn load_config(&self) -> Result<LoadConfigResult> {
        if let Some(shared) = &self.daemon_state {
            let path = vtm_core::config::resolve_config_path(&self.env)?;
            let mtime = file_mtime(&path)?;
            let guard = shared.lock().map_err(|_| anyhow!("daemon state poisoned"))?;
            if let Some(cache) = &guard.config_cache {
                if cache.path == path && cache.mtime == mtime {
                    return Ok(LoadConfigResult {
                        config: cache.config.clone(),
                        path: cache.path.clone(),
                        loaded: cache.loaded,
                    });
                }
            }
            drop(guard);
            let result = load_config(&self.env)?;
            let mut guard = shared.lock().map_err(|_| anyhow!("daemon state poisoned"))?;
            guard.config_cache = Some(CachedConfig {
                path: result.path.clone(),
                mtime,
                loaded: result.loaded,
                config: result.config.clone(),
            });
            return Ok(result);
        }
        load_config(&self.env)
    }

    fn list_session_details(&self, tmux: &TmuxClient) -> Result<Vec<SessionDetails>> {
        if let Some(shared) = &self.daemon_state {
            let guard = shared.lock().map_err(|_| anyhow!("daemon state poisoned"))?;
            if let Some(snapshot) = &guard.snapshot_cache {
                if snapshot
                    .synced_at
                    .elapsed()
                    .map(|value| value <= Duration::from_millis(SNAPSHOT_TTL_MS))
                    .unwrap_or(false)
                {
                    return Ok(snapshot.sessions.clone());
                }
            }
            drop(guard);
            let sessions = tmux.list_session_details()?;
            let mut guard = shared.lock().map_err(|_| anyhow!("daemon state poisoned"))?;
            let generation = guard.next_generation;
            guard.next_generation += 1;
            guard.snapshot_cache = Some(CachedSnapshot {
                generation,
                synced_at: SystemTime::now(),
                sessions: sessions.clone(),
            });
            return Ok(sessions);
        }
        tmux.list_session_details()
    }

    fn invalidate_snapshot(&self) {
        if let Some(shared) = &self.daemon_state {
            if let Ok(mut guard) = shared.lock() {
                guard.snapshot_cache = None;
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
enum DaemonRequest {
    Status,
    Reload,
    Shutdown,
    Cli {
        args: Vec<String>,
        env: BTreeMap<String, String>,
        cwd: Option<String>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct DaemonStatus {
    socket_path: String,
    pid: u32,
    uptime_seconds: u64,
    protocol_version: String,
    config_generation: u64,
    snapshot_generation: u64,
    last_full_resync: Option<u64>,
    last_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CliResponse {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize, Deserialize)]
enum DaemonResponse {
    Status(DaemonStatus),
    Ack,
    Cli(CliResponse),
    Error(String),
}

fn collect_env() -> BTreeMap<String, String> {
    std::env::vars().collect()
}

fn runtime_directory(env: &BTreeMap<String, String>) -> PathBuf {
    if let Some(runtime_dir) = env.get("XDG_RUNTIME_DIR").filter(|value| !value.trim().is_empty()) {
        return PathBuf::from(runtime_dir).join("vde-tmux-manager");
    }
    std::env::temp_dir().join("vde-tmux-manager")
}

fn socket_path(env: &BTreeMap<String, String>) -> PathBuf {
    runtime_directory(env).join("daemon.sock")
}

fn write_frame<T: Serialize>(stream: &mut UnixStream, payload: &T) -> Result<()> {
    let bytes = serde_json::to_vec(payload)?;
    let length = bytes.len() as u64;
    stream.write_all(&length.to_be_bytes())?;
    stream.write_all(&bytes)?;
    Ok(())
}

fn read_frame<T: for<'de> Deserialize<'de>>(stream: &mut UnixStream) -> Result<T> {
    let mut length_buffer = [0u8; 8];
    stream.read_exact(&mut length_buffer)?;
    let length = u64::from_be_bytes(length_buffer) as usize;
    let mut bytes = vec![0u8; length];
    stream.read_exact(&mut bytes)?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn connect_socket(path: &Path) -> Result<UnixStream> {
    UnixStream::connect(path).with_context(|| format!("failed to connect {}", path.display()))
}

fn send_daemon_request(path: &Path, request: &DaemonRequest) -> Result<DaemonResponse> {
    let mut stream = connect_socket(path)?;
    write_frame(&mut stream, request)?;
    read_frame(&mut stream)
}

fn ensure_daemon_started(env: &BTreeMap<String, String>) -> Result<PathBuf> {
    let socket = socket_path(env);
    if let Ok(DaemonResponse::Status(_)) = send_daemon_request(&socket, &DaemonRequest::Status) {
        return Ok(socket);
    }
    std::fs::create_dir_all(socket.parent().unwrap_or_else(|| Path::new("/tmp")))?;
    if socket.exists() {
        let _ = std::fs::remove_file(&socket);
    }
    let executable = std::env::current_exe().context("failed to resolve current executable")?;
    Command::new(executable)
        .arg("daemon")
        .arg("serve")
        .arg(socket.as_os_str())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("failed to spawn daemon")?;

    for _ in 0..50 {
        std::thread::sleep(Duration::from_millis(50));
        if let Ok(DaemonResponse::Status(_)) = send_daemon_request(&socket, &DaemonRequest::Status) {
            return Ok(socket);
        }
    }
    Err(anyhow!("daemon did not start"))
}

fn daemon_status_from_state(shared: &Arc<Mutex<DaemonSharedState>>, socket: &Path) -> DaemonStatus {
    let guard = shared.lock().expect("daemon state poisoned");
    let uptime_seconds = guard
        .started_at
        .elapsed()
        .map(|value| value.as_secs())
        .unwrap_or(0);
    DaemonStatus {
        socket_path: socket.display().to_string(),
        pid: std::process::id(),
        uptime_seconds,
        protocol_version: PROTOCOL_VERSION.to_string(),
        config_generation: u64::from(guard.config_cache.is_some()),
        snapshot_generation: guard
            .snapshot_cache
            .as_ref()
            .map(|snapshot| snapshot.generation)
            .unwrap_or(0),
        last_full_resync: guard.snapshot_cache.as_ref().and_then(|snapshot| {
            snapshot
                .synced_at
                .duration_since(SystemTime::UNIX_EPOCH)
                .ok()
                .map(|value| value.as_secs())
        }),
        last_error: guard.last_error.clone(),
    }
}

fn serve_daemon(socket: &Path) -> Result<()> {
    if let Some(parent) = socket.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if socket.exists() {
        let _ = std::fs::remove_file(socket);
    }
    let listener = UnixListener::bind(socket)
        .with_context(|| format!("failed to bind {}", socket.display()))?;
    let shared = Arc::new(Mutex::new(DaemonSharedState::default()));

    for incoming in listener.incoming() {
        let mut stream = match incoming {
            Ok(stream) => stream,
            Err(error) => {
                if let Ok(mut guard) = shared.lock() {
                    guard.last_error = Some(error.to_string());
                }
                continue;
            }
        };

        let request = match read_frame::<DaemonRequest>(&mut stream) {
            Ok(request) => request,
            Err(error) => {
                let _ = write_frame(&mut stream, &DaemonResponse::Error(error.to_string()));
                continue;
            }
        };

        let response = match request {
            DaemonRequest::Status => DaemonResponse::Status(daemon_status_from_state(&shared, socket)),
            DaemonRequest::Reload => {
                if let Ok(mut guard) = shared.lock() {
                    guard.config_cache = None;
                    guard.snapshot_cache = None;
                }
                DaemonResponse::Ack
            }
            DaemonRequest::Shutdown => {
                let _ = write_frame(&mut stream, &DaemonResponse::Ack);
                let _ = std::fs::remove_file(socket);
                return Ok(());
            }
            DaemonRequest::Cli { args, env, cwd } => {
                let cwd = cwd.map(PathBuf::from);
                let ctx = AppContext::new(env, cwd, Some(shared.clone()));
                match run_cli_with_context(&args, &ctx, false) {
                    Ok(response) => DaemonResponse::Cli(response),
                    Err(error) => {
                        if let Ok(mut guard) = shared.lock() {
                            guard.last_error = Some(error.to_string());
                        }
                        DaemonResponse::Cli(CliResponse {
                            exit_code: EXIT_ERROR,
                            stdout: String::new(),
                            stderr: format!("[UNEXPECTED_ERROR] {error}"),
                        })
                    }
                }
            }
        };
        let _ = write_frame(&mut stream, &response);
    }

    Ok(())
}

fn render_global_help(program_name: &str) -> String {
    [
        format!("{program_name} v{}", env!("CARGO_PKG_VERSION")),
        String::new(),
        format!("Usage: {program_name} <command>"),
        String::new(),
        "Commands:".to_string(),
        "  daemon                Manage Rust daemon lifecycle".to_string(),
        "  category              Manage current tmux client category".to_string(),
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

fn positive_index(value: &str) -> Option<usize> {
    if !value.chars().all(|char| char.is_ascii_digit()) {
        return None;
    }
    let parsed = value.parse::<usize>().ok()?;
    (parsed > 0).then_some(parsed)
}

fn render_statusline_category(
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
                    &vtm_core::config::StatuslineSegmentConfig {
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
            if !ordered_categories.iter().any(|category| category == current_category_name) {
                return String::new();
            }
            let content = to_content(current_category_name);
            if current_category_name.is_empty() || content.is_empty() {
                return String::new();
            }
            render_tmux_statusline_segment(
                &content,
                &vtm_core::config::StatuslineSegmentConfig {
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

fn render_statusline_sessions(
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

fn parse_all_windows_by_session(output: &str) -> BTreeMap<String, Vec<WindowInfo>> {
    let mut grouped = BTreeMap::new();
    for line in split_non_empty_lines(output) {
        let parts = line.split('\t').collect::<Vec<_>>();
        let session_name = parts.first().copied().unwrap_or("").trim().to_string();
        let index = parts.get(1).copied().unwrap_or("").trim().to_string();
        if session_name.is_empty() || index.is_empty() {
            continue;
        }
        grouped.entry(session_name).or_insert_with(Vec::new).push(WindowInfo {
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

fn build_selector_entries(
    sessions: &[SessionWithWindows],
    current_category: &str,
    category_order: &BTreeMap<String, i64>,
) -> Vec<SelectorEntry> {
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
        let activity = if delta <= ACTIVE_ACTIVITY_THRESHOLD_SECONDS { "*" } else { "·" };
        let state_symbol = if session.is_current {
            "●"
        } else if session.session.attached_clients > 0 {
            "○"
        } else {
            "·"
        };
        rows.push(SelectorEntry {
            action: "session".to_string(),
            name: session.session.name.clone(),
            display: format!(
                "{} {} {} | [{}] | win {} | pane {} | {}",
                state_symbol,
                activity,
                session.session.name,
                if session.session.category == current_category {
                    session.session.category.clone()
                } else {
                    session.session.category.clone()
                },
                session.total_windows,
                session.total_panes,
                if session.session.attached_clients > 0 {
                    format!("attached:{}", session.session.attached_clients)
                } else {
                    "detached".to_string()
                }
            ),
        });
        for (index, window) in session.windows.iter().enumerate() {
            let branch = if index + 1 == session.windows.len() {
                "└─"
            } else {
                "├─"
            };
            let marker = if window.active { "▸" } else { "·" };
            rows.push(SelectorEntry {
                action: "window".to_string(),
                name: format!("{}:{}", session.session.name, window.index),
                display: format!(
                    "  {} {} {}:{} {} | [{}] | pane {} | cmd {}",
                    branch,
                    marker,
                    session.session.name,
                    window.index,
                    truncate_visible(&window.name, 24),
                    session.session.category,
                    window.panes,
                    if window.command.is_empty() {
                        "-".to_string()
                    } else {
                        truncate_visible(&window.command, 28)
                    }
                ),
            });
        }
    }
    if sessions.len() > 1 {
        rows.push(SelectorEntry {
            action: "server".to_string(),
            name: String::new(),
            display: "  ✕ tmux server | tmux kill-server".to_string(),
        });
    }
    rows
}

fn normalize_refresh_ms(value: Option<&str>) -> i64 {
    value.and_then(|value| value.parse::<i64>().ok()).unwrap_or(0).max(0)
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
        format!("--preview-window={}", build_preview_window_option(preview_width)),
        "--bind=ctrl-d:preview-page-down".to_string(),
        "--bind=ctrl-u:preview-page-up".to_string(),
    ];
    if use_fzf_tmux {
        args.splice(0..0, [String::from("-p"), format!("{popup_width},{popup_height}")]);
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
    Some((action, parts.get(1).copied().unwrap_or("").trim().to_string()))
}

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn normalize_input_path(input_path: &str) -> Result<String> {
    let absolute = PathBuf::from(input_path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(input_path));
    let metadata = std::fs::metadata(&absolute)
        .with_context(|| format!("failed to stat {}", absolute.display()))?;
    if metadata.is_dir() {
        Ok(absolute.display().to_string())
    } else {
        Ok(absolute
            .parent()
            .unwrap_or_else(|| Path::new("/"))
            .display()
            .to_string())
    }
}

fn resolve_git_root(path: &str, env: &BTreeMap<String, String>) -> Result<Option<String>> {
    let options = CommandOptions {
        allow_fail: true,
        env: env.clone(),
        ..CommandOptions::default()
    };
    let result = run_command("git", ["-C", path, "rev-parse", "--show-toplevel"], &options)?;
    if result.exit_code != 0 {
        return Ok(None);
    }
    let root = result.stdout.trim();
    if root.is_empty() {
        Ok(None)
    } else {
        Ok(Some(root.to_string()))
    }
}

fn session_name_from_project_path(project_path: &str) -> Result<String> {
    let name = Path::new(project_path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default()
        .trim()
        .replace(':', "-");
    if name.is_empty() {
        return Err(anyhow!("failed to derive session name from path: {project_path}"));
    }
    Ok(name)
}

fn is_in_tmux(env: &BTreeMap<String, String>) -> bool {
    env.get("TMUX").map(|value| !value.is_empty()).unwrap_or(false)
}

fn update_session_metadata(tmux: &TmuxClient, session_name: &str, project_path: &str, category: &str) -> Result<()> {
    tmux.set_session_option(session_name, "project_path", project_path)?;
    tmux.set_session_option(session_name, "category", category)?;
    Ok(())
}

fn switch_project_session(ctx: &AppContext, tmux: &TmuxClient, config: &ResolvedConfig, input_path: &str) -> Result<()> {
    let normalized_input_path = normalize_input_path(input_path)?;
    let git_root = resolve_git_root(&normalized_input_path, &ctx.env)?;
    let project_path = git_root.unwrap_or(normalized_input_path);
    let ghq_root = resolve_ghq_root(Some(config), &ctx.env)?;
    let session_name = session_name_from_project_path(&project_path)?;
    let category = resolve_project_path_category(
        &config.categories,
        &project_path,
        ghq_root.as_deref(),
        &ctx.home_dir()?,
    );
    let sessions = ctx.list_session_details(tmux)?;
    if let Some(existing) = sessions.iter().find(|session| session.name == session_name) {
        if !existing.project_path.is_empty() && existing.project_path != project_path {
            return Err(anyhow!(
                "session name collision: {} is already bound to {}",
                session_name,
                existing.project_path
            ));
        }
    } else if is_in_tmux(&ctx.env) {
        tmux.new_session_detached_named(&session_name, &project_path)?;
    } else {
        tmux.new_session_interactive_named(&session_name, &project_path, true)?;
    }
    update_session_metadata(tmux, &session_name, &project_path, &category)?;
    ctx.invalidate_snapshot();
    if is_in_tmux(&ctx.env) {
        let sessions = ctx.list_session_details(tmux)?;
        switch_client_and_remember_session(
            tmux,
            config,
            &session_name,
            Some(&category),
            &ctx.home_dir()?,
            ghq_root.as_deref(),
            None,
            &sessions,
            false,
        )?;
    }
    Ok(())
}

fn add_pgids_from_output(output: &str, pgids: &mut BTreeSet<String>) {
    for token in output.split_whitespace() {
        if token.chars().all(|char| char.is_ascii_digit()) {
            pgids.insert(token.to_string());
        }
    }
}

fn normalize_pane_tty(tty: &str) -> String {
    let tty = tty.trim();
    if tty.is_empty() || tty == "?" || tty == "-" {
        return String::new();
    }
    tty.strip_prefix("/dev/").unwrap_or(tty).to_string()
}

fn collect_pane_pgids(pane: &PaneInfo, env: &BTreeMap<String, String>) -> Result<BTreeSet<String>> {
    let mut pgids = BTreeSet::new();
    let tty = normalize_pane_tty(&pane.tty);
    if !tty.is_empty() {
        let options = CommandOptions {
            allow_fail: true,
            env: env.clone(),
            ..CommandOptions::default()
        };
        let result = run_command("ps", ["-t", tty.as_str(), "-o", "pgid="], &options)?;
        add_pgids_from_output(&result.stdout, &mut pgids);
    }
    if pane.pid.chars().all(|char| char.is_ascii_digit()) {
        let options = CommandOptions {
            allow_fail: true,
            env: env.clone(),
            ..CommandOptions::default()
        };
        let result = run_command("ps", ["-o", "pgid=", "-p", pane.pid.as_str()], &options)?;
        add_pgids_from_output(&result.stdout, &mut pgids);
    }
    Ok(pgids)
}

fn clean_kill_target(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    target: &str,
    recursive: bool,
    single_pane: bool,
    include_current_pane: bool,
    finalize: impl FnOnce() -> Result<()>,
    env: &BTreeMap<String, String>,
) -> Result<()> {
    let panes = if single_pane {
        tmux.get_single_pane(target)?
    } else {
        tmux.list_panes(target, recursive)?
    };
    if panes.is_empty() {
        return finalize();
    }
    let current_pane = env.get("TMUX_PANE").cloned().unwrap_or_default();
    let panes_to_signal = if include_current_pane {
        panes.clone()
    } else {
        panes
            .into_iter()
            .filter(|pane| pane.id != current_pane)
            .collect::<Vec<_>>()
    };
    if config.session_manager.kill.send_ctrl_c {
        for pane in &panes_to_signal {
            tmux.send_ctrl_c(&pane.id)?;
        }
    }
    if !panes_to_signal.is_empty() {
        std::thread::sleep(Duration::from_millis(
            config.session_manager.kill.term_wait_ms.max(0) as u64,
        ));
    }
    let mut pgids = BTreeSet::new();
    for pane in &panes_to_signal {
        for pgid in collect_pane_pgids(pane, env)? {
            pgids.insert(pgid);
        }
    }
    for pgid in &pgids {
        let options = CommandOptions {
            allow_fail: true,
            env: env.clone(),
            ..CommandOptions::default()
        };
        let _ = run_command("kill", ["-TERM", &format!("-{pgid}")], &options)?;
    }
    if !pgids.is_empty() {
        std::thread::sleep(Duration::from_millis(
            config.session_manager.kill.term_wait_ms.max(0) as u64,
        ));
    }
    for pgid in &pgids {
        let options = CommandOptions {
            allow_fail: true,
            env: env.clone(),
            ..CommandOptions::default()
        };
        let check = run_command("ps", ["-o", "pid=", "-g", pgid.as_str()], &options)?;
        if !check.stdout.trim().is_empty() {
            let _ = run_command("kill", ["-KILL", &format!("-{pgid}")], &options)?;
        }
    }
    if !pgids.is_empty() {
        std::thread::sleep(Duration::from_millis(
            config.session_manager.kill.kill_wait_ms.max(0) as u64,
        ));
    }
    finalize()
}

fn switch_away_from_session(tmux: &TmuxClient, target: &str, env: &BTreeMap<String, String>) -> Result<()> {
    if !is_in_tmux(env) {
        return Ok(());
    }
    let current = tmux.current_session()?;
    if current != target {
        return Ok(());
    }
    let sessions = tmux.list_sessions()?;
    if sessions.len() <= 1 {
        return Ok(());
    }
    let names = sessions.iter().map(|session| session.name.clone()).collect::<Vec<_>>();
    let current_index = names.iter().position(|name| name == target).unwrap_or(0);
    let next_index = (current_index + 1) % names.len();
    if let Some(next) = names.get(next_index) {
        if next != target {
            tmux.switch_client(next)?;
        }
    }
    Ok(())
}

fn kill_session_clean(tmux: &TmuxClient, config: &ResolvedConfig, session_name: &str, env: &BTreeMap<String, String>) -> Result<()> {
    switch_away_from_session(tmux, session_name, env)?;
    clean_kill_target(
        tmux,
        config,
        &format!("{session_name}:"),
        true,
        false,
        false,
        || tmux.kill_session(session_name),
        env,
    )
}

fn kill_window_clean(tmux: &TmuxClient, config: &ResolvedConfig, target: &str, env: &BTreeMap<String, String>) -> Result<()> {
    clean_kill_target(
        tmux,
        config,
        target,
        false,
        false,
        false,
        || tmux.kill_window(target),
        env,
    )
}

fn kill_pane_clean(tmux: &TmuxClient, config: &ResolvedConfig, target: &str, env: &BTreeMap<String, String>) -> Result<()> {
    clean_kill_target(
        tmux,
        config,
        target,
        false,
        true,
        true,
        || tmux.kill_pane(target),
        env,
    )
}

fn kill_server_clean(tmux: &TmuxClient, config: &ResolvedConfig, env: &BTreeMap<String, String>) -> Result<()> {
    let sessions = tmux.list_sessions()?;
    let current = tmux.current_session()?;
    for session in &sessions {
        if session.name != current {
            kill_session_clean(tmux, config, &session.name, env)?;
        }
    }
    if !current.is_empty() {
        kill_session_clean(tmux, config, &current, env)?;
    }
    tmux.kill_server()
}

fn resolve_session_name_from_selection(action: &str, name: &str) -> String {
    match action {
        "session" => name.to_string(),
        "window" => split_window_target(name)
            .map(|(session_name, _)| session_name)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn open_popup_if_needed(
    tmux: &TmuxClient,
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
        env.get("HOME").cloned().unwrap_or_else(|| String::from("."))
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
    tmux: &TmuxClient,
    config: &ResolvedConfig,
) -> Result<Vec<SessionWithWindows>> {
    let ghq_root = resolve_ghq_root(Some(config), &ctx.env)?;
    let in_tmux = is_in_tmux(&ctx.env);
    let sessions = ctx.list_session_details(tmux)?;
    let current_session = if in_tmux { tmux.current_session()? } else { String::new() };
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
        let windows = windows_by_session.get(&session.name).cloned().unwrap_or_default();
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
    tmux: &TmuxClient,
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
                if let Some(fallback) = sessions.iter().find(|session| !targets.contains(&session.name)) {
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

fn run_session_manager(args: &[String], ctx: &AppContext) -> Result<CliResponse> {
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
        let refresh_ms = normalize_refresh_ms(ctx.env.get("PREVIEW_REFRESH_MS").map(String::as_str));
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
    let header_text =
        format!("Current [{current_category}] | Enter switch | C-q kill | C-t new | C-r rename | C-d/C-u scroll");
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

fn run_daemon_command(args: &[String], ctx: &AppContext) -> Result<CliResponse> {
    let socket = socket_path(&ctx.env);
    match args.first().map(String::as_str) {
        Some("serve") => {
            let Some(path) = args.get(1) else {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: "Usage: vtm daemon serve <socket-path>".to_string(),
                });
            };
            serve_daemon(Path::new(path))?;
            Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            })
        }
        Some("start") => {
            let socket = ensure_daemon_started(&ctx.env)?;
            Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: format!(
                    "protocol_version={PROTOCOL_VERSION}\nsocket_path={}\n",
                    socket.display()
                ),
                stderr: String::new(),
            })
        }
        Some("stop") => {
            let _ = send_daemon_request(&socket, &DaemonRequest::Shutdown);
            Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            })
        }
        Some("reload") => {
            let socket = ensure_daemon_started(&ctx.env)?;
            match send_daemon_request(&socket, &DaemonRequest::Reload)? {
                DaemonResponse::Ack => Ok(CliResponse {
                    exit_code: EXIT_OK,
                    stdout: String::new(),
                    stderr: String::new(),
                }),
                response => Err(anyhow!("unexpected daemon response: {:?}", response)),
            }
        }
        Some("status") | None => {
            let socket = ensure_daemon_started(&ctx.env)?;
            match send_daemon_request(&socket, &DaemonRequest::Status)? {
                DaemonResponse::Status(status) => Ok(CliResponse {
                    exit_code: EXIT_OK,
                    stdout: [
                        format!("socket_path={}", status.socket_path),
                        format!("pid={}", status.pid),
                        format!("uptime_seconds={}", status.uptime_seconds),
                        format!("protocol_version={}", status.protocol_version),
                        format!("config_generation={}", status.config_generation),
                        format!("snapshot_generation={}", status.snapshot_generation),
                        format!(
                            "last_full_resync={}",
                            status
                                .last_full_resync
                                .map(|value| value.to_string())
                                .unwrap_or_default()
                        ),
                        format!("last_error={}", status.last_error.unwrap_or_default()),
                    ]
                    .join("\n")
                        + "\n",
                    stderr: String::new(),
                }),
                response => Err(anyhow!("unexpected daemon response: {:?}", response)),
            }
        }
        _ => Ok(CliResponse {
            exit_code: EXIT_USAGE,
            stdout: String::new(),
            stderr: "Usage: vtm daemon <start|stop|status|reload>".to_string(),
        }),
    }
}

fn should_use_daemon(args: &[String], env: &BTreeMap<String, String>) -> bool {
    match args.first().map(String::as_str) {
        Some("statusline-category" | "statusline-sessions" | "category" | "session-cycle" | "hooks" | "session" | "sessions") => true,
        Some("project") => is_in_tmux(env),
        _ => false,
    }
}

fn forward_to_daemon(args: &[String], ctx: &AppContext) -> Result<CliResponse> {
    let socket = ensure_daemon_started(&ctx.env)?;
    let response = send_daemon_request(
        &socket,
        &DaemonRequest::Cli {
            args: args.to_vec(),
            env: ctx.env.clone(),
            cwd: ctx.cwd.as_ref().map(|value| value.display().to_string()),
        },
    )?;
    match response {
        DaemonResponse::Cli(response) => Ok(response),
        DaemonResponse::Error(message) => Err(anyhow!(message)),
        other => Err(anyhow!("unexpected daemon response: {:?}", other)),
    }
}

fn run_cli_with_context(args: &[String], ctx: &AppContext, allow_daemon_forward: bool) -> Result<CliResponse> {
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

    if allow_daemon_forward && should_use_daemon(args, &ctx.env) {
        return forward_to_daemon(args, ctx);
    }

    if args[0] == "daemon" {
        return run_daemon_command(&args[1..], ctx);
    }
    if args[0] == "session-manager" {
        return run_session_manager(&args[1..], ctx);
    }

    let tmux = ctx.tmux();
    let load = ctx.load_config()?;
    let config = load.config;
    let home_directory = ctx.home_dir()?;
    let ghq_root = resolve_ghq_root(Some(&config), &ctx.env)?;

    match args[0].as_str() {
        "statusline-category" => {
            if matches!(args.get(1).map(String::as_str), Some("-h" | "--help")) {
                return Ok(CliResponse {
                    exit_code: EXIT_OK,
                    stdout: "Usage: vtm statusline-category\n       vtm statusline-category switch <index>\n\nPrint the current tmux client category as a statusline segment or switch categories by index.\n".to_string(),
                    stderr: String::new(),
                });
            }
            if args.get(1).map(String::as_str) == Some("switch") {
                let Some(value) = args.get(2) else {
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
                        stderr: format!("vtm statusline-category: index must be a positive integer: {value}"),
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
                        stderr: format!("vtm statusline-category: category not found at index {target_index}"),
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
            if args.len() > 1 {
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
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: format!(
                    "{}\n",
                    render_statusline_category(&current_category, &ordered_categories, &config)
                ),
                stderr: String::new(),
            });
        }
        "statusline-sessions" => {
            if matches!(args.get(1).map(String::as_str), Some("-h" | "--help")) {
                return Ok(CliResponse {
                    exit_code: EXIT_OK,
                    stdout: "Usage: vtm statusline-sessions [--show-index]\n       vtm statusline-sessions switch <index>\n\nPrint tmux statusline session segments or switch sessions by index.\n".to_string(),
                    stderr: String::new(),
                });
            }
            if args.get(1).map(String::as_str) == Some("switch") {
                let Some(value) = args.get(2) else {
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
                        stderr: format!("vtm statusline-sessions: index must be a positive integer: {value}"),
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
                        stderr: format!("vtm statusline-sessions: session not found at index {target_index}"),
                    });
                };
                switch_client_and_remember_session(
                    &tmux,
                    &config,
                    &target_session.name,
                    Some(&current_category),
                    &home_directory,
                    ghq_root.as_deref(),
                    Some(&client_name),
                    &session_details,
                    true,
                )?;
                ctx.invalidate_snapshot();
                return Ok(CliResponse {
                    exit_code: EXIT_OK,
                    stdout: String::new(),
                    stderr: String::new(),
                });
            }
            let mut show_index_override = None::<bool>;
            for arg in &args[1..] {
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
            let current_session = tmux.current_session()?;
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
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: format!(
                    "{}\n",
                    render_statusline_sessions(&sessions, &current_session, &status_config)
                ),
                stderr: String::new(),
            });
        }
        "category" => {
            match args.get(1).map(String::as_str) {
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
                    let current_category = get_current_category(&tmux, &config)?;
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
                    ctx.invalidate_snapshot();
                    return Ok(CliResponse {
                        exit_code: EXIT_OK,
                        stdout: String::new(),
                        stderr: String::new(),
                    });
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
                    ctx.invalidate_snapshot();
                    return Ok(CliResponse {
                        exit_code: EXIT_OK,
                        stdout: String::new(),
                        stderr: String::new(),
                    });
                }
                _ => {
                    return Ok(CliResponse {
                        exit_code: EXIT_USAGE,
                        stdout: String::new(),
                        stderr: "Usage: vtm category use <name>\n       vtm category next\n       vtm category prev".to_string(),
                    });
                }
            }
        }
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
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            });
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
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            });
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
            ctx.invalidate_snapshot();
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            });
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
            ctx.invalidate_snapshot();
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            });
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
                    &home_directory,
                    ghq_root.as_deref(),
                    &sessions,
                    true,
                )?;
            } else {
                return Ok(CliResponse {
                    exit_code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: "Usage: vtm hooks on-client-session-changed [<client-name> <session-name>]".to_string(),
                });
            }
            return Ok(CliResponse {
                exit_code: EXIT_OK,
                stdout: String::new(),
                stderr: String::new(),
            });
        }
        _ => {
            return Ok(CliResponse {
                exit_code: EXIT_ERROR,
                stdout: String::new(),
                stderr: format!("[UNKNOWN_COMMAND] Unknown command: {}", args[0]),
            });
        }
    }
}

fn print_response(response: &CliResponse) {
    if !response.stdout.is_empty() {
        print!("{}", response.stdout);
    }
    if !response.stderr.is_empty() {
        eprintln!("{}", response.stderr);
    }
}

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let cwd = std::env::current_dir().ok();
    let ctx = AppContext::new(collect_env(), cwd, None);
    match run_cli_with_context(&args, &ctx, true) {
        Ok(response) => {
            print_response(&response);
            if response.exit_code != 0 {
                std::process::exit(response.exit_code);
            }
        }
        Err(error) => {
            eprintln!("[UNEXPECTED_ERROR] {error}");
            std::process::exit(EXIT_ERROR);
        }
    }
}
