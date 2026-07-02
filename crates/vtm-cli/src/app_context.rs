use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{Result, anyhow};
use vtm_core::config::{LoadConfigResult, load_config};
use vtm_core::parse::SessionDetails;
use vtm_core::tmux::TmuxClient;

#[derive(Debug, Clone)]
pub struct AppContext {
    pub env: BTreeMap<String, String>,
    pub cwd: Option<PathBuf>,
}

impl AppContext {
    pub fn new(env: BTreeMap<String, String>, cwd: Option<PathBuf>) -> Self {
        Self { env, cwd }
    }

    pub fn tmux(&self) -> TmuxClient {
        TmuxClient::new(self.env.clone()).with_cwd(self.cwd.clone())
    }

    pub fn home_dir(&self) -> Result<String> {
        self.env
            .get("HOME")
            .cloned()
            .ok_or_else(|| anyhow!("HOME is required"))
    }

    pub fn load_config(&self) -> Result<LoadConfigResult> {
        load_config(&self.env)
    }

    pub fn list_session_details(&self, tmux: &TmuxClient) -> Result<Vec<SessionDetails>> {
        tmux.list_session_details()
    }
}

pub fn collect_env() -> BTreeMap<String, String> {
    std::env::vars().collect()
}

pub fn is_in_tmux(env: &BTreeMap<String, String>) -> bool {
    env.get("TMUX")
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}
