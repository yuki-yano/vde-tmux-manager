use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use vtm_core::command::{CommandOptions, run_command};
use vtm_core::config::ResolvedConfig;
use vtm_core::matcher::resolve_project_path_category;
use vtm_core::runtime::resolve_ghq_root;
use vtm_core::state::{
    SessionResolutionContext, SwitchClientSessionRequest, switch_client_and_remember_session,
};
use vtm_core::tmux::TmuxClient;

use crate::app_context::{AppContext, is_in_tmux};

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

fn resolve_git_root(
    path: &str,
    env: &std::collections::BTreeMap<String, String>,
) -> Result<Option<String>> {
    let options = CommandOptions {
        allow_fail: true,
        env: env.clone(),
        ..CommandOptions::default()
    };
    let result = run_command(
        "git",
        ["-C", path, "rev-parse", "--show-toplevel"],
        &options,
    )?;
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
        .replace([':', '.'], "-");
    if name.is_empty() {
        return Err(anyhow!(
            "failed to derive session name from path: {project_path}"
        ));
    }
    Ok(name)
}

fn update_session_metadata(
    tmux: &TmuxClient,
    session_name: &str,
    project_path: &str,
    category: &str,
) -> Result<()> {
    tmux.set_session_option(session_name, "project_path", project_path)?;
    tmux.set_session_option(session_name, "category", category)?;
    Ok(())
}

pub fn switch_project_session(
    ctx: &AppContext,
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    input_path: &str,
) -> Result<()> {
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
    if is_in_tmux(&ctx.env) {
        let sessions = ctx.list_session_details(tmux)?;
        let home_directory = ctx.home_dir()?;
        switch_client_and_remember_session(
            tmux,
            config,
            SwitchClientSessionRequest {
                session_name: &session_name,
                category_name: Some(&category),
                client_name: None,
                skip_current_category_update: false,
            },
            SessionResolutionContext {
                home_directory: &home_directory,
                ghq_root: ghq_root.as_deref(),
                sessions: &sessions,
            },
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::session_name_from_project_path;

    #[test]
    fn replaces_dots_in_project_basename_for_tmux_session_name() {
        let session_name = session_name_from_project_path("/tmp/github.com/example/foo.bar")
            .expect("session name");

        assert_eq!(session_name, "foo-bar");
    }
}
