use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{Context, Result, anyhow};

#[derive(Debug, Clone, Default)]
pub struct CommandOptions {
    pub allow_fail: bool,
    pub inherit_stdio: bool,
    pub cwd: Option<std::path::PathBuf>,
    pub env: BTreeMap<String, String>,
    pub input: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

fn build_env(overlay: &BTreeMap<String, String>) -> BTreeMap<OsString, OsString> {
    let mut merged = std::env::vars_os()
        .map(|(k, v)| (k, v))
        .collect::<BTreeMap<OsString, OsString>>();
    for (key, value) in overlay {
        merged.insert(OsString::from(key), OsString::from(value));
    }
    merged
}

pub fn run_command<I, S>(command: &str, args: I, options: &CommandOptions) -> Result<CommandResult>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut child = Command::new(command);
    child.args(args);
    if let Some(cwd) = &options.cwd {
        child.current_dir(cwd);
    }
    child.env_clear();
    child.envs(build_env(&options.env));

    if options.inherit_stdio {
        child.stdin(Stdio::inherit());
        child.stdout(Stdio::inherit());
        child.stderr(Stdio::inherit());
    } else {
        child.stdin(Stdio::piped());
        child.stdout(Stdio::piped());
        child.stderr(Stdio::piped());
    }

    let mut child = child
        .spawn()
        .with_context(|| format!("failed to spawn command: {command}"))?;

    if !options.inherit_stdio {
        if let Some(input) = &options.input {
            if let Some(stdin) = child.stdin.as_mut() {
                stdin
                    .write_all(input.as_bytes())
                    .with_context(|| format!("failed to write stdin for: {command}"))?;
            }
        }
    }

    let output = child
        .wait_with_output()
        .with_context(|| format!("failed to wait for command: {command}"))?;
    let exit_code = output.status.code().unwrap_or(1);
    let result = CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code,
    };

    if exit_code != 0 && !options.allow_fail {
        return Err(anyhow!(
            "{} exited with {}{}",
            command,
            exit_code,
            if result.stderr.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", result.stderr.trim())
            }
        ));
    }

    Ok(result)
}

pub fn command_exists(command: &str, env: &BTreeMap<String, String>) -> Result<bool> {
    let options = CommandOptions {
        allow_fail: true,
        env: env.clone(),
        ..CommandOptions::default()
    };
    let result = run_command(
        "sh",
        [
            "-lc",
            &format!(
                "command -v '{}' >/dev/null 2>&1",
                command.replace('\'', "'\\''")
            ),
        ],
        &options,
    )?;
    Ok(result.exit_code == 0)
}

pub fn file_mtime(path: &Path) -> Result<Option<std::time::SystemTime>> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(metadata.modified().ok()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("failed to stat {}", path.display())),
    }
}
