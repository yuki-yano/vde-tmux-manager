use std::collections::{BTreeMap, BTreeSet};

use crate::config::CategoriesConfig;

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

pub fn expand_home_path(value: &str, home_directory: &str) -> String {
    if value == "~" {
        return home_directory.to_string();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return format!("{home_directory}/{rest}");
    }
    value.to_string()
}

fn split_segments(value: &str) -> Vec<String> {
    let normalized = normalize_path_value(value);
    if normalized.is_empty() {
        Vec::new()
    } else {
        normalized.split('/').map(ToOwned::to_owned).collect()
    }
}

fn match_segment(value: &str, pattern: &str) -> bool {
    let escaped = regex::escape(pattern).replace(r"\*", ".*");
    regex::Regex::new(&format!("^{escaped}$"))
        .map(|pattern| pattern.is_match(value))
        .unwrap_or(false)
}

fn match_segments(
    values: &[String],
    patterns: &[String],
    value_index: usize,
    pattern_index: usize,
) -> bool {
    let Some(pattern) = patterns.get(pattern_index) else {
        return value_index == values.len();
    };
    if pattern == "**" {
        if match_segments(values, patterns, value_index, pattern_index + 1) {
            return true;
        }
        if value_index < values.len() {
            return match_segments(values, patterns, value_index + 1, pattern_index);
        }
        return false;
    }
    let Some(value) = values.get(value_index) else {
        return false;
    };
    if !match_segment(value, pattern) {
        return false;
    }
    match_segments(values, patterns, value_index + 1, pattern_index + 1)
}

pub fn match_glob(value: &str, pattern: &str) -> bool {
    let value_segments = split_segments(value);
    let pattern_segments = split_segments(pattern);
    match_segments(&value_segments, &pattern_segments, 0, 0)
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

pub fn resolve_project_path_category(
    config: &CategoriesConfig,
    project_path: &str,
    ghq_root: Option<&str>,
    home_directory: &str,
) -> String {
    let normalized_project_path = normalize_path_value(project_path);
    let ghq_relative = normalize_ghq_relative_path(&normalized_project_path, ghq_root);

    for rule in &config.rules {
        if let Some(relative) = &ghq_relative {
            for pattern in &rule.ghq_patterns {
                if match_glob(relative, pattern) {
                    return rule.category.clone();
                }
            }
            continue;
        }

        for pattern in &rule.path_patterns {
            let expanded = normalize_path_value(&expand_home_path(pattern, home_directory));
            if match_glob(&normalized_project_path, &expanded) {
                return rule.category.clone();
            }
        }
    }
    config.default_category.clone()
}

pub fn resolve_category_for_session(
    config: &CategoriesConfig,
    session_name: &str,
    project_path: &str,
    category_override: Option<&str>,
    ghq_root: Option<&str>,
    home_directory: &str,
) -> String {
    if let Some(category_override) = category_override {
        let normalized = category_override.trim();
        if !normalized.is_empty() {
            return normalized.to_string();
        }
    }
    if !project_path.trim().is_empty() {
        return resolve_project_path_category(config, project_path, ghq_root, home_directory);
    }
    for rule in &config.session_name_rules {
        for pattern in &rule.patterns {
            if match_glob(session_name, pattern) {
                return rule.category.clone();
            }
        }
    }
    config.default_category.clone()
}

pub fn collect_defined_categories(config: &CategoriesConfig) -> Vec<String> {
    let mut categories = BTreeSet::new();
    categories.insert(config.default_category.clone());
    for rule in &config.rules {
        categories.insert(rule.category.clone());
    }
    for rule in &config.session_name_rules {
        categories.insert(rule.category.clone());
    }
    categories.into_iter().collect()
}

fn to_numeric_category(value: &str) -> Option<i64> {
    value.trim().parse::<i64>().ok()
}

pub fn sort_categories(categories: &[String], order: &BTreeMap<String, i64>) -> Vec<String> {
    let mut categories = categories.to_vec();
    categories.sort_by(|left, right| {
        match (order.get(left), order.get(right)) {
            (Some(a), Some(b)) if a != b => return a.cmp(b),
            (Some(_), None) => return std::cmp::Ordering::Less,
            (None, Some(_)) => return std::cmp::Ordering::Greater,
            _ => {}
        }
        match (to_numeric_category(left), to_numeric_category(right)) {
            (Some(a), Some(b)) if a != b => return a.cmp(&b),
            _ => {}
        }
        left.cmp(right)
    });
    categories
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::CategoriesConfig;

    #[test]
    fn glob_double_star() {
        assert!(match_glob(
            "github.com/yuki-yano/vtm",
            "github.com/yuki-yano/**"
        ));
    }

    #[test]
    fn resolve_project_category() {
        let config = CategoriesConfig {
            default_category: "misc".to_string(),
            display_names: BTreeMap::new(),
            order: BTreeMap::new(),
            rules: vec![crate::config::CategoryRuleConfig {
                category: "oss".to_string(),
                ghq_patterns: vec!["github.com/yuki-yano/**".to_string()],
                path_patterns: vec![],
            }],
            session_name_rules: vec![],
        };
        assert_eq!(
            resolve_project_path_category(
                &config,
                "/ghq/github.com/yuki-yano/vtm",
                Some("/ghq"),
                "/home/yuki"
            ),
            "oss"
        );
    }
}
