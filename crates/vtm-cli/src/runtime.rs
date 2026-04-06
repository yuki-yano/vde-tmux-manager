use std::collections::BTreeMap;

use anyhow::Result;

use crate::command::{CommandOptions, run_command};
use crate::config::ResolvedConfig;
use crate::matcher::expand_home_path;

pub fn resolve_ghq_root(config: Option<&ResolvedConfig>, env: &BTreeMap<String, String>) -> Result<Option<String>> {
    if let Some(root) = config
        .and_then(|config| config.ghq_root.clone())
        .filter(|value| !value.trim().is_empty())
    {
        if let Some(home) = env.get("HOME").filter(|value| !value.trim().is_empty()) {
            return Ok(Some(expand_home_path(&root, home)));
        }
        return Ok(Some(root));
    }
    if let Some(root) = env.get("GHQ_ROOT").filter(|value| !value.trim().is_empty()) {
        if let Some(home) = env.get("HOME").filter(|value| !value.trim().is_empty()) {
            return Ok(Some(expand_home_path(root, home)));
        }
        return Ok(Some(root.clone()));
    }
    let options = CommandOptions {
        allow_fail: true,
        env: env.clone(),
        ..CommandOptions::default()
    };
    let result = run_command("ghq", ["root"], &options)?;
    let root = result.stdout.trim();
    if root.is_empty() {
        Ok(None)
    } else {
        Ok(Some(root.to_string()))
    }
}
