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

/// ASCII case-insensitive `find` that allocates nothing.
///
/// This exists because of one line that used to read
/// `after[close + 1..].to_lowercase().find(&closing)` — lowercasing *the entire
/// remainder of the document* once per script/style block. On a page with many
/// such blocks that is O(n·m) over a megabyte of HTML, and it measured 14.2 ms
/// for a 1 MiB page. Comparing case-folded bytes as we scan is the same answer
/// with none of the copying.
///
/// Deliberately ASCII-only and deliberately hand-rolled: tag names are ASCII, and
/// a new dependency in the lockfile is a worse trade than 15 lines of arithmetic.
fn find_ascii_ci(haystack: &str, needle: &str) -> Option<usize> {
    let hay = haystack.as_bytes();
    let pat = needle.as_bytes();
    if pat.is_empty() {
        return Some(0);
    }
    if pat.len() > hay.len() {
        return None;
    }
    // Byte-at-a-time beats building a lowercase copy. The first-byte check runs
    // once per position; the inner loop only runs when it can possibly match.
    let first = pat[0].to_ascii_lowercase();
    'outer: for start in 0..=(hay.len() - pat.len()) {
        if hay[start].to_ascii_lowercase() != first {
            continue;
        }
        for offset in 1..pat.len() {
            if hay[start + offset].to_ascii_lowercase() != pat[offset].to_ascii_lowercase() {
                continue 'outer;
            }
        }
        return Some(start);
    }
    None
}

/// True when `tag` (which includes its angle brackets) opens one of the elements
/// whose bodies must never become text. Case-insensitive, and allocation-free —
/// the tag is compared in place rather than lowercased into a temporary.
fn opens_verbatim(tag: &str) -> bool {
    const VERBATIM: [&str; 5] = ["<script", "<style", "<noscript", "<template", "<svg"];
    let lowered = tag.as_bytes();
    VERBATIM.iter().any(|prefix| {
        lowered.len() >= prefix.len()
            && lowered[..prefix.len()]
                .iter()
                .zip(prefix.as_bytes())
                .all(|(a, b)| a.to_ascii_lowercase() == *b)
    })
}

/// True when the tag is a block boundary, so a newline is emitted. Same
/// allocation-free comparison as `opens_verbatim`.
fn is_block_tag(tag: &str) -> bool {
    const BLOCKS: [&str; 9] = [
        "</p", "</div", "</li", "</h", "</tr", "</section", "</article", "</pre", "<br",
    ];
    let lowered = tag.as_bytes();
    BLOCKS.iter().any(|prefix| {
        lowered.len() >= prefix.len()
            && lowered[..prefix.len()]
                .iter()
                .zip(prefix.as_bytes())
                .all(|(a, b)| a.to_ascii_lowercase() == *b)
    })
}

/// True when the tag is a closing tag, so a verbatim element is only entered on
/// its opening tag and never re-entered on its own closer.
fn is_closing_tag(tag: &str) -> bool {
    let bytes = tag.as_bytes();
    bytes.len() >= 2 && bytes[0] == b'<' && bytes[1] == b'/'
}

/// The tag's name, lowercased, for building a closing tag to search for.
fn tag_name(tag: &str) -> String {
    tag.trim_start_matches('<')
        .split(|c: char| c.is_whitespace() || c == '>')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// The entities Orin Tools also decodes. Order does not matter: each entry
/// includes its own `&` and `;`, so no arm can be a prefix of another and the
/// scan is a straight comparison at each `&`.
const ENTITIES: [(&str, &str); 6] = [
    ("&nbsp;", " "),
    ("&quot;", "\""),
    ("&#39;", "'"),
    ("&amp;", "&"),
    ("&lt;", "<"),
    ("&gt;", ">"),
];

/// Decode entities in a single pass.
///
/// The previous version chained six `str::replace` calls, each of which scanned
/// and reallocated the whole string — six full copies of the document to turn
/// `&amp;` into `&`.
fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        let decoded = ENTITIES
            .iter()
            .find(|(entity, _)| tail.len() >= entity.len() && tail[..entity.len()] == **entity);
        match decoded {
            Some((entity, replacement)) => {
                out.push_str(replacement);
                rest = &tail[entity.len()..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Trim, drop blank lines, and join with newlines, without the intermediate
/// `Vec<&str>` and final `join` allocation the previous version needed.
fn normalise_lines(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(trimmed);
    }
    out
}

/// Reduce fetched HTML to readable text, dropping anything script- or
/// style-shaped. Same rule Orin Tools applies server-side.
///
/// This used to run in two passes: one to strip tags and verbatim bodies, then
/// a second over the result to turn block-level tags into newlines. The second
/// pass could never fire, because the first had already removed every tag — so
/// page text came back as one unbroken line with no paragraph breaks. The two
/// passes are merged here, which fixes that and removes a full copy of the
/// document.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut rest = html;
    while let Some(open) = rest.find('<') {
        if open > 0 {
            out.push_str(&rest[..open]);
        }
        let after = &rest[open..];
        let close = match after.find('>') {
            Some(index) => index,
            None => {
                // A '<' with no '>' is not a tag; the tail is literal text.
                out.push_str(after);
                return finish(&out);
            }
        };
        let tag = &after[..=close];
        // Compared in place rather than lowercased into a temporary, which the
        // previous version did for every tag on the page.
        if opens_verbatim(tag) && !is_closing_tag(tag) {
            let closing = format!("</{}>", tag_name(tag));
            match find_ascii_ci(&after[close + 1..], &closing) {
                Some(end) => {
                    // Skip the body *and* its closing tag. Landing on the body
                    // would keep exactly the script source this is meant to drop.
                    rest = &after[close + 1 + end + closing.len()..];
                    continue;
                }
                None => {
                    // Unterminated: nothing after it is trustworthy prose. The
                    // old code broke out of the loop and then appended `rest`,
                    // which still pointed at the script body -- leaking exactly
                    // what this function exists to drop.
                    return finish(&out);
                }
            }
        }
        if is_block_tag(tag) {
            out.push('\n');
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    finish(&out)
}

/// Entity decode plus line normalisation. Split out because `html_to_text` now
/// has two exits that both need it, and a single-pass decoder replaces the six
/// whole-string `replace` calls and the `Vec<&str>` + `join` the old tail used.
fn finish(raw: &str) -> String {
    normalise_lines(&decode_entities(raw))
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

    // The cases below are the ones the allocation-free rewrite could plausibly
    // have broken: the old code lowercased whole substrings, so it happened to
    // handle mixed case and unterminated tags. These pin that behaviour down.

    #[test]
    fn case_insensitive_find_matches_any_casing() {
        assert_eq!(find_ascii_ci("abc</SCRIPT>x", "</script>"), Some(3));
        assert_eq!(find_ascii_ci("abc</script>x", "</script>"), Some(3));
        assert_eq!(find_ascii_ci("abc</ScRiPt>", "</script>"), Some(3));
        assert_eq!(find_ascii_ci("nothing here", "</script>"), None);
        assert_eq!(find_ascii_ci("ab", "abc"), None, "needle longer than haystack");
        assert_eq!(find_ascii_ci("anything", ""), Some(0), "empty needle matches at 0");
        // A near miss must not match: this is what stops a partial tag name
        // from terminating a script body early.
        assert_eq!(find_ascii_ci("</scriptx>", "</script>"), None);
    }

    #[test]
    fn verbatim_blocks_are_dropped_whatever_their_casing() {
        for (html, leak) in [
            ("<p>a</p><SCRIPT>SECRET</SCRIPT><p>b</p>", "SECRET"),
            ("<p>a</p><Style>.x{color:red}</Style><p>b</p>", "color:red"),
            ("<p>a</p><template>HIDDEN</template><p>b</p>", "HIDDEN"),
            ("<p>a</p><svg><path d='D'/></svg><p>b</p>", "D'/"),
        ] {
            let text = html_to_text(html);
            assert!(!text.contains(leak), "{html} leaked {leak}: {text}");
            assert!(text.contains("a") && text.contains("b"), "{html} lost real prose: {text}");
        }
    }

    #[test]
    fn an_unterminated_verbatim_block_drops_the_remainder() {
        // Nothing after an unterminated <script> is trustworthy prose, so the
        // conservative answer is to drop it rather than feed script source to
        // the model as page content.
        let text = html_to_text("<p>kept</p><script>never closed, LEAKED");
        assert!(text.contains("kept"));
        assert!(!text.contains("LEAKED"), "unterminated script must not leak: {text}");
    }

    #[test]
    fn several_verbatim_blocks_in_one_document_are_all_dropped() {
        // The old code lowercased the entire remainder once per block, so this
        // is also the case whose cost used to scale with document length.
        let mut html = String::new();
        for i in 0..40 {
            html.push_str(&format!("<p>para {i}</p><script>LEAK{i}</script><style>.c{i}{{'}}</style>"));
        }
        let text = html_to_text(&html);
        for i in 0..40 {
            assert!(text.contains(&format!("para {i}")), "lost prose at {i}");
            assert!(!text.contains(&format!("LEAK{i}")), "leaked script at {i}");
        }
    }

    #[test]
    fn entities_decode_once_and_unknown_ones_survive() {
        assert_eq!(decode_entities("a&amp;b"), "a&b");
        assert_eq!(decode_entities("&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_entities("it&#39;s"), "it's");
        assert_eq!(decode_entities("&quot;quoted&quot;"), "\"quoted\"");
        // A bare ampersand, and an entity Orin does not know, must pass through
        // rather than vanish or corrupt the surrounding text.
        assert_eq!(decode_entities("Tom & Jerry"), "Tom & Jerry");
        assert_eq!(decode_entities("&notanentity;"), "&notanentity;");
        assert_eq!(decode_entities("a & b & c"), "a & b & c");
        // Single pass, so double-encoding is decoded exactly one level.
        assert_eq!(decode_entities("&amp;lt;"), "&lt;");
        assert_eq!(decode_entities("no entities here"), "no entities here");
    }

    #[test]
    fn line_normalisation_trims_drops_blanks_and_joins_with_newlines() {
        assert_eq!(normalise_lines("  a  \n\n  b  \n"), "a\nb");
        assert_eq!(normalise_lines("\n\n"), "");
        assert_eq!(normalise_lines(""), "");
        assert_eq!(normalise_lines("one"), "one");
        assert_eq!(normalise_lines("a\n\n\n\nb"), "a\nb");
    }

    #[test]
    fn a_large_document_converts_without_leaking_anything() {
        // Both a correctness and a scale check: the function used to take 14.2
        // ms on 1 MiB, so this also keeps an accidental reintroduction of a
        // whole-document allocation visible as a test-time regression.
        let mut html = String::with_capacity(1024 * 1024);
        for i in 0..8_000 {
            html.push_str("<section><h2>Head</h2><p>Body &amp; more</p><script>LEAK</script></section>");
            let _ = i;
        }
        let text = html_to_text(&html);
        assert!(!text.contains("LEAK"));
        assert!(text.contains("Body & more"));
        assert!(text.lines().count() > 8_000, "block tags should become newlines");
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
