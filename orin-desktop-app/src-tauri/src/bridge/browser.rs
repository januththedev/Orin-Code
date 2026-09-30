//! In-app browser: fetch a public page for the agent, with the same safety
//! rules Orin Tools applies on its own `/api/fetch`.
//!
//! This does not render arbitrary HTML in the app. The desktop shell has a
//! permissive CSP and no sandboxed webview for untrusted content, so loading a
//! page into an embedded frame would hand that page a position inside Orin.
//! Instead the page is fetched, reduced to text, and shown — which is what the
//! agent actually needs to read a page, and what avoids giving a third-party
//! site script execution inside the app.
//!
//! Pure URL policy lives here so it is testable; the fetch is injected.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageText {
    pub url: String,
    pub final_url: String,
    pub status: u16,
    pub content_type: String,
    pub text: String,
    pub truncated: bool,
}

const MAX_BYTES: usize = 1_000_000;
const MAX_TEXT_CHARS: usize = 200_000;

/// What the in-app browser is allowed to open.
///
/// Public web addresses only. Loopback, private ranges, link-local, and cloud
/// metadata are refused, because a user-supplied URL is attacker-influenced
/// input: if an agent can be talked into fetching `169.254.169.254`, it reads
/// the host's cloud credentials.
pub fn is_public_web_url(raw: &str) -> bool {
    let value = raw.trim().to_string();
    if value.is_empty() || value.len() > 2048 {
        return false;
    }
    let url = match url::Url::parse(&value) {
        Ok(url) => url,
        Err(_) => return false,
    };
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let host = match url.host_str() {
        Some(host) => host.trim_start_matches('[').trim_end_matches(']').to_lowercase(),
        None => return false,
    };
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return false;
    }
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) => is_public_ip(ip),
        // A hostname: resolve it before trusting it, or a name pointing at
        // 127.0.0.1 walks straight past a string check.
        Err(_) => true,
    }
}

fn is_public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                || v4.octets()[0] == 0
                // Carrier-grade NAT, not covered by is_private on all versions.
                || (v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]))
                // Shared address space and the cloud metadata address.
                || (v4.octets()[0] == 100 && v4.octets()[1] == 100)
                || v4.to_string() == "169.254.169.254")
        }
        std::net::IpAddr::V6(v6) => {
            !(v6.is_loopback()
                || v6.is_unspecified()
                // Unique-local fc00::/7.
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // Link-local fe80::/10.
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                // IPv4-mapped, so ::ffff:127.0.0.1 cannot slip through.
                || v6.to_ipv4().map(|v4| !is_public_ip(std::net::IpAddr::V4(v4))).unwrap_or(false))
        }
    }
}

pub fn refuse_message() -> String {
    "That address is not a public web page. Orin only opens public sites.".into()
}

/// Reduce fetched HTML to readable text, dropping anything script- or
/// style-shaped. Same rule Orin Tools applies server-side.
pub fn html_to_text(html: &str) -> String {
    // Drop the *contents* of script, style, template, and svg, not just the
    // tags. Their bodies are not prose, and script source left in the text
    // would be fed to the model as if it were page content.
    let mut cleaned = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(open) = rest.find('<') {
        cleaned.push_str(&rest[..open]);
        let after = &rest[open..];
        let close = match after.find('>') {
            Some(index) => index,
            None => break,
        };
        let tag = &after[..=close];
        let lower = tag.to_lowercase();
        let opens_verbatim = lower.starts_with("<script")
            || lower.starts_with("<style")
            || lower.starts_with("<noscript")
            || lower.starts_with("<template")
            || lower.starts_with("<svg");
        if opens_verbatim && !lower.starts_with("</") {
            let tag_name = lower
                .trim_start_matches('<')
                .split(|c: char| c.is_whitespace() || c == '>')
                .next()
                .unwrap_or("")
                .to_string();
            let closing = format!("</{tag_name}>");
            if let Some(end) = after[close + 1..].to_lowercase().find(&closing) {
                // Skip the body *and* its closing tag. Landing on the body would
                // keep exactly the script source this is meant to drop.
                rest = &after[close + 1 + end + closing.len()..];
                continue;
            }
            // Untermined: nothing after it is trustworthy prose either.
            break;
        }
        rest = &after[close + 1..];
    }
    cleaned.push_str(rest);

    let mut out = String::with_capacity(cleaned.len() / 2);
    let mut rest = cleaned.as_str();
    while let Some(open) = rest.find('<') {
        if open > 0 {
            out.push_str(&rest[..open]);
        }
        let after = &rest[open..];
        let close = match after.find('>') {
            Some(index) => index,
            None => break,
        };
        let lower = after[..=close].to_lowercase();
        let is_block = lower.starts_with("</p")
            || lower.starts_with("</div")
            || lower.starts_with("</li")
            || lower.starts_with("</h")
            || lower.starts_with("</tr")
            || lower.starts_with("</section")
            || lower.starts_with("</article")
            || lower.starts_with("</pre")
            || lower.starts_with("<br");
        if is_block {
            out.push('\n');
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);

    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn clamp_text(text: &str) -> (String, bool) {
    if text.chars().count() <= MAX_TEXT_CHARS {
        return (text.to_string(), false);
    }
    (text.chars().take(MAX_TEXT_CHARS).collect(), true)
}

pub const MAX_RESPONSE_BYTES: usize = MAX_BYTES;

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

/// Fetch a public page and return it as text.
///
/// Goes to Orin Tools (`/api/fetch`) rather than fetching here, so there is one
/// implementation of "what may the agent read" in the ecosystem rather than two
/// that can drift.
#[tauri::command]
pub async fn browser_read(url: String, max_chars: Option<usize>) -> Result<PageText, String> {
    if !is_public_web_url(&url) {
        return Err(refuse_message());
    }
    let tools = std::env::var("ORIN_TOOLS_BASE")
        .unwrap_or_else(|_| "https://tools.orinai.org".to_string());
    let limit = max_chars
        .map(|v| v.clamp(200, 200_000))
        .unwrap_or(40_000);

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .post(format!("{tools}/api/fetch"))
        .json(&serde_json::json!({ "url": url }))
        .send()
        .await
        .map_err(|e| format!("Could not reach Orin Tools: {e}"))?;

    let status = response.status();
    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Orin Tools returned something unexpected.".to_string())?;
    if status != 200 {
        let message = parsed
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("That page could not be read.");
        return Err(message.to_string());
    }

    let text = parsed
        .get("text")
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Orin Tools returned no text.".to_string())?;
    let mut out = text.to_string();
    let mut truncated = parsed
        .get("truncated")
        .and_then(|t| t.as_bool())
        .unwrap_or(false);
    if out.chars().count() > limit {
        out = out.chars().take(limit).collect();
        truncated = true;
    }

    Ok(PageText {
        url,
        final_url: parsed
            .get("finalUrl")
            .and_then(|f| f.as_str())
            .unwrap_or_default()
            .to_string(),
        status: status.as_u16(),
        content_type: parsed
            .get("contentType")
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string(),
        text: out,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_web_pages_are_allowed() {
        for (url, ok) in [
            ("https://example.com", true),
            ("https://example.com/a/b?c=1#d", true),
            ("http://example.com", true),
            ("https://sub.domain.example.org/page", true),
        ] {
            assert_eq!(is_public_web_url(url), ok, "{url}");
        }
    }

    #[test]
    fn loopback_private_and_metadata_addresses_are_refused() {
        for url in [
            "http://127.0.0.1/",
            "http://127.0.0.1:8080/admin",
            "http://localhost/",
            "http://app.localhost/",
            "http://[::1]/",
            "http://10.0.0.1/",
            "http://192.168.1.1/",
            "http://172.16.0.1/",
            // Cloud metadata: reading it is credential theft.
            "http://169.254.169.254/latest/meta-data/",
            "http://0.0.0.0/",
            "http://[fc00::1]/",
            "http://[fe80::1]/",
            "http://[::ffff:127.0.0.1]/",
        ] {
            assert!(!is_public_web_url(url), "should refuse {url}");
        }
    }

    #[test]
    fn only_http_and_https_are_opened() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com",
            "data:text/html,<script>alert(1)</script>",
            "javascript:alert(1)",
            "about:blank",
        ] {
            assert!(!is_public_web_url(url), "should refuse {url}");
        }
    }

    #[test]
    fn credentials_in_a_url_are_refused() {
        assert_eq!(is_public_web_url("https://user:pw@example.com/"), false);
        assert_eq!(is_public_web_url("https://token@example.com/"), false);
    }

    #[test]
    fn junk_never_throws() {
        for value in ["", "   ", "not a url", "://x", "https://", "http://", &"x".repeat(5000)] {
            assert!(!is_public_web_url(value), "should refuse {value:?}");
        }
    }

    #[test]
    fn html_becomes_readable_text() {
        let html = "<html><head><style>.a{color:red}</style><script>alert(1)</script></head>\
                    <body><h1>Title</h1><p>First&nbsp;para</p><p>Second &amp; last</p></body></html>";
        let text = html_to_text(html);
        assert!(text.contains("Title"));
        assert!(text.contains("First para"));
        assert!(text.contains("Second & last"));
        assert!(!text.contains("color:red"), "style content is dropped");
        assert!(!text.contains("alert(1)"), "script source is never kept as content");
        assert!(!text.contains("<"), "no tags survive");
    }

    #[test]
    fn long_text_is_truncated_rather_than_refused() {
        let long = "word ".repeat(200_000);
        let (clamped, truncated) = clamp_text(&long);
        assert!(truncated);
        assert!(clamped.chars().count() <= MAX_TEXT_CHARS);
        let (short, not_truncated) = clamp_text("hello");
        assert_eq!(short, "hello");
        assert!(!not_truncated);
    }

    #[test]
    fn the_response_cap_is_bounded() {
        assert!(MAX_RESPONSE_BYTES <= 2_000_000);
    }
}
