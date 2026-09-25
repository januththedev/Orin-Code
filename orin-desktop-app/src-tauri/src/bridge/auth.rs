// Orin Core account bridge. Cloud credentials never enter the renderer.
// The desktop uses Core device PKCE; refresh tokens live in the OS keyring.
use super::store;
use super::AppState;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

pub const DEFAULT_API_BASE: &str = "https://orinai.org";
const SESSION_KEY: &str = "auth.session";
const STALE_MS: u64 = 120_000;
const CLIENT_ID: &str = "orin-code-desktop";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Session {
    pub uid: String,
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub phone: String,
    #[serde(rename = "authKind", alias = "auth_kind", default = "default_auth_kind")]
    pub auth_kind: String,
}
fn default_auth_kind() -> String { "core".into() }

#[derive(Serialize)]
pub struct AuthStatus {
    #[serde(rename = "signedIn")]
    pub signed_in: bool,
    pub session: Option<Session>,
}
#[derive(Default)]
pub struct TokenCache {
    pub id_token: Option<String>,
    pub expires_at_ms: Option<u64>,
    pub pkce_verifier: Option<String>,
}
pub fn is_stale(expires_at_ms: u64, now_ms: u64) -> bool { now_ms + STALE_MS >= expires_at_ms }
pub fn api_base() -> String {
    let raw = std::env::var("ORIN_API_BASE").unwrap_or_else(|_| DEFAULT_API_BASE.to_string());
    let Ok(url) = url::Url::parse(&raw) else { return DEFAULT_API_BASE.to_string(); };
    let local = url.host_str().map(|h| h == "127.0.0.1" || h == "localhost").unwrap_or(false);
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return DEFAULT_API_BASE.to_string();
    }
    url.origin().ascii_serialization()
}
fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }
pub fn backend_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(timeout_secs)).build().map_err(|e| e.to_string())
}
async fn post_json(url: &str, body: serde_json::Value, bearer: Option<&str>) -> Result<serde_json::Value, String> {
    let mut request = backend_client(25)?.post(url).json(&body);
    if let Some(token) = bearer { request = request.bearer_auth(token); }
    decode_response(request.send().await).await
}

async fn post_legacy_json(url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let request = backend_client(25)?
        .post(url)
        .header("X-Orin-Legacy-Token", "1")
        .json(&body);
    decode_response(request.send().await).await
}

async fn decode_response(response: Result<reqwest::Response, reqwest::Error>) -> Result<serde_json::Value, String> {
    let response = response.map_err(|e| format!("Network error contacting Orin Core: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::json!({ "error": text }));
    if !status.is_success() {
        let message = value.pointer("/error/message").and_then(|v| v.as_str()).or_else(|| value.get("error").and_then(|v| v.as_str())).unwrap_or("request failed");
        return Err(format!("Orin Core request failed ({status}): {message}"));
    }
    Ok(value)
}
fn load_session(state: &AppState) -> Option<Session> { store::read_setting(state, SESSION_KEY).and_then(|raw| serde_json::from_str(&raw).ok()) }
pub fn has_session(state: &AppState) -> bool { load_session(state).is_some() }
fn save_session(state: &AppState, session: &Session) -> Result<(), String> { store::write_setting(state, SESSION_KEY, &serde_json::to_string(session).map_err(|e| e.to_string())?) }
fn keyring_slot(uid: &str) -> String { format!("orin-core:refresh:{uid}") }
fn store_refresh(uid: &str, token: &str) -> Result<(), String> { keyring::Entry::new("orin-code", &keyring_slot(uid)).and_then(|e| e.set_password(token)).map_err(|e| e.to_string()) }
fn load_refresh(uid: &str) -> Option<String> { keyring::Entry::new("orin-code", &keyring_slot(uid)).ok().and_then(|e| e.get_password().ok()) }
fn clear_refresh(uid: &str) { if let Ok(entry) = keyring::Entry::new("orin-code", &keyring_slot(uid)) { let _ = entry.delete_password(); } }
struct Tokens { access: String, refresh: String, expires_in: u64 }
fn parse_tokens(value: &serde_json::Value) -> Result<Tokens, String> {
    let access = value.get("access_token").and_then(|v| v.as_str()).ok_or("Core returned no access token")?.to_string();
    let refresh = value.get("refresh_token").and_then(|v| v.as_str()).ok_or("Core returned no refresh token")?.to_string();
    let expires = value.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(900);
    Ok(Tokens { access, refresh, expires_in: expires })
}
async fn persist_tokens(state: &AppState, tokens: Tokens, session: Session) -> Result<Session, String> {
    if tokens.refresh.is_empty() {
        clear_refresh(&session.uid);
    } else {
        store_refresh(&session.uid, &tokens.refresh)?;
    }
    save_session(state, &session)?;
    let mut cache = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?;
    cache.expires_at_ms = Some(now_ms() + tokens.expires_in * 1000);
    cache.id_token = Some(tokens.access);
    Ok(session)
}
async fn introspect_session(access: &str) -> Result<Session, String> {
    let value = post_json(&format!("{}/api/auth/session/introspect", api_base()), serde_json::json!({}), Some(access)).await?;
    let uid = value.get("uid").and_then(|v| v.as_str()).ok_or("Core returned no uid")?.to_string();
    let email = value.get("email").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let name = email.split('@').next().filter(|s| !s.is_empty()).unwrap_or("Orin user").to_string();
    Ok(Session { uid, name, email, phone: String::new(), auth_kind: "core".into() })
}
async fn refresh_session(state: &AppState, session: &Session) -> Result<String, String> {
    if session.auth_kind != "device" {
        return Err("Your session expired. Sign in again.".into());
    }
    let refresh = load_refresh(&session.uid).ok_or("signed in but no refresh credential")?;
    let value = post_json(&format!("{}/api/auth/device", api_base()), serde_json::json!({ "action": "refresh", "refresh_token": refresh }), None).await?;
    let tokens = parse_tokens(&value)?;
    store_refresh(&session.uid, &tokens.refresh)?;
    let mut cache = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?;
    cache.id_token = Some(tokens.access.clone());
    cache.expires_at_ms = Some(now_ms() + tokens.expires_in * 1000);
    Ok(tokens.access)
}
pub async fn ensure_id_token(state: &AppState) -> Result<String, String> {
    { let cache = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?; if let (Some(token), Some(exp)) = (&cache.id_token, cache.expires_at_ms) { if !is_stale(exp, now_ms()) { return Ok(token.clone()); } } }
    let session = load_session(state).ok_or("signed-out")?;
    refresh_session(state, &session).await
}
#[tauri::command]
pub async fn auth_login(identifier: String, password: String, state: State<'_, AppState>) -> Result<Session, String> {
    if identifier.trim().is_empty() || password.is_empty() { return Err("Enter your email and password.".into()); }
    let value = post_legacy_json(&format!("{}/api/auth/password", api_base()), serde_json::json!({ "action": "login", "identifier": identifier.trim(), "password": password })).await?;
    let token = value.get("sessionToken").and_then(|v| v.as_str()).ok_or("Core returned no session token")?;
    let mut session = introspect_session(token).await?;
    session.auth_kind = "password".into();
    persist_tokens(state.inner(), Tokens { access: token.to_string(), refresh: String::new(), expires_in: 30 * 24 * 3600 }, session).await
}
#[tauri::command]
pub async fn auth_register(name: String, email: String, phone: String, password: String, state: State<'_, AppState>) -> Result<Session, String> {
    if name.trim().is_empty() || email.trim().is_empty() || password.len() < 8 { return Err("Name, email, and an 8+ character password are required.".into()); }
    let value = post_legacy_json(&format!("{}/api/auth/password", api_base()), serde_json::json!({ "action": "register", "name": name.trim(), "email": email.trim(), "phone": phone.trim(), "password": password })).await?;
    let token = value.get("sessionToken").and_then(|v| v.as_str()).ok_or("Core returned no session token")?;
    let mut session = introspect_session(token).await?;
    session.name = name.trim().to_string();
    session.auth_kind = "password".into();
    persist_tokens(state.inner(), Tokens { access: token.to_string(), refresh: String::new(), expires_in: 30 * 24 * 3600 }, session).await
}
#[tauri::command]
pub fn auth_status(state: State<'_, AppState>) -> AuthStatus { match load_session(&state) { Some(session) => AuthStatus { signed_in: true, session: Some(session) }, None => AuthStatus { signed_in: false, session: None } } }
#[tauri::command]
pub async fn backend_status() -> Result<serde_json::Value, String> {
    let started = now_ms();
    let response = backend_client(10)?.get(format!("{}/api/chat", api_base())).send().await;
    match response { Ok(response) => Ok(serde_json::json!({ "reachable": true, "latencyMs": now_ms().saturating_sub(started), "httpStatus": response.status().as_u16() })), Err(_) => Err("Could not reach Orin Core.".into()) }
}
#[tauri::command]
pub fn auth_logout(state: State<'_, AppState>) -> Result<(), String> { if let Some(session) = load_session(&state) { clear_refresh(&session.uid); } store::delete_setting(&state, SESSION_KEY)?; let mut cache = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?; *cache = TokenCache::default(); Ok(()) }
fn open_in_browser(url: &str) { let _ = std::process::Command::new(match std::env::consts::OS { "windows" => "explorer", "macos" => "open", _ => "xdg-open" }).arg(url).spawn(); }
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> { let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL".to_string())?; if !matches!(parsed.scheme(), "https" | "http") || !parsed.username().is_empty() || parsed.password().is_some() { return Err("Only safe http(s) URLs can be opened.".into()); } open_in_browser(parsed.as_str()); Ok(()) }
#[derive(Serialize)]
pub struct DeviceStart { #[serde(rename = "deviceCode")] pub device_code: String, #[serde(rename = "userCode")] pub user_code: String, #[serde(rename = "verifyUrl")] pub verify_url: String, #[serde(rename = "expiresInSecs")] pub expires_in_secs: u64 }
fn pkce() -> (String, String) { let verifier = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple()); let digest = Sha256::digest(verifier.as_bytes()); (verifier, URL_SAFE_NO_PAD.encode(digest)) }
#[tauri::command]
pub async fn auth_device_start(state: State<'_, AppState>) -> Result<DeviceStart, String> {
    let (verifier, challenge) = pkce();
    let value = post_json(&format!("{}/api/auth/device", api_base()), serde_json::json!({ "action": "start", "client_id": CLIENT_ID, "code_challenge": challenge, "code_challenge_method": "S256", "scopes": ["chat:use", "account:read", "tools:use", "code:use"], "product": "orin-code", "client_version": env!("CARGO_PKG_VERSION") }), None).await?;
    let start = DeviceStart { device_code: value.get("device_code").and_then(|v| v.as_str()).ok_or("no device_code")?.to_string(), user_code: value.get("user_code").and_then(|v| v.as_str()).ok_or("no user_code")?.to_string(), verify_url: value.get("verification_uri").and_then(|v| v.as_str()).ok_or("no verification_uri")?.to_string(), expires_in_secs: value.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(480) };
    { let mut cache = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?; cache.pkce_verifier = Some(verifier); }
    open_external(start.verify_url.clone())?;
    Ok(start)
}
#[tauri::command]
pub async fn auth_device_wait(device_code: String, state: State<'_, AppState>) -> Result<Session, String> {
    if device_code.len() < 40 || device_code.len() > 128 { return Err("Invalid device code".into()); }
    let verifier = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?.pkce_verifier.clone().ok_or("Start sign-in again")?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(9 * 60);
    loop {
        let value = post_json(&format!("{}/api/auth/device", api_base()), serde_json::json!({ "action": "token", "client_id": CLIENT_ID, "device_code": device_code, "code_verifier": verifier }), None).await?;
        match value.get("status").and_then(|v| v.as_str()).unwrap_or("pending") {
            "pending" => {}
            "denied" => return Err("Sign-in was denied in the browser.".into()),
            "expired" => return Err("Sign-in expired; start again.".into()),
            "approved" => { let tokens = parse_tokens(&value)?; let mut session = introspect_session(&tokens.access).await?; session.auth_kind = "device".into(); return persist_tokens(state.inner(), tokens, session).await; }
            _ => return Err("Unexpected device response.".into()),
        }
        if std::time::Instant::now() >= deadline { return Err("Timed out waiting for approval.".into()); }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn stale_boundaries() { assert!(!is_stale(900_000, 0)); assert!(is_stale(900_000, 800_000)); }
    #[test] fn pkce_is_s256() { let (verifier, challenge) = pkce(); assert_eq!(verifier.len(), 64); assert_eq!(challenge.len(), 43); }
    #[test] fn token_parser_requires_rotation_pair() { assert!(parse_tokens(&serde_json::json!({ "access_token": "a", "refresh_token": "r", "expires_in": 900 })).is_ok()); assert!(parse_tokens(&serde_json::json!({ "access_token": "a" })).is_err()); }
}
