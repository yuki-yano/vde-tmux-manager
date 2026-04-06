mod app_context;
mod cli;
mod daemon;

use app_context::{AppContext, collect_env};
use cli::dispatch::run_cli_with_context;
use cli::{EXIT_ERROR, print_response};

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let cwd = std::env::current_dir().ok();
    let ctx = AppContext::new(collect_env(), cwd, None);
    match run_cli_with_context(&args, &ctx, true) {
        Ok(response) => {
            print_response(&response);
            if response.exit_code != 0 {
                std::process::exit(response.exit_code);
            }
        }
        Err(error) => {
            eprintln!("[UNEXPECTED_ERROR] {error}");
            std::process::exit(EXIT_ERROR);
        }
    }
}
