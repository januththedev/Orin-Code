//! The always-on-top pet window.
//!
//! A small, transparent, always-on-top, skip-taskbar window that sits above
//! other apps and shows one glanceable status line. It is deliberately not a
//! second control surface: it reports state and can bring the app forward, but
//! it cannot be clicked into doing anything.
//!
//! Only one copy of the state exists. The main window writes it and the pet
//! window reads it, and both are rendered from the same bundle, so there is
//! nothing to keep in sync.

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mood {
    Idle,
    Working,
    Waiting,
    Error,
    Happy,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetStatus {
    pub label: String,
    pub mood: Mood,
    /// 0.0-1.0. Drives the animation; kept coarse on purpose.
    pub activity: f32,
}

impl Default for PetStatus {
    fn default() -> Self {
        Self { label: "Ready".into(), mood: Mood::Idle, activity: 0.05 }
    }
}

const MAX_LABEL_CHARS: usize = 48;

/// Keep the glance short and plain. The pet shows whatever it is told, so this
/// clamp is the only thing between a chat title and a one-line window.
pub fn sanitise_label(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.chars().count() <= MAX_LABEL_CHARS {
        trimmed
    } else {
        trimmed.chars().take(MAX_LABEL_CHARS - 1).chain(['…']).collect()
    }
}

/// Clamp activity into 0..=1 so a bad value cannot drive a runaway animation.
pub fn sanitise_activity(raw: f32) -> f32 {
    if raw.is_nan() {
        return 0.0;
    }
    raw.clamp(0.0, 1.0)
}

pub fn sanitise(raw: PetStatus) -> PetStatus {
    PetStatus {
        label: sanitise_label(&raw.label),
        mood: raw.mood,
        activity: sanitise_activity(raw.activity),
    }
}

fn pet_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("pet")
        .ok_or_else(|| "The pet window is not configured.".to_string())
}

#[tauri::command]
pub fn pet_set(app: tauri::AppHandle, status: PetStatus) -> Result<(), String> {
    let clean = sanitise(status);
    pet_window(&app)?.emit("pet://status", &clean).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pet_toggle(app: tauri::AppHandle) -> Result<bool, String> {
    let window = pet_window(&app)?;
    let visible = window.is_visible().unwrap_or(false);
    if visible {
        window.hide().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.show().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub fn pet_focus(app: tauri::AppHandle) -> Result<(), String> {
    let window = pet_window(&app)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ESC: char = '\u{1b}';
    const NUL: char = '\u{0}';
    const BEL: char = '\u{7}';

    #[test]
    fn a_label_is_collapsed_and_bounded() {
        assert_eq!(sanitise_label("  reading   a page  "), "reading a page");
        let long = "x".repeat(200);
        assert_eq!(sanitise_label(&long).chars().count(), MAX_LABEL_CHARS);
        assert!(sanitise_label(&long).ends_with('…'));
    }

    #[test]
    fn control_characters_never_reach_the_window() {
        let dirty = format!("Replying{ESC}\n{NUL}{BEL}now");
        let clean = sanitise_label(&dirty);
        assert!(!clean.chars().any(char::is_control), "{clean:?}");
        assert_eq!(clean, "Replying now");
    }

    #[test]
    fn an_odd_label_does_not_break_anything() {
        assert_eq!(sanitise_label(""), "");
        assert_eq!(sanitise_label("   "), "");
    }

    #[test]
    fn activity_is_clamped_and_nan_is_neutral() {
        assert_eq!(sanitise_activity(-5.0), 0.0);
        assert_eq!(sanitise_activity(9.0), 1.0);
        assert_eq!(sanitise_activity(0.4), 0.4);
        assert_eq!(sanitise_activity(f32::NAN), 0.0, "NaN must not reach an animation");
    }

    #[test]
    fn a_whole_status_is_sanitised_at_once() {
        let clean = sanitise(PetStatus {
            label: "  doing   something ".into(),
            mood: Mood::Working,
            activity: 4.2,
        });
        assert_eq!(clean.label, "doing something");
        assert_eq!(clean.activity, 1.0);
        assert_eq!(clean.mood, Mood::Working);
    }
}
