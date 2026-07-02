use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionMeta {
    pub name: String,
    pub attached_clients: i32,
    pub last_activity: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionIdentity {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionDetails {
    pub id: String,
    pub name: String,
    pub attached_clients: i32,
    pub last_activity: i64,
    pub category: String,
    pub project_path: String,
    pub category_override: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowInfo {
    pub index: String,
    pub panes: i32,
    pub active: bool,
    pub name: String,
    pub command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaneInfo {
    pub id: String,
    pub pid: String,
    pub tty: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
}

pub fn parse_int_safe(value: Option<&str>, fallback: i64) -> i64 {
    value
        .and_then(|candidate| candidate.trim().parse::<i64>().ok())
        .unwrap_or(fallback)
}

pub fn split_non_empty_lines(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

pub fn split_window_target(target: &str) -> Option<(String, String)> {
    let index = target.rfind(':')?;
    if index == 0 || index + 1 >= target.len() {
        return None;
    }
    Some((target[..index].to_string(), target[index + 1..].to_string()))
}

pub fn parse_session_list(output: &str) -> Vec<SessionMeta> {
    split_non_empty_lines(output)
        .into_iter()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let name = parts.next().unwrap_or("").trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(SessionMeta {
                name,
                attached_clients: parse_int_safe(parts.next(), 0) as i32,
                last_activity: parse_int_safe(parts.next(), 0),
            })
        })
        .collect()
}

pub fn parse_session_identity_list(output: &str) -> Vec<SessionIdentity> {
    split_non_empty_lines(output)
        .into_iter()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let id = parts.next().unwrap_or("").trim().to_string();
            let name = parts.next().unwrap_or("").trim().to_string();
            if id.is_empty() || name.is_empty() {
                return None;
            }
            Some(SessionIdentity { id, name })
        })
        .collect()
}

pub fn parse_session_details_list(output: &str) -> Vec<SessionDetails> {
    split_non_empty_lines(output)
        .into_iter()
        .filter_map(|line| {
            let parts = line.split('\t').collect::<Vec<_>>();
            let id = parts.first().copied().unwrap_or("").trim().to_string();
            let name = parts.get(1).copied().unwrap_or("").trim().to_string();
            if id.is_empty() || name.is_empty() {
                return None;
            }
            Some(SessionDetails {
                id,
                name,
                attached_clients: parse_int_safe(parts.get(2).copied(), 0) as i32,
                last_activity: parse_int_safe(parts.get(3).copied(), 0),
                category: parts.get(4).copied().unwrap_or("").trim().to_string(),
                project_path: parts.get(5).copied().unwrap_or("").trim().to_string(),
                category_override: parts.get(6).copied().unwrap_or("").trim().to_string(),
            })
        })
        .collect()
}

pub fn parse_window_list(output: &str) -> Vec<WindowInfo> {
    split_non_empty_lines(output)
        .into_iter()
        .filter_map(|line| {
            let parts = line.split('\t').collect::<Vec<_>>();
            let index = parts.first().copied().unwrap_or("").trim().to_string();
            if index.is_empty() {
                return None;
            }
            Some(WindowInfo {
                index,
                panes: parse_int_safe(parts.get(1).copied(), 0) as i32,
                active: parts.get(2).copied().unwrap_or("") == "1",
                name: {
                    let name = parts.get(3).copied().unwrap_or("").trim();
                    if name.is_empty() {
                        "(unnamed)".to_string()
                    } else {
                        name.to_string()
                    }
                },
                command: parts.get(4).copied().unwrap_or("").trim().to_string(),
            })
        })
        .collect()
}

pub fn parse_pane_list(output: &str) -> Vec<PaneInfo> {
    split_non_empty_lines(output)
        .into_iter()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let id = parts.next().unwrap_or("").trim().to_string();
            if id.is_empty() {
                return None;
            }
            Some(PaneInfo {
                id,
                pid: parts.next().unwrap_or("").trim().to_string(),
                tty: parts.next().unwrap_or("").trim().to_string(),
            })
        })
        .collect()
}

pub fn parse_client_list(output: &str) -> Vec<ClientInfo> {
    split_non_empty_lines(output)
        .into_iter()
        .filter_map(|line| {
            let name = line.trim().to_string();
            if name.is_empty() {
                None
            } else {
                Some(ClientInfo { name })
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_window_target_works() {
        assert_eq!(
            split_window_target("dev:2"),
            Some(("dev".to_string(), "2".to_string()))
        );
        assert_eq!(split_window_target("dev"), None);
    }

    #[test]
    fn parse_client_list_ignores_empty_lines() {
        assert_eq!(
            parse_client_list("/dev/ttys001\n\n/dev/ttys002\n"),
            vec![
                ClientInfo {
                    name: "/dev/ttys001".to_string()
                },
                ClientInfo {
                    name: "/dev/ttys002".to_string()
                }
            ]
        );
    }
}
