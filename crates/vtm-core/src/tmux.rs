use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::Result;

use crate::command::{CommandOptions, CommandResult, run_command};
use crate::parse::{
    ClientInfo, PaneInfo, SessionDetails, SessionIdentity, SessionMeta, WindowInfo,
    parse_client_list, parse_pane_list, parse_session_details_list, parse_session_identity_list,
    parse_session_list, parse_window_list,
};

#[derive(Debug, Clone)]
pub struct TmuxClient {
    env: BTreeMap<String, String>,
    cwd: Option<PathBuf>,
}

impl TmuxClient {
    pub fn new(env: BTreeMap<String, String>) -> Self {
        Self { env, cwd: None }
    }

    pub fn with_cwd(mut self, cwd: Option<PathBuf>) -> Self {
        self.cwd = cwd;
        self
    }

    pub fn env(&self) -> &BTreeMap<String, String> {
        &self.env
    }

    fn options(&self, allow_fail: bool) -> CommandOptions {
        CommandOptions {
            allow_fail,
            cwd: self.cwd.clone(),
            env: self.env.clone(),
            ..CommandOptions::default()
        }
    }

    pub fn run<S>(&self, args: &[S], allow_fail: bool) -> Result<CommandResult>
    where
        S: AsRef<str>,
    {
        let argv = args.iter().map(|value| value.as_ref()).collect::<Vec<_>>();
        run_command("tmux", argv, &self.options(allow_fail))
    }

    pub fn current_session(&self) -> Result<String> {
        Ok(self
            .run(&["display-message", "-p", "#{session_name}"], true)?
            .stdout
            .trim()
            .to_string())
    }

    pub fn current_client_name(&self) -> Result<String> {
        Ok(self
            .run(&["display-message", "-p", "#{client_name}"], true)?
            .stdout
            .trim()
            .to_string())
    }

    pub fn current_client_session(&self) -> Result<String> {
        Ok(self
            .run(&["display-message", "-p", "#{client_session}"], true)?
            .stdout
            .trim()
            .to_string())
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
        let result = self.run(
            &[
                "list-sessions",
                "-F",
                "#{session_name}\t#{session_attached}\t#{session_activity}",
            ],
            true,
        )?;
        Ok(parse_session_list(&result.stdout))
    }

    pub fn list_session_details(&self) -> Result<Vec<SessionDetails>> {
        let result = self.run(
            &[
                "list-sessions",
                "-F",
                "#{session_id}\t#{session_name}\t#{session_attached}\t#{session_activity}\t#{@category}\t#{@project_path}\t#{@category_override}",
            ],
            true,
        )?;
        Ok(parse_session_details_list(&result.stdout))
    }

    pub fn list_session_identities(&self) -> Result<Vec<SessionIdentity>> {
        let result = self.run(
            &["list-sessions", "-F", "#{session_id}\t#{session_name}"],
            true,
        )?;
        Ok(parse_session_identity_list(&result.stdout))
    }

    pub fn list_clients(&self) -> Result<Vec<ClientInfo>> {
        let result = self.run(&["list-clients", "-F", "#{client_name}"], true)?;
        Ok(parse_client_list(&result.stdout))
    }

    pub fn list_windows(&self, session_name: &str) -> Result<Vec<WindowInfo>> {
        let result = self.run(
            &[
                "list-windows",
                "-t",
                &format!("{session_name}:"),
                "-F",
                "#{window_index}\t#{window_panes}\t#{window_active}\t#{window_name}\t#{pane_current_command}",
            ],
            true,
        )?;
        Ok(parse_window_list(&result.stdout))
    }

    pub fn list_panes(&self, target: &str, recursive: bool) -> Result<Vec<PaneInfo>> {
        let result = if recursive {
            self.run(
                &[
                    "list-panes",
                    "-s",
                    "-t",
                    target,
                    "-F",
                    "#{pane_id}\t#{pane_pid}\t#{pane_tty}",
                ],
                true,
            )?
        } else {
            self.run(
                &[
                    "list-panes",
                    "-t",
                    target,
                    "-F",
                    "#{pane_id}\t#{pane_pid}\t#{pane_tty}",
                ],
                true,
            )?
        };
        Ok(parse_pane_list(&result.stdout))
    }

    pub fn get_single_pane(&self, target: &str) -> Result<Vec<PaneInfo>> {
        let result = self.run(
            &[
                "display-message",
                "-p",
                "-t",
                target,
                "#{pane_id}\t#{pane_pid}\t#{pane_tty}",
            ],
            true,
        )?;
        Ok(parse_pane_list(&result.stdout))
    }

    pub fn capture_pane_tail(&self, target: &str, tail_lines: i64) -> Result<Vec<String>> {
        if tail_lines <= 0 {
            return Ok(Vec::new());
        }
        let result = self.run(
            &["capture-pane", "-t", target, "-J", "-N", "-e", "-p"],
            true,
        )?;
        let mut lines = result
            .stdout
            .replace('\r', "")
            .lines()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        while matches!(lines.last(), Some(last) if last.is_empty()) {
            lines.pop();
        }
        let keep = tail_lines.max(0) as usize;
        if lines.len() > keep {
            Ok(lines[lines.len() - keep..].to_vec())
        } else {
            Ok(lines)
        }
    }

    pub fn pane_current_path(&self, target: &str) -> Result<String> {
        Ok(self
            .run(
                &[
                    "display-message",
                    "-p",
                    "-t",
                    target,
                    "#{pane_current_path}",
                ],
                true,
            )?
            .stdout
            .trim()
            .to_string())
    }

    pub fn show_session_option(&self, target: &str, name: &str) -> Result<String> {
        Ok(self
            .run(
                &["show-option", "-qv", "-t", target, &format!("@{name}")],
                true,
            )?
            .stdout
            .trim()
            .to_string())
    }

    pub fn set_session_option(&self, target: &str, name: &str, value: &str) -> Result<()> {
        self.run(
            &["set-option", "-q", "-t", target, &format!("@{name}"), value],
            true,
        )?;
        Ok(())
    }

    pub fn unset_session_option(&self, target: &str, name: &str) -> Result<()> {
        self.run(
            &["set-option", "-qu", "-t", target, &format!("@{name}")],
            true,
        )?;
        Ok(())
    }

    fn encode_scope_key(value: &str) -> String {
        let encoded = value
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        if encoded.is_empty() {
            "0".to_string()
        } else {
            encoded
        }
    }

    fn client_option_name(target: &str, name: &str) -> String {
        format!("@client_{}_{}", Self::encode_scope_key(target), name)
    }

    pub fn show_client_option(&self, target: &str, name: &str) -> Result<String> {
        Ok(self
            .run(
                &[
                    "show-option",
                    "-sqv",
                    &Self::client_option_name(target, name),
                ],
                true,
            )?
            .stdout
            .trim()
            .to_string())
    }

    pub fn set_client_option(&self, target: &str, name: &str, value: &str) -> Result<()> {
        self.run(
            &[
                "set-option",
                "-sq",
                &Self::client_option_name(target, name),
                value,
            ],
            true,
        )?;
        Ok(())
    }

    pub fn switch_client(&self, target: &str) -> Result<()> {
        self.run(&["switch-client", "-t", target], true)?;
        Ok(())
    }

    pub fn attach_session(&self, target: &str, inherit_stdio: bool) -> Result<()> {
        let options = CommandOptions {
            allow_fail: true,
            inherit_stdio,
            cwd: self.cwd.clone(),
            env: self.env.clone(),
            ..CommandOptions::default()
        };
        run_command("tmux", ["attach", "-t", target], &options)?;
        Ok(())
    }

    pub fn select_window(&self, target: &str) -> Result<()> {
        self.run(&["select-window", "-t", target], true)?;
        Ok(())
    }

    pub fn new_session_detached(&self) -> Result<String> {
        Ok(self
            .run(&["new-session", "-d", "-P", "-F", "#{session_name}"], true)?
            .stdout
            .trim()
            .to_string())
    }

    pub fn new_session_detached_named(&self, target: &str, cwd: &str) -> Result<()> {
        self.run(&["new-session", "-d", "-s", target, "-c", cwd], true)?;
        Ok(())
    }

    pub fn new_session_interactive(&self, inherit_stdio: bool) -> Result<()> {
        let options = CommandOptions {
            allow_fail: true,
            inherit_stdio,
            cwd: self.cwd.clone(),
            env: self.env.clone(),
            ..CommandOptions::default()
        };
        run_command("tmux", ["new-session"], &options)?;
        Ok(())
    }

    pub fn new_session_interactive_named(
        &self,
        target: &str,
        cwd: &str,
        inherit_stdio: bool,
    ) -> Result<()> {
        let options = CommandOptions {
            allow_fail: true,
            inherit_stdio,
            cwd: self.cwd.clone(),
            env: self.env.clone(),
            ..CommandOptions::default()
        };
        run_command("tmux", ["new-session", "-s", target, "-c", cwd], &options)?;
        Ok(())
    }

    pub fn rename_session(&self, target: &str, next: &str) -> Result<()> {
        self.run(&["rename-session", "-t", target, next], true)?;
        Ok(())
    }

    pub fn send_ctrl_c(&self, pane_id: &str) -> Result<()> {
        self.run(&["send-keys", "-t", pane_id, "C-c"], true)?;
        Ok(())
    }

    pub fn kill_session(&self, target: &str) -> Result<()> {
        self.run(&["kill-session", "-t", target], true)?;
        Ok(())
    }

    pub fn kill_window(&self, target: &str) -> Result<()> {
        self.run(&["kill-window", "-t", target], true)?;
        Ok(())
    }

    pub fn kill_pane(&self, target: &str) -> Result<()> {
        self.run(&["kill-pane", "-t", target], true)?;
        Ok(())
    }

    pub fn kill_server(&self) -> Result<()> {
        self.run(&["kill-server"], true)?;
        Ok(())
    }
}
