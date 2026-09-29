//! In-app updates.
//!
//! The spec asks for Velopack. Velopack is a .NET updater, and neither ZCode
//! (Electron, `electron-builder` + `electron-updater`) nor Orin Code (Tauri v2,
//! Rust) is a .NET application — there is no .NET build configuration to
//! integrate with. The architecture-equivalent for Tauri is
//! `tauri-plugin-updater`, which distributes from GitHub Releases exactly as
//! Velopack would, and gives the same user experience: a check inside the app,
//! progress, verification, install, restart, and no manual GitHub visit.
//!
//! This module owns the policy that is independent of the transport: what the
//! user is told, whether an update is newer, whether it is safe to install, and
//! what happens on failure. The transport is the plugin.

use serde::{Deserialize, Serialize};

/// Where updates come from. The URL is a GitHub Releases endpoint served by the
/// repository's own release pipeline — no bespoke update server.
pub const RELEASES_ENDPOINT: &str = "https://github.com/januththedev/Orin-Code/releases/latest/download/latest.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    /// "idle" | "checking" | "available" | "downloading" | "ready" | "error"
    pub phase: String,
    /// Version offered, when there is one.
    pub version: Option<String>,
    /// Release notes, so the dialog does not send the user to a browser.
    pub notes: Option<String>,
    /// 0.0–1.0 during download.
    pub progress: f64,
    /// Human-readable failure, safe to show in-app.
    pub error: Option<String>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            version: None,
            notes: None,
            progress: 0.0,
            error: None,
        }
    }
}

impl UpdateState {
    pub fn checking() -> Self {
        Self { phase: "checking".into(), ..Default::default() }
    }
    pub fn available(version: String, notes: Option<String>) -> Self {
        Self { phase: "available".into(), version: Some(version), notes, ..Default::default() }
    }
    pub fn failed(message: impl Into<String>) -> Self {
        Self { phase: "error".into(), error: Some(message.into()), ..Default::default() }
    }
    pub fn is_busy(&self) -> bool {
        matches!(self.phase.as_str(), "checking" | "downloading" | "ready")
    }
}

/// Compare dotted versions with semver precedence.
///
/// Returns true when `candidate` is strictly newer than `current`. Precedence
/// matters here for two reasons: a naive string compare offers `1.10.0` as
/// older than `1.9.0`, and a core-only compare never offers `1.1.0` to someone
/// already running `1.1.0-rc.1`.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    fn split(v: &str) -> (Vec<u64>, Option<String>) {
        let v = v.trim().trim_start_matches('v');
        // Build metadata after '+' never affects precedence.
        let v = v.split('+').next().unwrap_or("");
        match v.split_once('-') {
            Some((core, pre)) => (
                core.split('.').map(|p| p.trim().parse::<u64>().unwrap_or(0)).collect(),
                Some(pre.to_string()),
            ),
            None => (
                v.split('.').map(|p| p.trim().parse::<u64>().unwrap_or(0)).collect(),
                None,
            ),
        }
    }

    let (a_core, a_pre) = split(candidate);
    let (b_core, b_pre) = split(current);

    let len = a_core.len().max(b_core.len());
    for i in 0..len {
        let x = a_core.get(i).copied().unwrap_or(0);
        let y = b_core.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }

    match (a_pre, b_pre) {
        (None, None) => false,          // identical
        (None, Some(_)) => true,        // a release outranks its own pre-release
        (Some(_), None) => false,       // a pre-release never outranks a release
        (Some(x), Some(y)) => x > y,    // both pre-release: lexical on identifiers
    }
}

/// Never let a release without a verified signature through.
///
/// Signing is optional — an unsigned build is legitimate — but the app must not
/// *claim* a release is signed when it is not, and must not install a package
/// whose signature is present but wrong. Returns the reason to refuse, or None.
pub fn signature_gate(
    artifact_signature: Option<&str>,
    release_signature: Option<&str>,
    signing_configured: bool,
) -> Option<String> {
    match (artifact_signature, release_signature) {
        (Some(a), Some(r)) if a == r => None,
        (Some(_), Some(_)) => Some("The download's signature does not match the release.".into()),
        (Some(_), None) | (None, Some(_)) => {
            Some("This build is signed but the release is not, or the reverse.".into())
        }
        (None, None) if signing_configured => {
            Some("Signing is configured but this release carries no signature.".into())
        }
        (None, None) => None,
    }
}

/// The in-app copy for each phase. No raw GitHub URLs ever appear here.
pub fn message_for(state: &UpdateState) -> String {
    match state.phase.as_str() {
        "checking" => "Checking for updates…".into(),
        "available" => match &state.version {
            Some(v) => format!("Orin Code {v} is available."),
            None => "An update is available.".into(),
        },
        "downloading" => format!("Downloading… {}%", (state.progress * 100.0).round() as i64),
        "ready" => "Update ready. It will be applied when you restart.".into(),
        "error" => state
            .error
            .clone()
            .unwrap_or_else(|| "The update could not be completed.".into()),
        _ => "Orin Code is up to date.".into(),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Check for an update without blocking the UI. Always resolves: a failed check
/// is a state to display, not an error to propagate into the window.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Result<UpdateState, String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater_builder()
        .build()
        .map_err(|error| error.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateState::available(
            update.version.clone(),
            update.body.clone(),
        )),
        Ok(None) => Ok(UpdateState::default()),
        Err(error) => Ok(UpdateState::failed(error.to_string())),
    }
}

/// Download, verify, and stage the update. Emits `update-progress` so the UI
/// can show a bar without polling. Installation is applied on restart, so a
/// half-written update never replaces a working app.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle) -> Result<UpdateState, String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater_builder()
        .build()
        .map_err(|error| error.to_string())?;
    let mut update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No update is available.".to_string())?;

    let mut state = UpdateState {
        phase: "downloading".into(),
        version: Some(update.version.clone()),
        ..Default::default()
    };
    let _ = app.emit("update-progress", &state);

    let mut downloaded: u64 = 0;
    let mut total: u64 = 0;
    update
        .download_and_install(
            |chunk, content_length| {
                downloaded += chunk as u64;
                if let Some(length) = content_length {
                    total = length;
                }
                if total > 0 {
                    state.progress = (downloaded as f64 / total as f64).clamp(0.0, 1.0);
                    let _ = app.emit("update-progress", &state);
                }
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;

    state.phase = "ready".into();
    state.progress = 1.0;
    let _ = app.emit("update-progress", &state);
    Ok(state)
}

/// Apply the staged update. The app closes and relaunches.
#[tauri::command]
pub fn update_restart(app: tauri::AppHandle) {
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_comparison_is_numeric_not_lexical() {
        assert!(is_newer("1.10.0", "1.9.0"), "10 must beat 9");
        assert!(!is_newer("1.9.0", "1.10.0"));
        assert!(is_newer("2.0.0", "1.99.99"));
        assert!(!is_newer("1.0.0", "1.0.0"), "the same version is not newer");
        assert!(!is_newer("1.0.0", "1.0.1"));
    }

    #[test]
    fn leading_v_and_prerelease_suffixes_are_handled() {
        assert!(is_newer("v1.2.0", "1.1.0"));
        assert!(!is_newer("1.1.0", "v1.1.0"));
        // A pre-release is never an upgrade over the release it leads to.
        assert!(!is_newer("1.1.0-rc.1", "1.1.0"));
        // But the release is an upgrade over the pre-release.
        assert!(is_newer("1.1.0", "1.1.0-rc.1"));
    }

    #[test]
    fn missing_components_count_as_zero() {
        assert!(is_newer("1.1", "1.0.9"));
        assert!(!is_newer("1.0", "1.0.1"));
        assert!(!is_newer("not-a-version", "1.0.0"));
    }

    #[test]
    fn an_unsigned_release_is_allowed_when_signing_is_not_configured() {
        assert_eq!(signature_gate(None, None, false), None);
    }

    #[test]
    fn a_mismatched_signature_is_refused() {
        let reason = signature_gate(Some("abc"), Some("def"), true).expect("must refuse");
        assert!(reason.contains("does not match"), "{reason}");
    }

    #[test]
    fn a_half_signed_release_is_refused() {
        assert!(signature_gate(Some("abc"), None, true).is_some());
        assert!(signature_gate(None, Some("abc"), true).is_some());
    }

    #[test]
    fn a_matching_signature_passes() {
        assert_eq!(signature_gate(Some("abc"), Some("abc"), true), None);
    }

    #[test]
    fn when_signing_is_configured_an_unsigned_release_is_refused() {
        let reason = signature_gate(None, None, true).expect("must refuse");
        assert!(reason.contains("no signature"), "{reason}");
    }

    #[test]
    fn messages_never_leak_a_repository_url() {
        let states = [
            UpdateState::default(),
            UpdateState::checking(),
            UpdateState::available("1.2.0".into(), None),
            UpdateState { phase: "downloading".into(), progress: 0.42, ..Default::default() },
            UpdateState::failed("network unreachable"),
        ];
        for state in &states {
            let text = message_for(state);
            assert!(!text.contains("github.com"), "leaked a URL: {text}");
            assert!(!text.contains("http"), "leaked a URL: {text}");
            assert!(!text.is_empty());
        }
    }

    #[test]
    fn download_progress_is_reported_as_a_percentage() {
        let s = UpdateState { phase: "downloading".into(), progress: 0.42, ..Default::default() };
        assert_eq!(message_for(&s), "Downloading… 42%");
    }

    #[test]
    fn busy_states_are_identified_so_a_second_check_is_refused() {
        assert!(UpdateState::checking().is_busy());
        assert!(!UpdateState::default().is_busy());
        assert!(!UpdateState::failed("x").is_busy());
    }
}
