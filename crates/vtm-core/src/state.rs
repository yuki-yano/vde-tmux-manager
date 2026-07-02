use anyhow::{Result, anyhow};

use crate::config::ResolvedConfig;
use crate::matcher::{collect_defined_categories, resolve_category_for_session, sort_categories};
use crate::parse::SessionDetails;
use crate::tmux::TmuxClient;

const CURRENT_CATEGORY_OPTION: &str = "current_category";
const CATEGORY_OPTION: &str = "category";
const CATEGORY_OVERRIDE_OPTION: &str = "category_override";
const CATEGORY_LAST_SESSION_OPTION_PREFIX: &str = "category_last_session_";

fn ensure_known_category(config: &ResolvedConfig, category_name: &str) -> Result<String> {
    let normalized = category_name.trim();
    let defined = collect_defined_categories(&config.categories);
    if !defined.iter().any(|category| category == normalized) {
        return Err(anyhow!("unknown category: {normalized}"));
    }
    Ok(normalized.to_string())
}

pub fn get_ordered_categories(config: &ResolvedConfig) -> Vec<String> {
    sort_categories(
        &collect_defined_categories(&config.categories),
        &config.categories.order,
    )
}

pub fn resolve_effective_session_category(
    session: &SessionDetails,
    config: &ResolvedConfig,
    home_directory: &str,
    ghq_root: Option<&str>,
) -> String {
    if !session.project_path.trim().is_empty() || !session.category_override.trim().is_empty() {
        return resolve_category_for_session(
            &config.categories,
            &session.name,
            &session.project_path,
            Some(&session.category_override),
            ghq_root,
            home_directory,
        );
    }
    if !session.category.trim().is_empty() {
        return session.category.trim().to_string();
    }
    resolve_category_for_session(
        &config.categories,
        &session.name,
        "",
        None,
        ghq_root,
        home_directory,
    )
}

pub fn get_sessions_in_category(
    sessions: &[SessionDetails],
    category_name: &str,
    config: &ResolvedConfig,
    home_directory: &str,
    ghq_root: Option<&str>,
) -> Vec<SessionDetails> {
    sessions
        .iter()
        .filter(|session| {
            resolve_effective_session_category(session, config, home_directory, ghq_root)
                == category_name
        })
        .cloned()
        .collect()
}

pub fn get_ordered_categories_with_sessions(
    sessions: &[SessionDetails],
    config: &ResolvedConfig,
    home_directory: &str,
    ghq_root: Option<&str>,
) -> Vec<String> {
    let categories = sessions
        .iter()
        .map(|session| {
            resolve_effective_session_category(session, config, home_directory, ghq_root)
        })
        .collect::<std::collections::BTreeSet<_>>();
    get_ordered_categories(config)
        .into_iter()
        .filter(|category| categories.contains(category))
        .collect()
}

pub fn resolve_adjacent_category(
    current_category: &str,
    direction: &str,
    ordered_categories: &[String],
) -> Result<String> {
    if ordered_categories.is_empty() {
        return Err(anyhow!("no categories defined"));
    }
    let current_index = ordered_categories
        .iter()
        .position(|category| category == current_category);
    let index = match current_index {
        Some(index) => index,
        None if direction == "next" => 0,
        None => ordered_categories.len() - 1,
    };
    let next_index = if direction == "next" {
        (index + 1) % ordered_categories.len()
    } else {
        (index + ordered_categories.len() - 1) % ordered_categories.len()
    };
    Ok(ordered_categories[next_index].clone())
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

fn category_last_session_option_name(category_name: &str) -> String {
    format!(
        "{CATEGORY_LAST_SESSION_OPTION_PREFIX}{}",
        encode_scope_key(category_name)
    )
}

fn require_current_client_name(tmux: &TmuxClient, error_message: &str) -> Result<String> {
    let client_name = tmux.current_client_name()?;
    if client_name.is_empty() {
        return Err(anyhow!(error_message.to_string()));
    }
    Ok(client_name)
}

fn read_client_context(tmux: &TmuxClient, error_message: &str) -> Result<(String, String)> {
    let client_name = require_current_client_name(tmux, error_message)?;
    let session_name = tmux.current_client_session()?;
    Ok((client_name, session_name))
}

fn write_category_last_session_for_client(
    tmux: &TmuxClient,
    client_name: &str,
    category_name: &str,
    session_name: &str,
) -> Result<()> {
    tmux.set_client_option(
        client_name,
        &category_last_session_option_name(category_name),
        session_name,
    )?;
    Ok(())
}

fn write_current_category_for_client(
    tmux: &TmuxClient,
    client_name: &str,
    category_name: &str,
) -> Result<()> {
    tmux.set_client_option(client_name, CURRENT_CATEGORY_OPTION, category_name)?;
    Ok(())
}

fn read_current_category_for_client(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    client_name: &str,
) -> Result<String> {
    let category = tmux.show_client_option(client_name, CURRENT_CATEGORY_OPTION)?;
    if category.is_empty() {
        return Ok(config.categories.default_category.clone());
    }
    ensure_known_category(config, &category)
}

fn read_category_last_active_session_for_client(
    tmux: &TmuxClient,
    client_name: &str,
    category_name: &str,
) -> Result<Option<String>> {
    let session_name = tmux.show_client_option(
        client_name,
        &category_last_session_option_name(category_name),
    )?;
    if session_name.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(session_name))
    }
}

fn find_session_by_name<'a>(
    sessions: &'a [SessionDetails],
    session_name: &str,
) -> Option<&'a SessionDetails> {
    sessions.iter().find(|session| session.name == session_name)
}

pub fn get_current_category(tmux: &TmuxClient, config: &ResolvedConfig) -> Result<String> {
    match require_current_client_name(tmux, "current category requires tmux client context") {
        Ok(client_name) => read_current_category_for_client(tmux, config, &client_name),
        Err(_) => Ok(config.categories.default_category.clone()),
    }
}

pub fn remember_session_for_client(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    client_name: &str,
    session_name: &str,
    home_directory: &str,
    ghq_root: Option<&str>,
    sessions: &[SessionDetails],
    write_current_category: bool,
) -> Result<Option<String>> {
    let Some(session) = find_session_by_name(sessions, session_name) else {
        return Ok(None);
    };
    let category_name =
        resolve_effective_session_category(session, config, home_directory, ghq_root);
    if write_current_category {
        write_current_category_for_client(tmux, client_name, &category_name)?;
    }
    write_category_last_session_for_client(tmux, client_name, &category_name, session_name)?;
    Ok(Some(category_name))
}

pub fn remember_current_session_for_current_client(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    home_directory: &str,
    ghq_root: Option<&str>,
    client_name: Option<&str>,
    sessions: &[SessionDetails],
    write_current_category: bool,
) -> Result<Option<String>> {
    let client_name = match client_name {
        Some(client_name) => client_name.to_string(),
        None => require_current_client_name(
            tmux,
            "remember current session requires tmux client context",
        )?,
    };
    let session_name = tmux.current_client_session()?;
    if session_name.is_empty() {
        return Ok(None);
    }
    let remembered = remember_session_for_client(
        tmux,
        config,
        &client_name,
        &session_name,
        home_directory,
        ghq_root,
        sessions,
        write_current_category,
    )?;
    Ok(remembered.map(|_| session_name))
}

pub fn resolve_session_category_by_name(
    sessions: &[SessionDetails],
    config: &ResolvedConfig,
    session_name: &str,
    home_directory: &str,
    ghq_root: Option<&str>,
) -> Result<String> {
    let session = find_session_by_name(sessions, session_name)
        .ok_or_else(|| anyhow!("session not found: {session_name}"))?;
    Ok(resolve_effective_session_category(
        session,
        config,
        home_directory,
        ghq_root,
    ))
}

pub fn switch_client_and_remember_session(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    session_name: &str,
    category_name: Option<&str>,
    home_directory: &str,
    ghq_root: Option<&str>,
    client_name: Option<&str>,
    sessions: &[SessionDetails],
    skip_current_category_update: bool,
) -> Result<String> {
    let resolved_client = match client_name {
        Some(value) if !value.is_empty() => value.to_string(),
        _ => require_current_client_name(tmux, "switch session requires tmux client context")?,
    };
    let resolved_category = match category_name {
        Some(value) if !value.is_empty() => value.to_string(),
        _ => resolve_session_category_by_name(
            sessions,
            config,
            session_name,
            home_directory,
            ghq_root,
        )?,
    };
    tmux.switch_client(session_name)?;
    if !skip_current_category_update {
        write_current_category_for_client(tmux, &resolved_client, &resolved_category)?;
    }
    write_category_last_session_for_client(
        tmux,
        &resolved_client,
        &resolved_category,
        session_name,
    )?;
    Ok(session_name.to_string())
}

pub fn cycle_session_in_current_category(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    direction: &str,
    home_directory: &str,
    ghq_root: Option<&str>,
    sessions: &[SessionDetails],
) -> Result<Option<String>> {
    let (client_name, current_session) =
        read_client_context(tmux, "session cycle requires tmux client context")?;
    let current_category = read_current_category_for_client(tmux, config, &client_name)?;
    let sessions = get_sessions_in_category(
        sessions,
        &current_category,
        config,
        home_directory,
        ghq_root,
    );
    if sessions.is_empty() {
        return Ok(None);
    }
    let names = sessions
        .iter()
        .map(|session| session.name.clone())
        .collect::<Vec<_>>();
    let current_index = names
        .iter()
        .position(|name| name == &current_session)
        .unwrap_or(0);
    let next_index = if direction == "next" {
        (current_index + 1) % names.len()
    } else {
        (current_index + names.len() - 1) % names.len()
    };
    let target = names.get(next_index).cloned();
    let Some(target) = target else {
        return Ok(None);
    };
    if target == current_session {
        write_category_last_session_for_client(tmux, &client_name, &current_category, &target)?;
        return Ok(Some(target));
    }
    switch_client_and_remember_session(
        tmux,
        config,
        &target,
        Some(&current_category),
        home_directory,
        ghq_root,
        Some(&client_name),
        &sessions,
        true,
    )?;
    Ok(Some(target))
}

pub fn use_category_and_switch_to_last_session(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    category_name: &str,
    home_directory: &str,
    ghq_root: Option<&str>,
    sessions: &[SessionDetails],
) -> Result<Option<String>> {
    let (client_name, current_session) =
        read_client_context(tmux, "category use requires tmux client context")?;
    let normalized_category = ensure_known_category(config, category_name)?;

    if let Some(current_session_details) = (!current_session.is_empty())
        .then(|| find_session_by_name(sessions, &current_session))
        .flatten()
    {
        if resolve_effective_session_category(
            current_session_details,
            config,
            home_directory,
            ghq_root,
        ) != normalized_category
        {
            remember_session_for_client(
                tmux,
                config,
                &client_name,
                &current_session,
                home_directory,
                ghq_root,
                sessions,
                false,
            )?;
        }
    }

    let category_sessions = get_sessions_in_category(
        sessions,
        &normalized_category,
        config,
        home_directory,
        ghq_root,
    );
    if category_sessions.is_empty() {
        write_current_category_for_client(tmux, &client_name, &normalized_category)?;
        return Ok(None);
    }
    let last_active =
        read_category_last_active_session_for_client(tmux, &client_name, &normalized_category)?;
    let target = category_sessions
        .iter()
        .find(|session| Some(session.name.as_str()) == last_active.as_deref())
        .map(|session| session.name.clone())
        .or_else(|| {
            category_sessions
                .first()
                .map(|session| session.name.clone())
        });

    let Some(target) = target else {
        return Ok(None);
    };
    if target == current_session {
        write_current_category_for_client(tmux, &client_name, &normalized_category)?;
        write_category_last_session_for_client(tmux, &client_name, &normalized_category, &target)?;
        return Ok(Some(target));
    }
    switch_client_and_remember_session(
        tmux,
        config,
        &target,
        Some(&normalized_category),
        home_directory,
        ghq_root,
        Some(&client_name),
        sessions,
        false,
    )?;
    Ok(Some(target))
}

pub fn refresh_session_categories(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    home_directory: &str,
    ghq_root: Option<&str>,
    sessions: &[SessionDetails],
) -> Result<Vec<(String, String)>> {
    let mut updated = Vec::new();
    for session in sessions {
        let category =
            resolve_effective_session_category(session, config, home_directory, ghq_root);
        tmux.set_session_option(&session.name, CATEGORY_OPTION, &category)?;
        updated.push((session.name.clone(), category));
    }
    Ok(updated)
}

pub fn set_session_category_override(
    tmux: &TmuxClient,
    config: &ResolvedConfig,
    session_name: &str,
    category_name: &str,
) -> Result<String> {
    let normalized = ensure_known_category(config, category_name)?;
    tmux.set_session_option(session_name, CATEGORY_OVERRIDE_OPTION, &normalized)?;
    tmux.set_session_option(session_name, CATEGORY_OPTION, &normalized)?;
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::config::default_config;
    use crate::parse::SessionDetails;

    use super::cycle_session_in_current_category;
    use crate::tmux::TmuxClient;

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
  printf 'client-a\n'
  exit 0
fi
if [ "$1" = "display-message" ] && [ "$2" = "-p" ] && [ "$3" = "#{session_name}" ]; then
  printf 'baz\n'
  exit 0
fi
if [ "$1" = "display-message" ] && [ "$2" = "-p" ] && [ "$3" = "#{client_session}" ]; then
  printf 'foo-bar\n'
  exit 0
fi
if [ "$1" = "show-option" ]; then
  printf 'public\n'
  exit 0
fi
if [ "$1" = "set-option" ]; then
  exit 0
fi
if [ "$1" = "switch-client" ] && [ "$2" = "-t" ]; then
  printf '%s\n' "$3" > "$VTM_TEST_SWITCH_TARGET"
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

    fn session(name: &str) -> SessionDetails {
        SessionDetails {
            id: format!("${name}"),
            name: name.to_string(),
            attached_clients: 0,
            last_activity: 0,
            category: "public".to_string(),
            project_path: String::new(),
            category_override: String::new(),
        }
    }

    #[test]
    fn cycle_uses_current_client_session_when_run_shell_session_is_stale() {
        let temp_dir = unique_temp_dir("state-cycle");
        let bin_dir = temp_dir.join("bin");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        install_fake_tmux(&bin_dir);
        let switch_target_path = temp_dir.join("switch-target");
        let path_value = std::env::var("PATH").unwrap_or_default();
        let tmux = TmuxClient::new(BTreeMap::from([
            (
                String::from("PATH"),
                format!("{}:{}", bin_dir.display(), path_value),
            ),
            (
                String::from("VTM_TEST_SWITCH_TARGET"),
                switch_target_path.display().to_string(),
            ),
        ]));
        let mut config = default_config();
        config.categories.default_category = "public".to_string();
        let sessions = vec![session("baz"), session("foo-bar")];

        cycle_session_in_current_category(&tmux, &config, "next", "/tmp/home", None, &sessions)
            .expect("cycle");

        assert_eq!(
            fs::read_to_string(switch_target_path).expect("switch target"),
            "baz\n"
        );
    }
}
