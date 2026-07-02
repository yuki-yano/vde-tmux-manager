use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::config::{CategoriesConfig, ResolvedConfig};
use crate::matcher::{collect_defined_categories, expand_home_path, match_glob, sort_categories};
use crate::parse::SessionDetails;

pub const STATE_EXPORT_VERSION: i64 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateExport {
    pub version: i64,
    pub categories: Vec<ExportCategory>,
    pub sessions: Vec<ExportSession>,
    pub clients: Vec<ExportClient>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCategory {
    pub name: String,
    pub display_name: String,
    pub order: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSession {
    pub name: String,
    pub category: String,
    pub category_source: CategorySource,
    pub project_path: String,
    pub attached: bool,
    pub activity: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CategorySource {
    Override,
    PathRule,
    SessionNameRule,
    Default,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportClient {
    pub client: String,
    pub current_category: String,
    pub last_sessions: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportClientInput {
    pub client: String,
    pub current_category: Option<String>,
    pub last_sessions: BTreeMap<String, String>,
}

fn normalize_slashes(value: &str) -> String {
    value.replace('\\', "/")
}

fn normalize_path_value(value: &str) -> String {
    let normalized = normalize_slashes(value);
    let mut parts = Vec::new();
    let absolute = normalized.starts_with('/');
    for part in normalized.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    let joined = parts.join("/");
    match (absolute, joined.is_empty()) {
        (true, true) => "/".to_string(),
        (true, false) => format!("/{joined}"),
        (false, true) => String::new(),
        (false, false) => joined,
    }
}

fn normalize_ghq_relative_path(project_path: &str, ghq_root: Option<&str>) -> Option<String> {
    let ghq_root = ghq_root?.trim();
    if ghq_root.is_empty() {
        return None;
    }
    let project = normalize_path_value(project_path);
    let root = normalize_path_value(ghq_root);
    if project != root && !project.starts_with(&format!("{root}/")) {
        return None;
    }
    Some(project[root.len()..].trim_start_matches('/').to_string())
}

fn match_project_path_rule(
    config: &CategoriesConfig,
    project_path: &str,
    home_directory: &str,
    ghq_root: Option<&str>,
) -> Option<String> {
    let normalized_project_path = normalize_path_value(project_path);
    let ghq_relative = normalize_ghq_relative_path(&normalized_project_path, ghq_root);

    for rule in &config.rules {
        if let Some(relative) = &ghq_relative {
            if rule
                .ghq_patterns
                .iter()
                .any(|pattern| match_glob(relative, pattern))
            {
                return Some(rule.category.clone());
            }
            continue;
        }

        if rule.path_patterns.iter().any(|pattern| {
            let expanded = normalize_path_value(&expand_home_path(pattern, home_directory));
            match_glob(&normalized_project_path, &expanded)
        }) {
            return Some(rule.category.clone());
        }
    }

    None
}

fn resolve_category_with_source(
    session: &SessionDetails,
    config: &ResolvedConfig,
    home_directory: &str,
    ghq_root: Option<&str>,
) -> (String, CategorySource) {
    let category_override = session.category_override.trim();
    if !category_override.is_empty() {
        return (category_override.to_string(), CategorySource::Override);
    }

    if !session.project_path.trim().is_empty() {
        if let Some(category) = match_project_path_rule(
            &config.categories,
            &session.project_path,
            home_directory,
            ghq_root,
        ) {
            return (category, CategorySource::PathRule);
        }
        return (
            config.categories.default_category.clone(),
            CategorySource::Default,
        );
    }

    for rule in &config.categories.session_name_rules {
        if rule
            .patterns
            .iter()
            .any(|pattern| match_glob(&session.name, pattern))
        {
            return (rule.category.clone(), CategorySource::SessionNameRule);
        }
    }

    if !session.category.trim().is_empty() {
        return (session.category.trim().to_string(), CategorySource::Default);
    }

    (
        config.categories.default_category.clone(),
        CategorySource::Default,
    )
}

pub fn build_state_export(
    sessions: &[SessionDetails],
    clients: &[ExportClientInput],
    config: &ResolvedConfig,
    home_directory: &str,
    ghq_root: Option<&str>,
) -> StateExport {
    let categories = sort_categories(
        &collect_defined_categories(&config.categories),
        &config.categories.order,
    )
    .into_iter()
    .enumerate()
    .map(|(index, name)| ExportCategory {
        display_name: config
            .categories
            .display_names
            .get(&name)
            .cloned()
            .unwrap_or_default(),
        order: config
            .categories
            .order
            .get(&name)
            .copied()
            .unwrap_or(index as i64),
        name,
    })
    .collect::<Vec<_>>();

    let sessions = sessions
        .iter()
        .map(|session| {
            let (category, category_source) =
                resolve_category_with_source(session, config, home_directory, ghq_root);
            ExportSession {
                name: session.name.clone(),
                category,
                category_source,
                project_path: session.project_path.clone(),
                attached: session.attached_clients > 0,
                activity: session.last_activity,
            }
        })
        .collect::<Vec<_>>();

    let clients = clients
        .iter()
        .map(|client| ExportClient {
            client: client.client.clone(),
            current_category: client
                .current_category
                .clone()
                .unwrap_or_else(|| config.categories.default_category.clone()),
            last_sessions: client.last_sessions.clone(),
        })
        .collect::<Vec<_>>();

    StateExport {
        version: STATE_EXPORT_VERSION,
        categories,
        sessions,
        clients,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::config::{
        CategoriesConfig, CategoryRuleConfig, ResolvedConfig, SessionNameRuleConfig, default_config,
    };
    use crate::parse::SessionDetails;

    fn test_config() -> ResolvedConfig {
        let mut config = default_config();
        config.ghq_root = Some("/home/me/ghq".to_string());
        config.categories = CategoriesConfig {
            default_category: "private".to_string(),
            display_names: BTreeMap::from([
                ("private".to_string(), "Private".to_string()),
                ("public".to_string(), "Public".to_string()),
                ("work".to_string(), "Work".to_string()),
            ]),
            order: BTreeMap::from([
                ("private".to_string(), 0),
                ("public".to_string(), 1),
                ("work".to_string(), 2),
            ]),
            rules: vec![CategoryRuleConfig {
                category: "work".to_string(),
                ghq_patterns: vec!["github.com/company/**".to_string()],
                path_patterns: vec!["~/work/**".to_string()],
            }],
            session_name_rules: vec![SessionNameRuleConfig {
                category: "public".to_string(),
                patterns: vec!["oss-*".to_string()],
            }],
        };
        config
    }

    #[test]
    fn builds_state_export_with_category_sources_and_clients() {
        let sessions = vec![
            SessionDetails {
                id: "$1".to_string(),
                name: "manual".to_string(),
                attached_clients: 1,
                last_activity: 1751400000,
                category: String::new(),
                project_path: "/tmp/manual".to_string(),
                category_override: "private".to_string(),
            },
            SessionDetails {
                id: "$2".to_string(),
                name: "company".to_string(),
                attached_clients: 0,
                last_activity: 1751400001,
                category: String::new(),
                project_path: "/home/me/ghq/github.com/company/app".to_string(),
                category_override: String::new(),
            },
            SessionDetails {
                id: "$3".to_string(),
                name: "oss-tool".to_string(),
                attached_clients: 0,
                last_activity: 1751400002,
                category: String::new(),
                project_path: String::new(),
                category_override: String::new(),
            },
            SessionDetails {
                id: "$4".to_string(),
                name: "misc".to_string(),
                attached_clients: 0,
                last_activity: 1751400003,
                category: String::new(),
                project_path: String::new(),
                category_override: String::new(),
            },
        ];
        let clients = vec![ExportClientInput {
            client: "/dev/ttys003".to_string(),
            current_category: Some("private".to_string()),
            last_sessions: BTreeMap::from([("private".to_string(), "manual".to_string())]),
        }];

        let export = build_state_export(
            &sessions,
            &clients,
            &test_config(),
            "/home/me",
            Some("/home/me/ghq"),
        );
        let value = serde_json::to_value(export).expect("json");

        assert_eq!(
            value,
            serde_json::json!({
                "version": 1,
                "categories": [
                    { "name": "private", "displayName": "Private", "order": 0 },
                    { "name": "public", "displayName": "Public", "order": 1 },
                    { "name": "work", "displayName": "Work", "order": 2 }
                ],
                "sessions": [
                    {
                        "name": "manual",
                        "category": "private",
                        "categorySource": "override",
                        "projectPath": "/tmp/manual",
                        "attached": true,
                        "activity": 1751400000
                    },
                    {
                        "name": "company",
                        "category": "work",
                        "categorySource": "pathRule",
                        "projectPath": "/home/me/ghq/github.com/company/app",
                        "attached": false,
                        "activity": 1751400001
                    },
                    {
                        "name": "oss-tool",
                        "category": "public",
                        "categorySource": "sessionNameRule",
                        "projectPath": "",
                        "attached": false,
                        "activity": 1751400002
                    },
                    {
                        "name": "misc",
                        "category": "private",
                        "categorySource": "default",
                        "projectPath": "",
                        "attached": false,
                        "activity": 1751400003
                    }
                ],
                "clients": [
                    {
                        "client": "/dev/ttys003",
                        "currentCategory": "private",
                        "lastSessions": { "private": "manual" }
                    }
                ]
            })
        );
    }
}
