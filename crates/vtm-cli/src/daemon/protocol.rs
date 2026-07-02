use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use vtm_core::export::StateExport;

use crate::cli::CliResponse;

#[derive(Debug, Serialize, Deserialize)]
pub enum DaemonRequest {
    Status,
    Reload,
    Shutdown,
    Subscribe {
        env: BTreeMap<String, String>,
        cwd: Option<String>,
    },
    Cli {
        args: Vec<String>,
        env: BTreeMap<String, String>,
        cwd: Option<String>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DaemonStatus {
    pub socket_path: String,
    pub pid: u32,
    pub uptime_seconds: u64,
    pub protocol_version: String,
    pub config_generation: u64,
    pub snapshot_generation: u64,
    pub last_full_resync: Option<u64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum DaemonResponse {
    Status(DaemonStatus),
    Ack,
    Cli(CliResponse),
    StateExport(StateExport),
    Error(String),
}
