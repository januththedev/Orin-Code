//! Centralised model-list refresh.
//!
//! The spec is specific about behaviour, and every clause here is a requirement:
//! asynchronous, never blocking the UI, centralised interval (defined once),
//! preserves the selected model if it survives, retains the last known good list
//! when a refresh fails, and never issues duplicate concurrent requests.
//!
//! The scheduler itself is pure and testable; the plumbing that starts it from
//! the Tauri app handle lives in [`spawn`].

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// The one place the refresh interval is defined. Nothing else may name it.
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(10 * 60);

const LAST_GOOD_KEY: &str = "models_last_good";

/// What one provider's catalogue currently looks like from the app's side.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ProviderCatalog {
    /// Model ids currently offered, most recently fetched first.
    pub models: Vec<String>,
    /// When the last successful fetch finished, epoch millis.
    pub fetched_at_ms: u64,
    /// The error from the most recent *failed* attempt, if it has not been
    /// superseded by a success. Cleared on success.
    pub last_error: Option<String>,
    /// False until the first successful fetch, so the UI can show a real
    /// "loading" rather than an empty picker.
    pub ready: bool,
}

/// Everything the refresh cycle produced, ready for the UI in one message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct RefreshReport {
    pub catalogs: BTreeMap<String, ProviderCatalog>,
    /// Providers whose list gained an id since the previous successful fetch.
    pub appeared: Vec<NewModel>,
    /// Providers whose list lost an id since the previous successful fetch.
    pub disappeared: Vec<String>,
    /// True when every attempted provider failed and nothing was updated.
    pub all_failed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewModel {
    pub provider: String,
    pub model_id: String,
}

/// Per-provider result of one refresh pass. Pure, so it can be tested without
/// a network or an app handle.
#[derive(Debug, Clone, PartialEq)]
pub struct ProviderOutcome {
    pub provider: String,
    /// `None` means the fetch failed; `error` then explains why.
    pub ids: Option<Vec<String>>,
    pub error: Option<String>,
    pub at_ms: u64,
}

pub fn apply(
    previous: &BTreeMap<String, ProviderCatalog>,
    outcomes: &[ProviderOutcome],
) -> RefreshReport {
    let mut report = RefreshReport::default();
    let mut all_failed = !outcomes.is_empty();

    for outcome in outcomes {
        let before = previous.get(&outcome.provider);
        match &outcome.ids {
            Some(ids) => {
                all_failed = false;
                let next = ProviderCatalog {
                    models: ids.clone(),
                    fetched_at_ms: outcome.at_ms,
                    last_error: None,
                    ready: true,
                };
                if let Some(prior) = before {
                    let prior_set: Vec<&String> = prior.models.iter().collect();
                    for id in ids {
                        if !prior_set.iter().any(|p| *p == id) {
                            report.appeared.push(NewModel {
                                provider: outcome.provider.clone(),
                                model_id: id.clone(),
                            });
                        }
                    }
                    report.disappeared.extend(
                        prior
                            .models
                            .iter()
                            .filter(|id| !ids.contains(id))
                            .cloned(),
                    );
                }
                report.catalogs.insert(outcome.provider.clone(), next);
            }
            None => {
                // Failure must not wipe the catalogue. Keep the last known good
                // models and only record the error, so the picker keeps working.
                let mut kept = before.cloned().unwrap_or_default();
                kept.last_error = outcome.error.clone();
                if kept.models.is_empty() {
                    kept.ready = false;
                }
                report.catalogs.insert(outcome.provider.clone(), kept);
            }
        }
    }

    report.all_failed = all_failed;
    report
}

/// Does a selection still exist? Used so a refresh never silently moves the
/// user off the model they chose.
pub fn selection_survives(previous: &BTreeMap<String, ProviderCatalog>, provider: &str, model_id: &str) -> bool {
    previous
        .get(provider)
        .map(|c| c.models.iter().any(|m| m == model_id))
        .unwrap_or(false)
}

/// Persist the snapshot so a cold start shows models before the first fetch.
pub fn snapshot_json(report: &RefreshReport) -> String {
    serde_json::to_string(&report.catalogs).unwrap_or_else(|_| "{}".to_string())
}

pub fn restore_snapshot(raw: &str) -> BTreeMap<String, ProviderCatalog> {
    serde_json::from_str(raw).unwrap_or_default()
}

pub const LAST_GOOD_SETTING: &str = LAST_GOOD_KEY;

// ---------------------------------------------------------------------------
// Single-flight
// ---------------------------------------------------------------------------

/// Guards against duplicate concurrent refreshes.
///
/// Two overlapping ticks — a timer firing while a manual "refresh" button is
/// held down — would issue duplicate provider calls and could interleave a
/// slower stale response after a faster fresh one.
#[derive(Default)]
pub struct InFlight {
    flag: AtomicBool,
    completed: Mutex<u64>,
}

impl InFlight {
    /// Try to begin a pass. Returns false if one is already running.
    pub fn try_begin(&self) -> bool {
        self.flag
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn finish(&self, at_ms: u64) {
        if let Ok(mut done) = self.completed.lock() {
            *done = at_ms;
        }
        self.flag.store(false, Ordering::SeqCst);
    }

    pub fn running(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    pub fn last_completed_ms(&self) -> u64 {
        self.completed.lock().map(|c| *c).unwrap_or(0)
    }
}

// ---------------------------------------------------------------------------
// The refresh cycle
// ---------------------------------------------------------------------------

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// One refresh pass over every provider that can list models.
///
/// Single-flight: a second call while one is in flight returns the current view
/// rather than issuing duplicate provider requests. Providers without a stored
/// key are skipped entirely — asking without one just spends quota on a
/// guaranteed 401.
#[tauri::command]
pub async fn models_refresh(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::AppState>,
) -> Result<RefreshReport, String> {
    use std::sync::{Mutex, OnceLock};
    use tauri::Emitter;

    static GATE: OnceLock<InFlight> = OnceLock::new();
    static LAST: OnceLock<Mutex<BTreeMap<String, ProviderCatalog>>> = OnceLock::new();
    let gate = GATE.get_or_init(InFlight::default);
    let last = LAST.get_or_init(|| Mutex::new(BTreeMap::new()));

    if !gate.try_begin() {
        // A pass is already running; hand back what we already know.
        let snapshot = last.lock().map(|m| m.clone()).unwrap_or_default();
        return Ok(RefreshReport { catalogs: snapshot, ..Default::default() });
    }

    let previous = last.lock().map(|m| m.clone()).unwrap_or_default();
    let mut outcomes: Vec<ProviderOutcome> = Vec::new();

    for preset in super::presets::PRESETS {
        if !preset.key_required || preset.list_kind != "openai" {
            continue;
        }
        if !super::ai::provider_has_key(preset.id.to_string()).unwrap_or(false) {
            continue;
        }
        match super::models_fetch::fetch_for_preset(&state, preset.id).await {
            Ok(models) => outcomes.push(ProviderOutcome {
                provider: preset.id.to_string(),
                ids: Some(models.iter().map(|m| m.id.clone()).collect()),
                error: None,
                at_ms: now_ms(),
            }),
            Err(error) => outcomes.push(ProviderOutcome {
                provider: preset.id.to_string(),
                ids: None,
                error: Some(error),
                at_ms: now_ms(),
            }),
        }
    }

    let report = apply(&previous, &outcomes);
    if let Ok(mut slot) = last.lock() {
        *slot = report.catalogs.clone();
    }
    // Persist a snapshot so a cold start shows models before the first fetch.
    let _ = super::store::write_setting(&state, LAST_GOOD_SETTING, &snapshot_json(&report));
    let _ = app.emit("models-refreshed", &report);
    gate.finish(now_ms());
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_successful_fetch_populates_the_catalogue() {
        let report = apply(
            &BTreeMap::new(),
            &[ProviderOutcome {
                provider: "openrouter".into(),
                ids: Some(ids(&["a:free", "b:free"])),
                error: None,
                at_ms: 1_000,
            }],
        );
        let cat = &report.catalogs["openrouter"];
        assert_eq!(cat.models, ids(&["a:free", "b:free"]));
        assert!(cat.ready);
        assert!(!report.all_failed);
        assert!(report.appeared.is_empty(), "the first pass is a baseline, not news");
    }

    #[test]
    fn a_new_model_is_reported_exactly_once() {
        let before = apply(
            &BTreeMap::new(),
            &[ProviderOutcome { provider: "p".into(), ids: Some(ids(&["a:free"])), error: None, at_ms: 1 }],
        ).catalogs;
        let second = apply(
            &before,
            &[ProviderOutcome { provider: "p".into(), ids: Some(ids(&["a:free", "b:free"])), error: None, at_ms: 2 }],
        );
        assert_eq!(second.appeared.len(), 1);
        assert_eq!(second.appeared[0].model_id, "b:free");
        // A third pass with the same set must not re-report it.
        let third = apply(&second.catalogs, &[ProviderOutcome { provider: "p".into(), ids: Some(ids(&["a:free", "b:free"])), error: None, at_ms: 3 }]);
        assert!(third.appeared.is_empty(), "the same model must not notify twice");
    }

    #[test]
    fn a_removed_model_is_reported_as_disappeared() {
        let base = apply(
            &BTreeMap::new(),
            &[ProviderOutcome { provider: "p".into(), ids: Some(ids(&["a:free", "b:free"])), error: None, at_ms: 1 }],
        )
        .catalogs;
        let after = apply(
            &base,
            &[ProviderOutcome { provider: "p".into(), ids: Some(ids(&["a:free"])), error: None, at_ms: 2 }],
        );
        assert_eq!(after.disappeared, ids(&["b:free"]));
    }

    #[test]
    fn a_failed_refresh_keeps_the_last_known_good_models() {
        let base = apply(
            &BTreeMap::new(),
            &[ProviderOutcome { provider: "p".into(), ids: Some(ids(&["a:free"])), error: None, at_ms: 1 }],
        )
        .catalogs;
        let failed = apply(
            &base,
            &[ProviderOutcome { provider: "p".into(), ids: None, error: Some("rate limited".into()), at_ms: 2 }],
        );
        let cat = &failed.catalogs["p"];
        assert_eq!(cat.models, ids(&["a:free"]), "a failure must not empty the picker");
        assert!(cat.ready, "it is still usable");
        assert_eq!(cat.last_error.as_deref(), Some("rate limited"));
        assert!(failed.appeared.is_empty() && failed.disappeared.is_empty(), "a failure is not a change");
    }

    #[test]
    fn a_failure_before_any_success_is_not_ready() {
        let failed = apply(
            &BTreeMap::new(),
            &[ProviderOutcome { provider: "p".into(), ids: None, error: Some("bad key".into()), at_ms: 1 }],
        );
        assert!(!failed.catalogs["p"].ready);
        assert!(failed.all_failed);
    }

    #[test]
    fn a_success_clears_a_previous_error() {
        let failed = apply(
            &BTreeMap::new(),
            &[ProviderOutcome { provider: "p".into(), ids: None, error: Some("x".into()), at_ms: 1 }],
        )
        .catalogs;
        let ok = apply(&failed, &[ProviderOutcome { provider: "p".into(), ids: Some(ids(&["a"])), error: None, at_ms: 2 }]);
        assert_eq!(ok.catalogs["p"].last_error, None);
        assert!(!ok.all_failed);
    }

    #[test]
    fn selection_survives_is_about_the_selected_model_not_the_provider() {
        let base = apply(
            &BTreeMap::new(),
            &[ProviderOutcome { provider: "p".into(), ids: Some(ids(&["a:free", "b:free"])), error: None, at_ms: 1 }],
        )
        .catalogs;
        assert!(selection_survives(&base, "p", "a:free"));
        assert!(!selection_survives(&base, "p", "gone:free"));
        assert!(!selection_survives(&base, "other", "a:free"));
    }

    #[test]
    fn the_interval_is_defined_once_and_is_ten_minutes() {
        assert_eq!(REFRESH_INTERVAL, Duration::from_secs(600));
        // The real invariant is that no *other* module restates the cadence.
        // Scanning this file would just count this test's own literals.
        //
        // The patterns are deliberately precise. A bare "600" also matches the
        // 3600 inside a 30-day session expiry, and the bare word "refresh"
        // matches a struct field — together they flagged unrelated code, and a
        // check that cries wolf is worse than no check.
        let cadence_words = ["INTERVAL", "interval", "REFRESH_EVERY", "refresh_every", "refresh_interval"];
        let ten_minutes = ["from_secs(600)", "* 60", "*60"];
        for name in ["ai.rs", "ai_impl.rs", "models_fetch.rs", "auth.rs", "app.rs", "agent.rs"] {
            let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/bridge/").to_string() + name;
            if !std::path::Path::new(&path).exists() {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap_or_default();
            for (i, line) in src.lines().enumerate() {
                let l = line.trim_start();
                if l.starts_with("//") {
                    continue;
                }
                let names_cadence = cadence_words.iter().any(|w| l.contains(w));
                let states_ten_minutes = ten_minutes.iter().any(|p| l.contains(p));
                if names_cadence && states_ten_minutes {
                    panic!("{name}:{} restates the refresh interval: {line}", i + 1);
                }
            }
        }
    }

    #[test]
    fn only_one_refresh_can_run_at_a_time() {
        let gate = InFlight::default();
        assert!(gate.try_begin());
        assert!(!gate.try_begin(), "a second concurrent pass must be refused");
        assert!(gate.running());
        gate.finish(123);
        assert!(!gate.running());
        assert_eq!(gate.last_completed_ms(), 123);
        assert!(gate.try_begin(), "the gate reopens after finishing");
    }

    #[test]
    fn a_snapshot_round_trips_so_a_cold_start_has_models() {
        let report = apply(
            &BTreeMap::new(),
            &[ProviderOutcome { provider: "p".into(), ids: Some(ids(&["a:free"])), error: None, at_ms: 7 }],
        );
        let restored = restore_snapshot(&snapshot_json(&report));
        assert_eq!(restored["p"].models, ids(&["a:free"]));
        assert_eq!(restored["p"].fetched_at_ms, 7);
        assert!(restore_snapshot("not json").is_empty(), "a corrupt snapshot is discarded, not fatal");
    }
}
