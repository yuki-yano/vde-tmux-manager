use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use anyhow::{Result, anyhow};
use vtm_core::command::file_mtime;
use vtm_core::config::{LoadConfigResult, load_config};
use vtm_core::parse::SessionDetails;
use vtm_core::tmux::TmuxClient;

use crate::daemon::cache::{CachedConfig, CachedSnapshot, DaemonSharedState, SNAPSHOT_TTL_MS};

#[derive(Debug, Clone)]
pub struct AppContext {
    pub env: BTreeMap<String, String>,
    pub cwd: Option<PathBuf>,
    pub daemon_state: Option<Arc<Mutex<DaemonSharedState>>>,
}

impl AppContext {
    pub fn new(
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
        if let Some(shared) = &self.daemon_state {
            let path = vtm_core::config::resolve_config_path(&self.env)?;
            let mtime = file_mtime(&path)?;
            let guard = shared
                .lock()
                .map_err(|_| anyhow!("daemon state poisoned"))?;
            if let Some(cache) = &guard.config_cache
                && cache.path == path
                && cache.mtime == mtime
            {
                return Ok(LoadConfigResult {
                    config: cache.config.clone(),
                    path: cache.path.clone(),
                    loaded: cache.loaded,
                });
            }
            drop(guard);
            let result = load_config(&self.env)?;
            let mut guard = shared
                .lock()
                .map_err(|_| anyhow!("daemon state poisoned"))?;
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

    pub fn list_session_details(&self, tmux: &TmuxClient) -> Result<Vec<SessionDetails>> {
        if let Some(shared) = &self.daemon_state {
            let guard = shared
                .lock()
                .map_err(|_| anyhow!("daemon state poisoned"))?;
            if let Some(snapshot) = &guard.snapshot_cache
                && snapshot
                    .synced_at
                    .elapsed()
                    .map(|value| value <= Duration::from_millis(SNAPSHOT_TTL_MS))
                    .unwrap_or(false)
            {
                return Ok(snapshot.sessions.clone());
            }
            drop(guard);
            let sessions = tmux.list_session_details()?;
            let mut guard = shared
                .lock()
                .map_err(|_| anyhow!("daemon state poisoned"))?;
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

    pub fn invalidate_snapshot(&self) {
        if let Some(shared) = &self.daemon_state
            && let Ok(mut guard) = shared.lock()
        {
            guard.snapshot_cache = None;
        }
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
