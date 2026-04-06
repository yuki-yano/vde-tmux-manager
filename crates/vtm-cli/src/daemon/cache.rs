use std::path::PathBuf;
use std::time::SystemTime;

use vtm_core::config::ResolvedConfig;
use vtm_core::parse::SessionDetails;

pub const PROTOCOL_VERSION: &str = "1";
pub const SNAPSHOT_TTL_MS: u64 = 150;

#[derive(Debug)]
pub struct CachedConfig {
    pub path: PathBuf,
    pub mtime: Option<SystemTime>,
    pub loaded: bool,
    pub config: ResolvedConfig,
}

#[derive(Debug, Clone)]
pub struct CachedSnapshot {
    pub generation: u64,
    pub synced_at: SystemTime,
    pub sessions: Vec<SessionDetails>,
}

#[derive(Debug)]
pub struct DaemonSharedState {
    pub started_at: SystemTime,
    pub last_error: Option<String>,
    pub config_cache: Option<CachedConfig>,
    pub snapshot_cache: Option<CachedSnapshot>,
    pub next_generation: u64,
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
