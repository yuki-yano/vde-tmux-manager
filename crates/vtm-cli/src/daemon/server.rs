use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use vtm_core::export::StateExport;

use crate::app_context::AppContext;
use crate::cli::dispatch::run_cli_with_context;
use crate::cli::{CliResponse, EXIT_ERROR};
use crate::daemon::cache::{DaemonSharedState, PROTOCOL_VERSION};
use crate::daemon::protocol::{DaemonRequest, DaemonResponse, DaemonStatus};

const SUBSCRIBE_POLL_MS: u64 = 500;

pub fn runtime_directory(env: &BTreeMap<String, String>) -> PathBuf {
    if let Some(runtime_dir) = env
        .get("XDG_RUNTIME_DIR")
        .filter(|value| !value.trim().is_empty())
    {
        return PathBuf::from(runtime_dir).join("vde-tmux-manager");
    }
    std::env::temp_dir().join("vde-tmux-manager")
}

pub fn socket_path(env: &BTreeMap<String, String>) -> PathBuf {
    runtime_directory(env).join("daemon.sock")
}

pub fn write_frame<T: Serialize>(stream: &mut UnixStream, payload: &T) -> Result<()> {
    let bytes = serde_json::to_vec(payload)?;
    let length = bytes.len() as u64;
    stream.write_all(&length.to_be_bytes())?;
    stream.write_all(&bytes)?;
    Ok(())
}

pub fn read_frame<T: for<'de> Deserialize<'de>>(stream: &mut UnixStream) -> Result<T> {
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

pub fn send_daemon_request(path: &Path, request: &DaemonRequest) -> Result<DaemonResponse> {
    let mut stream = connect_socket(path)?;
    write_frame(&mut stream, request)?;
    read_frame(&mut stream)
}

pub fn stream_daemon_state_exports(
    path: &Path,
    env: BTreeMap<String, String>,
    cwd: Option<String>,
    mut on_export: impl FnMut(StateExport) -> Result<()>,
) -> Result<()> {
    let mut stream = connect_socket(path)?;
    write_frame(&mut stream, &DaemonRequest::Subscribe { env, cwd })?;
    loop {
        match read_frame::<DaemonResponse>(&mut stream)? {
            DaemonResponse::StateExport(export) => on_export(export)?,
            DaemonResponse::Error(message) => return Err(anyhow!(message)),
            other => return Err(anyhow!("unexpected daemon response: {:?}", other)),
        }
    }
}

pub fn ensure_daemon_started(env: &BTreeMap<String, String>) -> Result<PathBuf> {
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
        if let Ok(DaemonResponse::Status(_)) = send_daemon_request(&socket, &DaemonRequest::Status)
        {
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

fn build_state_export_for_subscription(
    shared: &Arc<Mutex<DaemonSharedState>>,
    env: &BTreeMap<String, String>,
    cwd: &Option<PathBuf>,
) -> Result<StateExport> {
    let ctx = AppContext::new(env.clone(), cwd.clone(), Some(shared.clone()));
    let response = run_cli_with_context(
        &[
            String::from("export"),
            String::from("state"),
            String::from("--json"),
        ],
        &ctx,
        false,
    )?;
    if response.exit_code != 0 {
        return Err(anyhow!(response.stderr));
    }
    Ok(serde_json::from_str(&response.stdout)?)
}

fn serve_subscription(
    mut stream: UnixStream,
    shared: Arc<Mutex<DaemonSharedState>>,
    env: BTreeMap<String, String>,
    cwd: Option<PathBuf>,
) {
    let mut last_payload = None::<String>;
    loop {
        let export = match build_state_export_for_subscription(&shared, &env, &cwd) {
            Ok(export) => export,
            Err(error) => {
                let _ = write_frame(&mut stream, &DaemonResponse::Error(error.to_string()));
                return;
            }
        };
        let payload = match serde_json::to_string(&export) {
            Ok(payload) => payload,
            Err(error) => {
                let _ = write_frame(&mut stream, &DaemonResponse::Error(error.to_string()));
                return;
            }
        };
        if last_payload.as_deref() != Some(payload.as_str()) {
            if write_frame(&mut stream, &DaemonResponse::StateExport(export)).is_err() {
                return;
            }
            last_payload = Some(payload);
        }
        std::thread::sleep(Duration::from_millis(SUBSCRIBE_POLL_MS));
    }
}

pub fn serve_daemon(socket: &Path) -> Result<()> {
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
            DaemonRequest::Status => {
                DaemonResponse::Status(daemon_status_from_state(&shared, socket))
            }
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
            DaemonRequest::Subscribe { env, cwd } => {
                let shared = shared.clone();
                let cwd = cwd.map(PathBuf::from);
                std::thread::spawn(move || serve_subscription(stream, shared, env, cwd));
                continue;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip() {
        let (mut left, mut right) = UnixStream::pair().expect("stream pair");
        let request = DaemonRequest::Cli {
            args: vec!["statusline-category".to_string()],
            env: BTreeMap::from([(String::from("HOME"), String::from("/tmp/home"))]),
            cwd: Some(String::from("/tmp/work")),
        };
        write_frame(&mut left, &request).expect("write");
        let decoded = read_frame::<DaemonRequest>(&mut right).expect("read");
        match decoded {
            DaemonRequest::Cli { args, env, cwd } => {
                assert_eq!(args, vec![String::from("statusline-category")]);
                assert_eq!(env.get("HOME"), Some(&String::from("/tmp/home")));
                assert_eq!(cwd.as_deref(), Some("/tmp/work"));
            }
            other => panic!("unexpected payload: {other:?}"),
        }
    }

    #[test]
    fn subscribe_frame_roundtrip() {
        let (mut left, mut right) = UnixStream::pair().expect("stream pair");
        let request = DaemonRequest::Subscribe {
            env: BTreeMap::from([(String::from("HOME"), String::from("/tmp/home"))]),
            cwd: Some(String::from("/tmp/work")),
        };
        write_frame(&mut left, &request).expect("write");
        let decoded = read_frame::<DaemonRequest>(&mut right).expect("read");
        match decoded {
            DaemonRequest::Subscribe { env, cwd } => {
                assert_eq!(env.get("HOME"), Some(&String::from("/tmp/home")));
                assert_eq!(cwd.as_deref(), Some("/tmp/work"));
            }
            other => panic!("unexpected payload: {other:?}"),
        }
    }
}
