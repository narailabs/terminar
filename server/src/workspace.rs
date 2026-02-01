//! Workspace module for persistent terminal layout state.
//!
//! Workspaces are stored in `~/.terminar/workspace.json`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;
use tracing::{info, warn};

/// Split direction for pane layouts
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

/// A node in the split tree - either a pane or a split container
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SplitNode {
    Pane {
        id: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    },
    Split {
        id: String,
        direction: SplitDirection,
        children: Vec<SplitNode>,
        ratios: Vec<f64>,
    },
}

/// A tab represents a named workspace view with its own split layout
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: String,
    pub name: String,
    pub root: SplitNode,
}

/// The complete workspace state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub tabs: Vec<Tab>,
    pub active_tab_id: String,
}

/// Layout template (structure without session assignments)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutTemplate {
    pub id: String,
    pub name: String,
    pub root: SplitNode,
    pub created_at: String,
}

/// Complete saved state including workspace and templates
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub workspace: Workspace,
    #[serde(default)]
    pub templates: Vec<LayoutTemplate>,
}

impl Default for Workspace {
    fn default() -> Self {
        let pane_id = uuid::Uuid::new_v4().to_string();
        let tab_id = uuid::Uuid::new_v4().to_string();
        Self {
            tabs: vec![Tab {
                id: tab_id.clone(),
                name: "Terminal 1".to_string(),
                root: SplitNode::Pane {
                    id: pane_id,
                    session_id: None,
                },
            }],
            active_tab_id: tab_id,
        }
    }
}

/// Returns the path to the workspace file (~/.terminar/workspace.json)
pub fn get_workspace_path() -> PathBuf {
    crate::settings::get_settings_dir().join("workspace.json")
}

/// Load workspace from disk
/// Returns default workspace if file doesn't exist or is invalid
pub fn load_workspace() -> WorkspaceState {
    let path = get_workspace_path();

    match fs::read_to_string(&path) {
        Ok(content) => {
            match serde_json::from_str::<WorkspaceState>(&content) {
                Ok(state) => {
                    info!("Loaded workspace from {:?}", path);
                    state
                }
                Err(e) => {
                    warn!("Failed to parse workspace file: {}. Using defaults.", e);
                    WorkspaceState::default()
                }
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            info!("No workspace file found, using defaults");
            WorkspaceState::default()
        }
        Err(e) => {
            warn!("Failed to read workspace file: {}. Using defaults.", e);
            WorkspaceState::default()
        }
    }
}

/// Save workspace to disk
/// Creates the settings directory if it doesn't exist
pub fn save_workspace(state: &WorkspaceState) -> Result<(), io::Error> {
    let dir = crate::settings::get_settings_dir();
    let path = get_workspace_path();

    // Create directory if it doesn't exist
    if !dir.exists() {
        fs::create_dir_all(&dir)?;

        // Set directory permissions to 0700 (owner only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        }
    }

    // Serialize to pretty JSON
    let json = serde_json::to_string_pretty(state)
        .map_err(io::Error::other)?;

    // Write to file
    fs::write(&path, json)?;

    // Set file permissions to 0600 (owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    info!("Saved workspace to {:?}", path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_workspace() {
        let state = WorkspaceState::default();
        assert_eq!(state.workspace.tabs.len(), 1);
        assert_eq!(state.workspace.tabs[0].name, "Terminal 1");
        assert!(state.templates.is_empty());
    }

    #[test]
    fn test_split_node_pane_serialization() {
        let pane = SplitNode::Pane {
            id: "pane1".to_string(),
            session_id: Some("session1".to_string()),
        };
        let json = serde_json::to_string(&pane).unwrap();
        assert!(json.contains("\"type\":\"pane\""));
        assert!(json.contains("\"sessionId\":\"session1\""));
    }

    #[test]
    fn test_split_node_split_serialization() {
        let split = SplitNode::Split {
            id: "split1".to_string(),
            direction: SplitDirection::Horizontal,
            children: vec![
                SplitNode::Pane { id: "pane1".to_string(), session_id: None },
                SplitNode::Pane { id: "pane2".to_string(), session_id: None },
            ],
            ratios: vec![0.5, 0.5],
        };
        let json = serde_json::to_string(&split).unwrap();
        assert!(json.contains("\"type\":\"split\""));
        assert!(json.contains("\"direction\":\"horizontal\""));
        assert!(json.contains("\"children\""));
    }

    #[test]
    fn test_workspace_serialization() {
        let state = WorkspaceState::default();
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("workspace"));
        assert!(json.contains("templates"));
        assert!(json.contains("tabs"));
        assert!(json.contains("activeTabId"));
    }

    #[test]
    fn test_workspace_deserialization() {
        let json = r#"{
            "workspace": {
                "tabs": [{
                    "id": "tab1",
                    "name": "Main",
                    "root": {
                        "type": "pane",
                        "id": "pane1",
                        "sessionId": "sess1"
                    }
                }],
                "activeTabId": "tab1"
            },
            "templates": []
        }"#;

        let state: WorkspaceState = serde_json::from_str(json).unwrap();
        assert_eq!(state.workspace.tabs.len(), 1);
        assert_eq!(state.workspace.tabs[0].name, "Main");
        assert_eq!(state.workspace.active_tab_id, "tab1");
    }

    #[test]
    fn test_workspace_with_nested_splits() {
        let json = r#"{
            "workspace": {
                "tabs": [{
                    "id": "tab1",
                    "name": "Complex",
                    "root": {
                        "type": "split",
                        "id": "split1",
                        "direction": "horizontal",
                        "children": [
                            {"type": "pane", "id": "p1", "sessionId": null},
                            {
                                "type": "split",
                                "id": "split2",
                                "direction": "vertical",
                                "children": [
                                    {"type": "pane", "id": "p2", "sessionId": "sess1"},
                                    {"type": "pane", "id": "p3", "sessionId": "sess2"}
                                ],
                                "ratios": [0.6, 0.4]
                            }
                        ],
                        "ratios": [0.3, 0.7]
                    }
                }],
                "activeTabId": "tab1"
            },
            "templates": []
        }"#;

        let state: WorkspaceState = serde_json::from_str(json).unwrap();
        assert_eq!(state.workspace.tabs.len(), 1);

        if let SplitNode::Split { direction, children, ratios, .. } = &state.workspace.tabs[0].root {
            assert_eq!(*direction, SplitDirection::Horizontal);
            assert_eq!(children.len(), 2);
            assert_eq!(ratios.len(), 2);
        } else {
            panic!("Expected Split node");
        }
    }

    #[test]
    fn test_layout_template_serialization() {
        let template = LayoutTemplate {
            id: "tmpl1".to_string(),
            name: "Two Columns".to_string(),
            root: SplitNode::Split {
                id: "s1".to_string(),
                direction: SplitDirection::Horizontal,
                children: vec![
                    SplitNode::Pane { id: "p1".to_string(), session_id: None },
                    SplitNode::Pane { id: "p2".to_string(), session_id: None },
                ],
                ratios: vec![0.5, 0.5],
            },
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&template).unwrap();
        assert!(json.contains("\"name\":\"Two Columns\""));
        assert!(json.contains("\"createdAt\""));
    }
}
