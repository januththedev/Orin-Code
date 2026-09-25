// Bridge: the command surface between the Rust core and the React UI.
// Contract: docs/BRIDGE.md — command/event names must match exactly.
pub mod agent;
pub mod ai;
pub mod ai_impl;
pub mod auth;
pub mod connectors;
pub mod cu;
pub mod fs;
pub mod mcp;
pub mod models_fetch;
pub mod presets;
pub mod store;
pub mod sync;
pub mod telegram;
pub mod term;
pub mod workspace;

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug)]
pub struct PendingApproval {
    pub run_id: String,
    pub expires_at_ms: u64,
}

#[derive(Default)]
pub struct AppState {
    /// Cached path of the SQLite workspace database (opened per command).
    pub db_path: Mutex<Option<std::path::PathBuf>>,
    pub flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Shared with spawned agent/cu run loops so they can poll for decisions.
    /// Arc'd because the command handlers only borrow `AppState`.
    pub approvals: Arc<Mutex<HashMap<String, bool>>>,
    /// Pending approval metadata binds a renderer response to one live run
    /// and gives stale/replayed decisions a hard expiry.
    pub pending_approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
    pub terminals: Mutex<HashMap<String, term::TermHandle>>,
    /// Canonical active workspace. Individual filesystem commands resolve paths
    /// against this root and never accept a renderer-selected root per call.
    pub workspace_root: Mutex<Option<std::path::PathBuf>>,
    /// Cached short-lived Core access token for Orin Cloud calls.
    pub auth_cache: std::sync::Mutex<auth::TokenCache>,
}

impl AppState {
    pub fn register_flag(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut guard) = self.flags.lock() {
            guard.insert(id.to_string(), flag.clone());
        }
        flag
    }

    pub fn trip_flag(&self, id: &str) {
        if let Ok(guard) = self.flags.lock() {
            if let Some(flag) = guard.get(id) {
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }

    pub fn take_flag(&self, id: &str) -> Option<Arc<AtomicBool>> {
        self.flags.lock().ok().and_then(|mut guard| guard.remove(id))
    }

    fn workspace_grants() -> Vec<String> {
        keyring::Entry::new("orin-code", "workspace-grants")
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default()
    }

    pub fn authorize_workspace(&self, root: &std::path::Path) -> Result<(), String> {
        let workspace = workspace::Workspace::from_path(root)?;
        let value = workspace.root().to_string_lossy().into_owned();
        let mut grants = Self::workspace_grants();
        if !grants.iter().any(|grant| grant == &value) {
            grants.push(value);
            keyring::Entry::new("orin-code", "workspace-grants")
                .map_err(|e| e.to_string())?
                .set_password(&serde_json::to_string(&grants).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn set_workspace(&self, root: &std::path::Path) -> Result<(), String> {
        let workspace = workspace::Workspace::from_path(root)?;
        let value = workspace.root().to_string_lossy().into_owned();
        if !Self::workspace_grants().iter().any(|grant| grant == &value) {
            return Err("Re-open the folder in the system picker before using it as a workspace.".into());
        }
        let mut guard = self.workspace_root.lock().map_err(|_| "workspace lock poisoned")?;
        *guard = Some(workspace.root().to_path_buf());
        Ok(())
    }

    pub fn active_workspace(&self) -> Result<workspace::Workspace, String> {
        let root = self
            .workspace_root
            .lock()
            .map_err(|_| "workspace lock poisoned")?
            .clone()
            .ok_or_else(|| "No workspace folder is active.".to_string())?;
        workspace::Workspace::from_path(root)
    }

    pub fn active_root_string(&self) -> Result<String, String> {
        Ok(self.active_workspace()?.root().to_string_lossy().into_owned())
    }
}

pub fn init(app: tauri::AppHandle) {
    log::info!("Orin AI core initialized (v{})", env!("CARGO_PKG_VERSION"));
    let _ = app; // single-instance focus handling can hook here
}

#[tauri::command]
pub fn app_info() -> serde_json::Value {
    serde_json::json!({ "version": env!("CARGO_PKG_VERSION"), "os": std::env::consts::OS })
}
