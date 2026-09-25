// Bridge: Telegram bot notifications (Bot API, no extra crates).
//
// SECURITY: the bot token is NEVER in source, logs, or errors. It resolves
// at runtime from `ORIN_TELEGRAM_BOT_TOKEN` first, else the OS keyring slot
// `telegram-bot-token` (set once via `telegram_set_token` from Settings).
// Error strings never echo the token — only its presence/absence.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use tauri::State;

use super::AppState;

const KEYRING_SLOT: &str = "telegram-bot-token";
const DEVICE_SECRET_SLOT: &str = "pc-device-signing-secret";
/// Bot API hard limit per message (closer to 4096; keep margin).
const MAX_TEXT_CHARS: usize = 4000;

fn valid_bot_token(token: &str) -> bool {
    let Some((id, secret)) = token.split_once(':') else { return false; };
    !id.is_empty() && id.chars().all(|c| c.is_ascii_digit())
        && secret.len() >= 20
        && secret.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn bot_token() -> Option<String> {
    if let Ok(token) = std::env::var("ORIN_TELEGRAM_BOT_TOKEN") {
        let token = token.trim();
        if valid_bot_token(token) { return Some(token.to_string()); }
    }
    keyring::Entry::new("orin-ai", KEYRING_SLOT)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|token| valid_bot_token(token.trim()))
        .map(|token| token.trim().to_string())
}

/// Store the bot token in the OS keyring. Use this instead of env files when
/// the machine is shared; the value never touches the workspace or SQLite.
#[tauri::command]
pub fn telegram_set_token(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Paste the bot token first.".into());
    }
    // Validate without echoing the token back into an error or log.
    if !valid_bot_token(token.trim()) {
        return Err("That doesn't look like a Bot API token.".into());
    }
    keyring::Entry::new("orin-ai", KEYRING_SLOT)
        .map_err(|e| e.to_string())?
        .set_password(token.trim())
        .map_err(|e| e.to_string())
}

pub(crate) fn device_secret() -> Option<String> {
    keyring::Entry::new("orin-code", DEVICE_SECRET_SLOT)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|value| value.len() >= 32)
}

fn save_device_secret(value: &str) -> Result<(), String> {
    if value.len() < 32 { return Err("Core returned an invalid PC device secret.".into()); }
    keyring::Entry::new("orin-code", DEVICE_SECRET_SLOT)
        .map_err(|e| e.to_string())?
        .set_password(value)
        .map_err(|e| e.to_string())
}

pub(crate) fn verify_grant(grant: &str, task_id: &str, instructions: &str, machine: &str, secret: &str) -> Result<(), String> {
    let (encoded, signature) = grant.split_once('.').ok_or("Phone task approval grant is malformed.")?;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|_| "Invalid PC device secret.")?;
    mac.update(encoded.as_bytes());
    let signature_bytes = URL_SAFE_NO_PAD.decode(signature).map_err(|_| "Phone task approval grant is malformed.")?;
    mac.verify_slice(&signature_bytes).map_err(|_| "Phone task approval grant signature is invalid.")?;
    let payload: serde_json::Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded).map_err(|_| "Phone task approval grant is malformed.")?).map_err(|_| "Phone task approval grant is malformed.")?;
    let expected_hash = format!("{:x}", Sha256::digest(instructions.as_bytes()));
    if payload.get("v").and_then(|v| v.as_u64()) != Some(1)
        || payload.get("taskId").and_then(|v| v.as_str()) != Some(task_id)
        || payload.get("machineId").and_then(|v| v.as_str()) != Some(machine)
        || payload.get("instructionsHash").and_then(|v| v.as_str()) != Some(expected_hash.as_str())
        || payload.get("exp").and_then(|v| v.as_u64()).unwrap_or(0) <= now_ms()
        || !payload.get("allowedTools").and_then(|v| v.as_array()).map(|v| !v.is_empty()).unwrap_or(false)
    {
        return Err("Phone task approval grant does not match this task.".into());
    }
    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// True when a token is available via env or keyring. Never reveals it.
#[tauri::command]
pub fn telegram_has_token() -> bool {
    bot_token().is_some()
}

/// Send `text` to `chat_id` via `sendMessage`. Truncates overlong input;
/// reports reachability/API failures without ever including the token.
#[tauri::command]
pub async fn telegram_notify(
    chat_id: String,
    text: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    let token = bot_token().ok_or(
        "No Telegram bot token configured. Set ORIN_TELEGRAM_BOT_TOKEN or save one in Settings → Models → Telegram.",
    )?;
    if chat_id.trim().is_empty() {
        return Err("Enter the destination chat id first.".into());
    }
    let mut message = text.trim().to_string();
    if message.is_empty() {
        return Err("Nothing to send.".into());
    }
    if message.chars().count() > MAX_TEXT_CHARS {
        let mut end = MAX_TEXT_CHARS;
        while !message.is_char_boundary(end) {
            end -= 1;
        }
        message.truncate(end);
    }
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .post(format!("https://api.telegram.org/bot{token}/sendMessage"))
        .json(&serde_json::json!({ "chat_id": chat_id.trim(), "text": message }))
        .send()
        .await
        .map_err(|_| "Could not reach Telegram. Check the connection and try again.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("Telegram returned HTTP {}.", response.status().as_u16()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bot_token_shape_is_strict() {
        assert!(valid_bot_token("123456789:abcdefghijklmnopqrstuvwxyzABCDEF"));
        assert!(!valid_bot_token("123456789:short"));
        assert!(!valid_bot_token("token/with:path?query"));
    }

    #[test]
    fn truncation_keeps_char_boundary() {
        let mut message = "é".repeat(5000);
        assert!(message.chars().count() > super::MAX_TEXT_CHARS);
        let mut end = super::MAX_TEXT_CHARS;
        while !message.is_char_boundary(end) {
            end -= 1;
        }
        message.truncate(end);
        assert!(message.chars().count() <= super::MAX_TEXT_CHARS);
    }

    #[test]
    fn poll_parses_camel_case_decisions() {
        let body = serde_json::json!({
            "decisions": [
                { "approvalId": "a1", "approved": true },
                { "approvalId": "b2", "approved": false },
            ]
        });
        let decisions = parse_decisions(&body);
        assert_eq!(decisions[0], ("a1".to_string(), true));
        assert_eq!(decisions[1], ("b2".to_string(), false));
        assert!(!decisions.iter().any(|(id, _)| id == "nope"));
        assert!(parse_decisions(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn phone_grant_is_bound_and_expiring() {
        let secret = "device-secret-that-is-at-least-32-characters";
        let instructions = "run the tests";
        let payload = serde_json::json!({
            "v": 1,
            "jti": "nonce-1",
            "taskId": "task-1",
            "machineId": "machine-1",
            "instructionsHash": format!("{:x}", Sha256::digest(instructions.as_bytes())),
            "allowedTools": ["run_command"],
            "exp": now_ms() + 60_000,
        });
        let encoded = URL_SAFE_NO_PAD.encode(payload.to_string());
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(encoded.as_bytes());
        let grant = format!("{encoded}.{}", URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()));
        assert!(verify_grant(&grant, "task-1", instructions, "machine-1", secret).is_ok());
        assert!(verify_grant(&grant, "task-2", instructions, "machine-1", secret).is_err());
        assert!(verify_grant(&grant, "task-1", "different", "machine-1", secret).is_err());
    }
}

// ---------------------------------------------------------------------------
// Phone link: pair this PC with the user's Telegram so agent approvals can
// be answered from the phone (Orin Code bot Approve/Deny buttons).
// Backend: POST {api_base}/api/pc-link (see BACKEND-CONTRACT.md).
// ---------------------------------------------------------------------------

fn api_base() -> String {
    super::auth::api_base()
}

/// Live phone-mirror context for one agent run. Built once at run start;
/// dropped (mirror off) the moment the backend says the phone isn't linked.
#[derive(Clone)]
pub struct PhoneMirror {
    pub api_base: String,
    pub token: String,
    pub machine_id: String,
}

async fn authed(api_base: &str, token: &str, action: &str, extra: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut body = serde_json::Map::new();
    body.insert("action".to_string(), serde_json::Value::String(action.to_string()));
    if let serde_json::Value::Object(map) = extra {
        body.extend(map);
    }
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .post(format!("{api_base}/api/pc-link"))
        .bearer_auth(token)
        .json(&serde_json::Value::Object(body))
        .send()
        .await
        .map_err(|_| "Could not reach orinai.org.".to_string())?;
    let status = response.status().as_u16();
    let value: serde_json::Value = response.json().await.unwrap_or(serde_json::json!({}));
    if status == 401 {
        return Err("session expired".into());
    }
    if status == 404 {
        return Err("phone not linked".into());
    }
    if !(200..300).contains(&status) {
        return Err(value["error"].as_str().unwrap_or("pc-link failed").to_string());
    }
    Ok(value)
}

/// Parse `GET`-style poll bodies: `{ decisions: [{ approvalId, approved }] }`.
fn parse_decisions(body: &serde_json::Value) -> Vec<(String, bool)> {
    body["decisions"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|d| {
                    Some((
                        d.get("approvalId")?.as_str()?.to_string(),
                        d.get("approved")?.as_bool()?,
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Best-effort push of one approval to the linked phone. Returns false when
/// mirroring should be switched off for the rest of the run.
pub async fn mirror_push(
    mirror: &PhoneMirror,
    approval_id: &str,
    tool: &str,
    title: &str,
    detail: &str,
) -> bool {
    authed(
        &mirror.api_base,
        &mirror.token,
        "push",
        serde_json::json!({
            "machine_id": mirror.machine_id,
            "approvalId": approval_id,
            "tool": tool,
            "title": title.chars().take(200).collect::<String>(),
            "detail": detail.chars().take(1000).collect::<String>(),
        }),
    )
    .await
    .is_ok()
}

/// Poll consumed phone decisions. Errors are swallowed (local UI stays king).
pub async fn mirror_poll(mirror: &PhoneMirror) -> Vec<(String, bool)> {
    authed(&mirror.api_base, &mirror.token, "poll", serde_json::json!({ "machine_id": mirror.machine_id }))
        .await
        .map(|body| parse_decisions(&body))
        .unwrap_or_default()
}

/// Try to establish mirroring for an agent run: needs a live session AND a
/// linked phone. Returns None (local-only) on any failure — never blocks.
pub async fn mirror_for_run(state: &AppState) -> Option<PhoneMirror> {
    let token = super::auth::ensure_id_token(state).await.ok()?;
    let api_base = api_base();
    let linked = authed(&api_base, &token, "status", serde_json::json!({ "machine_id": machine_id(state) }))
        .await
        .ok()?
        .get("linked")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !linked {
        return None;
    }
    Some(PhoneMirror { api_base, token, machine_id: machine_id(state) })
}

/// Pairing code for Settings → Notifications ("Link phone"). Registers this
/// machine first so tasks later route ONLY here — never to a stranger's PC.
#[tauri::command]
pub async fn pc_link_start(state: State<'_, AppState>) -> Result<String, String> {
    let token = super::auth::ensure_id_token(state.inner())
        .await
        .map_err(|_| "Sign in to Settings → Account first.".to_string())?;
    let reply = authed(
        &api_base(),
        &token,
        "start",
        serde_json::json!({
            "machine_id": machine_id(state.inner()),
            "machine_name": machine_name(),
        }),
    )
    .await?;
    if let Some(secret) = reply.get("deviceSecret").and_then(|value| value.as_str()) {
        save_device_secret(secret)?;
    }
    reply["code"].as_str().map(str::to_string).ok_or("No pairing code returned.".into())
}

#[tauri::command]
pub async fn pc_link_status(state: State<'_, AppState>) -> Result<bool, String> {
    let token = super::auth::ensure_id_token(state.inner())
        .await
        .map_err(|_| "Sign in to Settings → Account first.".to_string())?;
    let reply = authed(&api_base(), &token, "status", serde_json::json!({ "machine_id": machine_id(state.inner()) })).await?;
    Ok(reply.get("linked").and_then(|v| v.as_bool()).unwrap_or(false))
}

#[tauri::command]
pub async fn pc_link_unlink(state: State<'_, AppState>) -> Result<(), String> {
    let token = super::auth::ensure_id_token(state.inner())
        .await
        .map_err(|_| "Sign in to Settings → Account first.".to_string())?;
    authed(&api_base(), &token, "unlink", serde_json::json!({ "machine_id": machine_id(state.inner()) })).await?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct PhoneTask {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub instructions: String,
    #[serde(rename = "approvalGrant")]
    pub approval_grant: String,
}

/// Oldest queued phone task for MY machine (or null). Machine identity is
/// generated once and kept in local settings — tasks can only ever land on
/// the PC the user linked.
#[tauri::command]
pub async fn pc_task_poll(state: State<'_, AppState>) -> Result<Option<PhoneTask>, String> {
    let token = super::auth::ensure_id_token(state.inner()).await.map_err(|_| "signed-out".to_string())?;
    let machine_id = machine_id(state.inner());
    let reply = authed(
        &api_base(),
        &token,
        "task_poll",
        serde_json::json!({ "machine_id": machine_id }),
    )
    .await?;
    let task = reply.get("task");
    if task.is_none() || task.unwrap().is_null() {
        return Ok(None);
    }
    let task = task.unwrap();
    let task_id = task["taskId"].as_str().ok_or("Phone task is missing taskId.")?.to_string();
    let instructions = task["instructions"].as_str().ok_or("Phone task is missing instructions.")?.to_string();
    let approval_grant = task["approvalGrant"].as_str().ok_or("Phone task is missing its signed approval grant.")?.to_string();
    let secret = device_secret().ok_or("This PC is not enrolled for signed phone approvals. Link it again.")?;
    verify_grant(&approval_grant, &task_id, &instructions, &machine_id, &secret)?;
    Ok(Some(PhoneTask { task_id, instructions, approval_grant }))
}

/// Report a finished phone task; the server forwards the summary to Telegram.
#[tauri::command]
pub async fn pc_task_result(
    task_id: String,
    ok: bool,
    summary: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let token = super::auth::ensure_id_token(state.inner()).await.map_err(|_| "signed-out".to_string())?;
    authed(
        &api_base(),
        &token,
        "task_result",
        serde_json::json!({ "taskId": task_id, "machine_id": machine_id(state.inner()), "ok": ok, "summary": summary }),
    )
    .await?;
    Ok(())
}

pub(crate) fn machine_id(state: &AppState) -> String {
    const KEY: &str = "phone.machine_id";
    if let Some(existing) = super::store::read_setting(state, KEY) {
        if !existing.trim().is_empty() {
            return existing;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = super::store::write_setting(state, KEY, &id);
    id
}

/// Friendly PC name for the bot ("Run this on X?"). OS hostname, sanitized.
pub fn machine_name() -> String {
    let raw = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "My PC".into());
    raw.trim().chars().take(80).collect()
}
