use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use anyhow::Result;
use vtm_core::command::{CommandOptions, run_command};
use vtm_core::config::ResolvedConfig;
use vtm_core::parse::PaneInfo;
use vtm_core::tmux::TmuxClient;

use crate::app_context::is_in_tmux;

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

struct CleanKillTarget<'a> {
    target: &'a str,
    recursive: bool,
    single_pane: bool,
    include_current_pane: bool,
    env: &'a BTreeMap<String, String>,
}

fn clean_kill_target(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    request: CleanKillTarget<'_>,
    finalize: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let panes = if request.single_pane {
        tmux.get_single_pane(request.target)?
    } else {
        tmux.list_panes(request.target, request.recursive)?
    };
    if panes.is_empty() {
        return finalize();
    }
    let current_pane = request.env.get("TMUX_PANE").cloned().unwrap_or_default();
    let panes_to_signal = if request.include_current_pane {
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
        for pgid in collect_pane_pgids(pane, request.env)? {
            pgids.insert(pgid);
        }
    }
    for pgid in &pgids {
        let options = CommandOptions {
            allow_fail: true,
            env: request.env.clone(),
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
            env: request.env.clone(),
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

fn switch_away_from_session(
    tmux: &TmuxClient,
    target: &str,
    env: &BTreeMap<String, String>,
) -> Result<()> {
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
    let names = sessions
        .iter()
        .map(|session| session.name.clone())
        .collect::<Vec<_>>();
    let current_index = names.iter().position(|name| name == target).unwrap_or(0);
    let next_index = (current_index + 1) % names.len();
    if let Some(next) = names.get(next_index)
        && next != target
    {
        tmux.switch_client(next)?;
    }
    Ok(())
}

pub fn kill_session_clean(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    session_name: &str,
    env: &BTreeMap<String, String>,
) -> Result<()> {
    switch_away_from_session(tmux, session_name, env)?;
    clean_kill_target(
        tmux,
        config,
        CleanKillTarget {
            target: &format!("{session_name}:"),
            recursive: true,
            single_pane: false,
            include_current_pane: false,
            env,
        },
        || tmux.kill_session(session_name),
    )
}

pub fn kill_window_clean(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    target: &str,
    env: &BTreeMap<String, String>,
) -> Result<()> {
    clean_kill_target(
        tmux,
        config,
        CleanKillTarget {
            target,
            recursive: false,
            single_pane: false,
            include_current_pane: false,
            env,
        },
        || tmux.kill_window(target),
    )
}

pub fn kill_pane_clean(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    target: &str,
    env: &BTreeMap<String, String>,
) -> Result<()> {
    clean_kill_target(
        tmux,
        config,
        CleanKillTarget {
            target,
            recursive: false,
            single_pane: true,
            include_current_pane: true,
            env,
        },
        || tmux.kill_pane(target),
    )
}

pub fn kill_server_clean(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    env: &BTreeMap<String, String>,
) -> Result<()> {
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

pub fn resolve_session_name_from_selection(action: &str, name: &str) -> String {
    match action {
        "session" => name.to_string(),
        "window" => vtm_core::parse::split_window_target(name)
            .map(|(session_name, _)| session_name)
            .unwrap_or_default(),
        _ => String::new(),
    }
}
