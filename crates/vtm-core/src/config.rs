use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

use crate::command::file_mtime;

const CONFIG_DIRECTORY: &str = "vde/tmux-manager";
const CONFIG_BASENAME: &str = "config.yml";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionManagerPopupConfig {
    pub enabled: bool,
    pub width: String,
    pub height: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionManagerFzfConfig {
    pub prompt: String,
    pub border: String,
    pub preview_width: String,
    pub preview_refresh_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionManagerPreviewConfig {
    pub session_capture_lines: i64,
    pub pane_capture_lines: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionManagerKillConfig {
    pub send_ctrl_c: bool,
    pub term_wait_ms: i64,
    pub kill_wait_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionManagerConfig {
    pub popup: SessionManagerPopupConfig,
    pub fzf: SessionManagerFzfConfig,
    pub preview: SessionManagerPreviewConfig,
    pub kill: SessionManagerKillConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatuslineSegmentColorsConfig {
    pub fg: String,
    pub bg: String,
    pub outer_bg: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatuslineSegmentConfig {
    pub format: String,
    pub prefix: String,
    pub suffix: String,
    pub bold: bool,
    pub colors: StatuslineSegmentColorsConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatuslineSessionsConfig {
    pub show_index: bool,
    pub current: StatuslineSegmentConfig,
    pub other: StatuslineSegmentConfig,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatuslineCategoryMode {
    #[default]
    Current,
    List,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatuslineCategoryConfig {
    pub mode: StatuslineCategoryMode,
    pub format: String,
    pub prefix: String,
    pub suffix: String,
    pub bold: bool,
    pub colors: StatuslineSegmentColorsConfig,
    pub inactive_colors: StatuslineSegmentColorsConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRuleConfig {
    pub category: String,
    #[serde(default)]
    pub ghq_patterns: Vec<String>,
    #[serde(default)]
    pub path_patterns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct SessionNameRuleConfig {
    pub category: String,
    #[serde(default)]
    pub patterns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoriesConfig {
    pub default_category: String,
    #[serde(default)]
    pub display_names: BTreeMap<String, String>,
    #[serde(default)]
    pub order: BTreeMap<String, i64>,
    #[serde(default)]
    pub rules: Vec<CategoryRuleConfig>,
    #[serde(default)]
    pub session_name_rules: Vec<SessionNameRuleConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedConfig {
    pub ghq_root: Option<String>,
    pub session_manager: SessionManagerConfig,
    pub statusline_category: StatuslineCategoryConfig,
    pub statusline_sessions: StatuslineSessionsConfig,
    pub categories: CategoriesConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialConfig {
    pub ghq_root: Option<String>,
    pub session_manager: Option<PartialSessionManagerConfig>,
    pub statusline_category: Option<PartialStatuslineCategoryConfig>,
    pub statusline_sessions: Option<PartialStatuslineSessionsConfig>,
    pub categories: Option<PartialCategoriesConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialSessionManagerConfig {
    pub popup: Option<PartialSessionManagerPopupConfig>,
    pub fzf: Option<PartialSessionManagerFzfConfig>,
    pub preview: Option<PartialSessionManagerPreviewConfig>,
    pub kill: Option<PartialSessionManagerKillConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialSessionManagerPopupConfig {
    pub enabled: Option<bool>,
    pub width: Option<String>,
    pub height: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialSessionManagerFzfConfig {
    pub prompt: Option<String>,
    pub border: Option<String>,
    pub preview_width: Option<String>,
    pub preview_refresh_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialSessionManagerPreviewConfig {
    pub session_capture_lines: Option<i64>,
    pub pane_capture_lines: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialSessionManagerKillConfig {
    pub send_ctrl_c: Option<bool>,
    pub term_wait_ms: Option<i64>,
    pub kill_wait_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialStatuslineSegmentColorsConfig {
    pub fg: Option<String>,
    pub bg: Option<String>,
    pub outer_bg: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialStatuslineSegmentConfig {
    pub format: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub bold: Option<bool>,
    pub colors: Option<PartialStatuslineSegmentColorsConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialStatuslineSessionsConfig {
    pub show_index: Option<bool>,
    pub current: Option<PartialStatuslineSegmentConfig>,
    pub other: Option<PartialStatuslineSegmentConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialStatuslineCategoryConfig {
    pub mode: Option<StatuslineCategoryMode>,
    pub format: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub bold: Option<bool>,
    pub colors: Option<PartialStatuslineSegmentColorsConfig>,
    pub inactive_colors: Option<PartialStatuslineSegmentColorsConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialCategoryRuleConfig {
    pub category: Option<String>,
    pub ghq_patterns: Option<Vec<String>>,
    pub path_patterns: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialSessionNameRuleConfig {
    pub category: Option<String>,
    pub patterns: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PartialCategoriesConfig {
    pub default_category: Option<String>,
    pub display_names: Option<BTreeMap<String, String>>,
    pub order: Option<BTreeMap<String, i64>>,
    pub rules: Option<Vec<PartialCategoryRuleConfig>>,
    pub session_name_rules: Option<Vec<PartialSessionNameRuleConfig>>,
}

#[derive(Debug, Clone)]
pub struct LoadConfigResult {
    pub config: ResolvedConfig,
    pub path: PathBuf,
    pub loaded: bool,
}

pub fn default_config() -> ResolvedConfig {
    ResolvedConfig {
        ghq_root: None,
        session_manager: SessionManagerConfig {
            popup: SessionManagerPopupConfig {
                enabled: true,
                width: "50%".to_string(),
                height: "50%".to_string(),
            },
            fzf: SessionManagerFzfConfig {
                prompt: "tmux> ".to_string(),
                border: "rounded".to_string(),
                preview_width: "65".to_string(),
                preview_refresh_ms: 0,
            },
            preview: SessionManagerPreviewConfig {
                session_capture_lines: 15,
                pane_capture_lines: 16,
            },
            kill: SessionManagerKillConfig {
                send_ctrl_c: true,
                term_wait_ms: 300,
                kill_wait_ms: 300,
            },
        },
        statusline_category: StatuslineCategoryConfig {
            mode: StatuslineCategoryMode::Current,
            format: "{category}".to_string(),
            prefix: String::new(),
            suffix: String::new(),
            bold: true,
            colors: StatuslineSegmentColorsConfig {
                fg: "#1C1C1C".to_string(),
                bg: "#FAB387".to_string(),
                outer_bg: "#352F63".to_string(),
            },
            inactive_colors: StatuslineSegmentColorsConfig {
                fg: "#C6D0F5".to_string(),
                bg: "#352F63".to_string(),
                outer_bg: "#352F63".to_string(),
            },
        },
        statusline_sessions: StatuslineSessionsConfig {
            show_index: false,
            current: StatuslineSegmentConfig {
                format: "{session}".to_string(),
                prefix: String::new(),
                suffix: String::new(),
                bold: false,
                colors: StatuslineSegmentColorsConfig {
                    fg: "#1E1E2E".to_string(),
                    bg: "#B4BEFE".to_string(),
                    outer_bg: "#352F63".to_string(),
                },
            },
            other: StatuslineSegmentConfig {
                format: " {session} ".to_string(),
                prefix: String::new(),
                suffix: String::new(),
                bold: false,
                colors: StatuslineSegmentColorsConfig {
                    fg: "#C6D0F5".to_string(),
                    bg: "#352F63".to_string(),
                    outer_bg: "#352F63".to_string(),
                },
            },
        },
        categories: CategoriesConfig {
            default_category: String::new(),
            display_names: BTreeMap::new(),
            order: BTreeMap::new(),
            rules: Vec::new(),
            session_name_rules: Vec::new(),
        },
    }
}

fn merge_colors(
    base: &StatuslineSegmentColorsConfig,
    partial: Option<&PartialStatuslineSegmentColorsConfig>,
) -> StatuslineSegmentColorsConfig {
    StatuslineSegmentColorsConfig {
        fg: partial
            .and_then(|value| value.fg.clone())
            .unwrap_or_else(|| base.fg.clone()),
        bg: partial
            .and_then(|value| value.bg.clone())
            .unwrap_or_else(|| base.bg.clone()),
        outer_bg: partial
            .and_then(|value| value.outer_bg.clone())
            .unwrap_or_else(|| base.outer_bg.clone()),
    }
}

fn merge_segment(
    base: &StatuslineSegmentConfig,
    partial: Option<&PartialStatuslineSegmentConfig>,
) -> StatuslineSegmentConfig {
    StatuslineSegmentConfig {
        format: partial
            .and_then(|value| value.format.clone())
            .unwrap_or_else(|| base.format.clone()),
        prefix: partial
            .and_then(|value| value.prefix.clone())
            .unwrap_or_else(|| base.prefix.clone()),
        suffix: partial
            .and_then(|value| value.suffix.clone())
            .unwrap_or_else(|| base.suffix.clone()),
        bold: partial.and_then(|value| value.bold).unwrap_or(base.bold),
        colors: merge_colors(
            &base.colors,
            partial.and_then(|value| value.colors.as_ref()),
        ),
    }
}

pub fn merge_config(partial: PartialConfig) -> ResolvedConfig {
    let default = default_config();
    ResolvedConfig {
        ghq_root: partial.ghq_root.or(default.ghq_root),
        session_manager: SessionManagerConfig {
            popup: SessionManagerPopupConfig {
                enabled: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.popup.as_ref())
                    .and_then(|value| value.enabled)
                    .unwrap_or(default.session_manager.popup.enabled),
                width: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.popup.as_ref())
                    .and_then(|value| value.width.clone())
                    .unwrap_or(default.session_manager.popup.width),
                height: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.popup.as_ref())
                    .and_then(|value| value.height.clone())
                    .unwrap_or(default.session_manager.popup.height),
            },
            fzf: SessionManagerFzfConfig {
                prompt: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.fzf.as_ref())
                    .and_then(|value| value.prompt.clone())
                    .unwrap_or(default.session_manager.fzf.prompt),
                border: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.fzf.as_ref())
                    .and_then(|value| value.border.clone())
                    .unwrap_or(default.session_manager.fzf.border),
                preview_width: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.fzf.as_ref())
                    .and_then(|value| value.preview_width.clone())
                    .unwrap_or(default.session_manager.fzf.preview_width),
                preview_refresh_ms: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.fzf.as_ref())
                    .and_then(|value| value.preview_refresh_ms)
                    .unwrap_or(default.session_manager.fzf.preview_refresh_ms),
            },
            preview: SessionManagerPreviewConfig {
                session_capture_lines: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.preview.as_ref())
                    .and_then(|value| value.session_capture_lines)
                    .unwrap_or(default.session_manager.preview.session_capture_lines),
                pane_capture_lines: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.preview.as_ref())
                    .and_then(|value| value.pane_capture_lines)
                    .unwrap_or(default.session_manager.preview.pane_capture_lines),
            },
            kill: SessionManagerKillConfig {
                send_ctrl_c: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.kill.as_ref())
                    .and_then(|value| value.send_ctrl_c)
                    .unwrap_or(default.session_manager.kill.send_ctrl_c),
                term_wait_ms: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.kill.as_ref())
                    .and_then(|value| value.term_wait_ms)
                    .unwrap_or(default.session_manager.kill.term_wait_ms),
                kill_wait_ms: partial
                    .session_manager
                    .as_ref()
                    .and_then(|value| value.kill.as_ref())
                    .and_then(|value| value.kill_wait_ms)
                    .unwrap_or(default.session_manager.kill.kill_wait_ms),
            },
        },
        statusline_category: StatuslineCategoryConfig {
            mode: partial
                .statusline_category
                .as_ref()
                .and_then(|value| value.mode.clone())
                .unwrap_or(default.statusline_category.mode),
            format: partial
                .statusline_category
                .as_ref()
                .and_then(|value| value.format.clone())
                .unwrap_or(default.statusline_category.format),
            prefix: partial
                .statusline_category
                .as_ref()
                .and_then(|value| value.prefix.clone())
                .unwrap_or(default.statusline_category.prefix),
            suffix: partial
                .statusline_category
                .as_ref()
                .and_then(|value| value.suffix.clone())
                .unwrap_or(default.statusline_category.suffix),
            bold: partial
                .statusline_category
                .as_ref()
                .and_then(|value| value.bold)
                .unwrap_or(default.statusline_category.bold),
            colors: merge_colors(
                &default.statusline_category.colors,
                partial
                    .statusline_category
                    .as_ref()
                    .and_then(|value| value.colors.as_ref()),
            ),
            inactive_colors: merge_colors(
                &default.statusline_category.inactive_colors,
                partial
                    .statusline_category
                    .as_ref()
                    .and_then(|value| value.inactive_colors.as_ref()),
            ),
        },
        statusline_sessions: StatuslineSessionsConfig {
            show_index: partial
                .statusline_sessions
                .as_ref()
                .and_then(|value| value.show_index)
                .unwrap_or(default.statusline_sessions.show_index),
            current: merge_segment(
                &default.statusline_sessions.current,
                partial
                    .statusline_sessions
                    .as_ref()
                    .and_then(|value| value.current.as_ref()),
            ),
            other: merge_segment(
                &default.statusline_sessions.other,
                partial
                    .statusline_sessions
                    .as_ref()
                    .and_then(|value| value.other.as_ref()),
            ),
        },
        categories: CategoriesConfig {
            default_category: partial
                .categories
                .as_ref()
                .and_then(|value| value.default_category.clone())
                .unwrap_or(default.categories.default_category),
            display_names: partial
                .categories
                .as_ref()
                .and_then(|value| value.display_names.clone())
                .unwrap_or(default.categories.display_names),
            order: partial
                .categories
                .as_ref()
                .and_then(|value| value.order.clone())
                .unwrap_or(default.categories.order),
            rules: partial
                .categories
                .as_ref()
                .and_then(|value| value.rules.clone())
                .unwrap_or_default()
                .into_iter()
                .map(|rule| CategoryRuleConfig {
                    category: rule.category.unwrap_or_default(),
                    ghq_patterns: rule.ghq_patterns.unwrap_or_default(),
                    path_patterns: rule.path_patterns.unwrap_or_default(),
                })
                .collect(),
            session_name_rules: partial
                .categories
                .as_ref()
                .and_then(|value| value.session_name_rules.clone())
                .unwrap_or_default()
                .into_iter()
                .map(|rule| SessionNameRuleConfig {
                    category: rule.category.unwrap_or_default(),
                    patterns: rule.patterns.unwrap_or_default(),
                })
                .collect(),
        },
    }
}

fn config_issue(path: &str, message: &str, file_path: &Path) -> anyhow::Error {
    anyhow!(
        "Invalid config ({}): {}: {}",
        file_path.display(),
        path,
        message
    )
}

fn validate_config(config: &ResolvedConfig, path: &Path) -> Result<()> {
    if config.session_manager.popup.width.trim().is_empty() {
        return Err(config_issue("sessionManager.popup.width", "required", path));
    }
    if config.session_manager.popup.height.trim().is_empty() {
        return Err(config_issue(
            "sessionManager.popup.height",
            "required",
            path,
        ));
    }
    if config.session_manager.fzf.prompt.trim().is_empty() {
        return Err(config_issue("sessionManager.fzf.prompt", "required", path));
    }
    for (name, value) in [
        (
            "statuslineCategory.colors.fg",
            &config.statusline_category.colors.fg,
        ),
        (
            "statuslineCategory.colors.bg",
            &config.statusline_category.colors.bg,
        ),
        (
            "statuslineCategory.colors.outerBg",
            &config.statusline_category.colors.outer_bg,
        ),
    ] {
        if value.trim().is_empty() {
            return Err(config_issue(name, "required", path));
        }
    }
    Ok(())
}

fn expand_pattern(
    value: &str,
    env: &BTreeMap<String, String>,
    path: &str,
    file_path: &Path,
) -> Result<String> {
    let pattern = regex::Regex::new(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")?;
    let mut missing = None::<String>;
    let expanded = pattern
        .replace_all(value, |captures: &regex::Captures<'_>| {
            let key = captures
                .get(1)
                .map(|value| value.as_str())
                .unwrap_or_default();
            match env.get(key) {
                Some(value) => value.clone(),
                None => {
                    missing = Some(key.to_string());
                    String::new()
                }
            }
        })
        .to_string();
    if let Some(variable) = missing {
        return Err(config_issue(
            path,
            &format!("environment variable {} is not defined", variable),
            file_path,
        ));
    }
    Ok(expanded)
}

fn expand_config_patterns(
    partial: &mut PartialConfig,
    env: &BTreeMap<String, String>,
    file_path: &Path,
) -> Result<()> {
    if let Some(categories) = partial.categories.as_mut()
        && let Some(rules) = categories.rules.as_mut()
    {
        for (rule_index, rule) in rules.iter_mut().enumerate() {
            if let Some(patterns) = rule.ghq_patterns.as_mut() {
                for (pattern_index, pattern) in patterns.iter_mut().enumerate() {
                    *pattern = expand_pattern(
                        pattern,
                        env,
                        &format!("categories.rules.{rule_index}.ghqPatterns.{pattern_index}"),
                        file_path,
                    )?;
                }
            }
            if let Some(patterns) = rule.path_patterns.as_mut() {
                for (pattern_index, pattern) in patterns.iter_mut().enumerate() {
                    *pattern = expand_pattern(
                        pattern,
                        env,
                        &format!("categories.rules.{rule_index}.pathPatterns.{pattern_index}"),
                        file_path,
                    )?;
                }
            }
        }
    }
    Ok(())
}

pub fn resolve_config_path(env: &BTreeMap<String, String>) -> Result<PathBuf> {
    if let Some(root) = env
        .get("XDG_CONFIG_HOME")
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(PathBuf::from(root)
            .join(CONFIG_DIRECTORY)
            .join(CONFIG_BASENAME));
    }
    let home = env
        .get("HOME")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("HOME is required to resolve config path"))?;
    Ok(PathBuf::from(home)
        .join(".config")
        .join(CONFIG_DIRECTORY)
        .join(CONFIG_BASENAME))
}

pub fn load_config(env: &BTreeMap<String, String>) -> Result<LoadConfigResult> {
    let path = resolve_config_path(env)?;
    let Some(_) = file_mtime(&path)? else {
        return Ok(LoadConfigResult {
            config: default_config(),
            path,
            loaded: false,
        });
    };

    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read config: {}", path.display()))?;
    let deserializer = serde_yaml::Deserializer::from_str(&content);
    let mut partial = serde_path_to_error::deserialize::<_, PartialConfig>(deserializer)
        .map_err(|error| anyhow!("Invalid config ({}): {}", path.display(), error))?;
    expand_config_patterns(&mut partial, env, &path)?;
    let config = merge_config(partial);
    validate_config(&config, &path)?;
    Ok(LoadConfigResult {
        config,
        path,
        loaded: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_defaults() {
        let config = merge_config(PartialConfig::default());
        assert_eq!(config.statusline_sessions.other.format, " {session} ");
    }

    #[test]
    fn resolve_path_from_home() {
        let env = BTreeMap::from([(String::from("HOME"), String::from("/tmp/home"))]);
        assert_eq!(
            resolve_config_path(&env).unwrap(),
            PathBuf::from("/tmp/home/.config/vde/tmux-manager/config.yml")
        );
    }
}
