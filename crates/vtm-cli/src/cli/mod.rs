pub mod dispatch;
pub mod project;
pub mod session_manager;
pub mod session_ops;
pub mod statusline;

use serde::{Deserialize, Serialize};

pub const EXIT_OK: i32 = 0;
pub const EXIT_ERROR: i32 = 1;
pub const EXIT_USAGE: i32 = 2;

#[derive(Debug, Serialize, Deserialize)]
pub struct CliResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub fn print_response(response: &CliResponse) {
    if !response.stdout.is_empty() {
        print!("{}", response.stdout);
    }
    if !response.stderr.is_empty() {
        eprintln!("{}", response.stderr);
    }
}
