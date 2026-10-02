//! Sub-agent configuration, ported from ZCode's
//! `packages/shared/src/subagents-types.ts` and
//! `packages/services/src/subagents/subagentStorage.ts`.
//!
//! ZCode's `SubAgentConfig` is kept field for field, including the fields
//! Orin Code does not yet act on. Those are NOT quietly dropped: each carries a
//! note saying so in the settings surface, because a setting that silently
//! does nothing is worse than one that is visibly not wired yet.
//!
//! What Orin Code genuinely consumes today, and how:
//!
//! | field | consumed by |
//! |---|---|
//! | `name` | the queue task's title |
//! | `system_prompt` | `AiSendRequest.system` |
//! | `model_selection.model_id` | `AiSendRequest.model_id` |
//! | `background` | the queue's delegated/concurrent accounting |
//! | `color` | the task's presentation |
//!
//! The remainder -- `tools`, `disallowed_tools`, `skills`, `mcp_servers`,
//! `inject_agents_md`, `permission_mode`, `max_turns` -- describe capabilities
//! Orin Code's chat path does not have yet. They are stored and round-tripped
//! so a later stage can consume them, and reported as unwired rather than
//! pretending to be active.

use std::path::Path;

use serde::{Deserialize, Serialize};

pub const SUBAGENT_FILE: &str = ".orin/subagents.json";

/// ZCode's colour set (`subagents-types.ts:93-108`).
pub const SUBAGENT_COLORS: [&str; 8] = [
    "red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelSelection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<ReasoningOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReasoningOption {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_level: Option<String>,
}

/// ZCode's permission modes. Orin Code has one effective mode -- approve-gated --
/// so these are stored, not branched on. See the settings note.
pub const PERMISSION_MODES: [&str; 4] = ["default", "acceptEdits", "plan", "bypassPermissions"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubAgentConfig {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_selection: Option<ModelSelection>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub disallowed_tools: Vec<String>,
    #[serde(default)]
    pub inject_agents_md: bool,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    #[serde(default)]
    pub background: bool,
    #[serde(default)]
    pub mcp_servers: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubagentManifest {
    #[serde(default)]
    pub agents: Vec<SubAgentConfig>,
}

/// Which fields the current runtime actually acts on. Reported to the UI so it
/// can label an unwired setting instead of implying it works.
pub const WIRED_FIELDS: [&str; 5] =
    ["name", "systemPrompt", "modelSelection.modelId", "background", "color"];

pub const UNWIRED_FIELDS: [(&str, &str); 7] = [
    ("tools", "Orin Code's chat path exposes no tool layer to a sub-agent yet."),
    ("disallowedTools", "No tool layer to restrict, so this is stored but not applied."),
    ("skills", "Skill injection for sub-agents is not wired into the agent request."),
    ("mcpServers", "Sub-agents are not given their own MCP server set."),
    ("injectAgentsMd", "AGENTS.md is not injected into a delegated run."),
    ("permissionMode", "Orin Code has one approval-gated mode for every run."),
    ("maxTurns", "A delegated run has no turn budget in the queue."),
];

impl SubAgentConfig {
    /// Validation mirroring what ZCode refuses to store. An unusable config is
    /// better caught here than by a run that silently does the wrong thing.
    pub fn validate(&self) -> Vec<String> {
        let mut issues = Vec::new();
        if self.name.trim().is_empty() {
            issues.push("name must not be empty".to_string());
        }
        if let Some(color) = self.color.as_deref() {
            if !SUBAGENT_COLORS.contains(&color) {
                issues.push(format!("colour must be one of {}", SUBAGENT_COLORS.join(", ")));
            }
        }
        if let Some(mode) = self.permission_mode.as_deref() {
            if !PERMISSION_MODES.contains(&mode) {
                issues.push(format!("permissionMode must be one of {}", PERMISSION_MODES.join(", ")));
            }
        }
        if self.max_turns == Some(0) {
            issues.push("maxTurns must be greater than zero".to_string());
        }
        issues
    }

    /// The agent request this configuration implies, for the fields Orin Code
    /// acts on. Returns the system prompt and model to send.
    pub fn resolve_for_run(&self) -> (Option<String>, Option<String>) {
        let system = if self.system_prompt.trim().is_empty() {
            None
        } else {
            Some(self.system_prompt.clone())
        };
        let model = self
            .model_selection
            .as_ref()
            .and_then(|selection| selection.model_id.clone())
            .filter(|id| !id.trim().is_empty());
        (system, model)
    }
}

pub fn read_manifest(root: &Path) -> SubagentManifest {
    match std::fs::read_to_string(root.join(SUBAGENT_FILE)) {
        Ok(body) => serde_json::from_str(&body).unwrap_or_default(),
        Err(_) => SubagentManifest::default(),
    }
}

pub fn write_manifest(root: &Path, manifest: &SubagentManifest) -> Result<(), String> {
    let body = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("Could not encode the sub-agent file: {error}"))?;
    let dir = root.join(".orin");
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not create .orin: {error}"))?;
    std::fs::write(dir.join("subagents.json"), body)
        .map_err(|error| format!("Could not write the sub-agent file: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> SubAgentConfig {
        SubAgentConfig {
            name: "reviewer".into(),
            description: "Reviews changes before commit.".into(),
            system_prompt: "You review code. Be specific.".into(),
            color: Some("purple".into()),
            model_selection: Some(ModelSelection {
                provider_id: Some("anthropic".into()),
                model_id: Some("claude-sonnet-5".into()),
                options: None,
            }),
            tools: vec![],
            disallowed_tools: vec![],
            inject_agents_md: false,
            skills: vec![],
            permission_mode: Some("default".into()),
            max_turns: Some(12),
            background: true,
            mcp_servers: vec![],
        }
    }

    #[test]
    fn a_config_validates_and_resolves_a_run() {
        let config = sample();
        assert!(config.validate().is_empty(), "{:?}", config.validate());
        let (system, model) = config.resolve_for_run();
        assert_eq!(system.as_deref(), Some("You review code. Be specific."));
        assert_eq!(model.as_deref(), Some("claude-sonnet-5"));
    }

    #[test]
    fn a_config_with_no_system_prompt_resolves_to_none() {
        let mut config = sample();
        config.system_prompt = "   ".into();
        let (system, model) = config.resolve_for_run();
        assert_eq!(system, None, "blank text must not become an empty system prompt");
        assert_eq!(model.as_deref(), Some("claude-sonnet-5"));
    }

    #[test]
    fn invalid_values_are_refused() {
        let mut config = sample();
        config.name = "  ".into();
        assert!(config.validate().iter().any(|i| i.contains("name")));

        let mut config = sample();
        config.color = Some("chartreuse".into());
        assert!(config.validate().iter().any(|i| i.contains("colour")));

        let mut config = sample();
        config.max_turns = Some(0);
        assert!(config.validate().iter().any(|i| i.contains("maxTurns")));

        let mut config = sample();
        config.permission_mode = Some("anything".into());
        assert!(config.validate().iter().any(|i| i.contains("permissionMode")));
    }

    #[test]
    fn the_manifest_round_trips_through_json() {
        let manifest = SubagentManifest { agents: vec![sample()] };
        let json = serde_json::to_string(&manifest).unwrap();
        let back: SubagentManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(back, manifest);
    }

    #[test]
    fn a_corrupt_file_yields_an_empty_manifest_rather_than_failing() {
        let dir = std::env::temp_dir().join("orin-subagents-corrupt-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".orin")).unwrap();
        std::fs::write(dir.join(SUBAGENT_FILE), "{ not json").unwrap();
        assert!(read_manifest(&dir).agents.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn zcode_fields_are_all_present_in_the_serialised_shape() {
        // Guards against a field being dropped from the struct while the UI
        // still offers it. ZCode's set is in subagents-types.ts:93-108.
        let json = serde_json::to_string(&sample()).unwrap();
        for field in [
            "name", "description", "systemPrompt", "color", "modelSelection", "tools",
            "disallowedTools", "injectAgentsMd", "skills", "permissionMode", "maxTurns",
            "background", "mcpServers",
        ] {
            assert!(json.contains(field), "{field} missing from the serialised config");
        }
    }
}

/// List the workspace's sub-agent configurations.
#[tauri::command]
pub fn subagents_list(
    state: tauri::State<'_, super::AppState>,
) -> Result<Vec<SubAgentConfig>, String> {
    let root = state
        .workspace_root
        .lock()
        .map_err(|_| "workspace lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No workspace folder is active.".to_string())?;
    Ok(read_manifest(&root).agents)
}

/// Replace the workspace's sub-agent configurations.
///
/// Refuses the whole write if any entry is invalid, matching ZCode: a partially
/// applied agent set is harder to reason about than a rejected one.
#[tauri::command]
pub fn subagents_write(
    agents: Vec<SubAgentConfig>,
    state: tauri::State<'_, super::AppState>,
) -> Result<Vec<SubAgentConfig>, String> {
    let root = state
        .workspace_root
        .lock()
        .map_err(|_| "workspace lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No workspace folder is active.".to_string())?;
    for agent in &agents {
        let issues = agent.validate();
        if !issues.is_empty() {
            return Err(format!("{}: {}", agent.name, issues.join("; ")));
        }
    }
    write_manifest(&root, &SubagentManifest { agents })?;
    Ok(read_manifest(&root).agents)
}
