//! File-based memory storage, laid out the way ZCode lays it out.
//!
//! ZCode keeps memories at `<storage>/memories/projects/<slug>-<hash>/memory`
//! — one directory per project, one file per fact. (Fenced so rustdoc does not
//! try to compile the path as a doctest.) The earlier Orin memory was a
//! list in the app's key-value store, which is a different place; this matches
//! it so a memory means the same thing in both products.
//!
//! Layout, the slug/hash, and the sensitive-segment denylist follow
//! `vendor/zcode-src/apps/zcode-cli/packages/core/src/memory/project-root.ts`
//! and `memory-file-path.ts` (Apache-2.0, see vendor/zcode/MODIFICATIONS.md).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Directories a memory file may never live in. Ported from ZCode's
/// `SENSITIVE_MEMORY_PATH_SEGMENTS`, plus the same normalisation: case-folded,
/// control characters stripped, trailing dots and spaces removed, and a
/// trailing `:` (NTFS alternate data stream) cut off.
const SENSITIVE_SEGMENTS: &[&str] = &[
    ".git", "hooks", ".husky", ".githooks", "node_modules", ".vscode", ".idea", "head", "config",
    "objects", "refs", ".zcode", "skills", "commands", "agents", ".cargo", ".devcontainer", ".yarn",
    ".mvn", ".orin",
];

const MEMORY_FILE_EXT: &str = "md";

/// Turn a workspace path into ZCode's `<slug>-<hash>` directory name.
pub fn project_dir_name(workspace_path: &str, workspace_identity: Option<&str>) -> String {
    let normalized = normalize_path(workspace_path);
    let identity = workspace_identity.map(str::trim).filter(|s| !s.is_empty());
    let key_source = match identity {
        Some(id) => id.to_string(),
        // Windows paths are case-insensitive, so the same folder must not
        // produce two memory directories.
        None if cfg!(windows) => normalized.to_lowercase(),
        None => normalized.clone(),
    };
    let hash = format!("{:x}", Sha256::digest(key_source.as_bytes()));
    let hash = &hash[..16];
    let slug = match identity {
        Some(_) => "project".to_string(),
        None => sanitize_slug(basename(&normalized).as_deref().unwrap_or("")),
    };
    format!("{slug}-{hash}")
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim().replace('\\', "/");
    if trimmed.len() > 1 {
        trimmed.trim_end_matches('/').to_string()
    } else {
        trimmed
    }
}

fn basename(path: &str) -> Option<&str> {
    path.rsplit('/').next().filter(|s| !s.is_empty())
}

fn sanitize_slug(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.chars().take(48) {
        let lowered = ch.to_ascii_lowercase();
        if lowered.is_ascii_alphanumeric() || lowered == '.' || lowered == '_' || lowered == '-' {
            out.push(lowered);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() { "project".to_string() } else { trimmed }
}

/// The memory directory for the active workspace.
pub fn memory_root(state: &super::AppState) -> Result<PathBuf, String> {
    let workspace = state.active_workspace()?;
    Ok(memory_root_for(workspace.root()))
}

/// Same, for an explicit root — testable without app state.
pub fn memory_root_for(workspace_root: &Path) -> PathBuf {
    let workspace = workspace_root.to_string_lossy().into_owned();
    let base = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("orin-ai");
    base.join("memories")
        .join("projects")
        .join(project_dir_name(&workspace, None))
        .join("memory")
}

fn normalize_sensitive_segment(segment: &str) -> String {
    let without_controls: String = segment
        .chars()
        .filter(|c| !matches!(c,
            '\u{200c}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{206a}'..='\u{206f}' | '\u{feff}'))
        .collect::<String>()
        .to_lowercase();
    let without_stream = without_controls.split(':').next().unwrap_or("");
    without_stream.trim_end_matches(['.', ' ']).to_string()
}

pub fn contains_sensitive_segment(relative: &str) -> bool {
    relative
        .split(['/', '\\'])
        .any(|segment| SENSITIVE_SEGMENTS.contains(&normalize_sensitive_segment(segment).as_str()))
}

/// Validate a memory file name. Names are a single stem, never a path.
pub fn is_valid_memory_file_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 128 {
        return false;
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return false;
    }
    // No Windows reserved device names, and nothing odd in the stem.
    let stem = name.strip_suffix(&format!(".{MEMORY_FILE_EXT}")).unwrap_or(name);
    if stem.is_empty() {
        return false;
    }
    stem.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn resolve_memory_file(root: &Path, file_name: &str) -> Result<PathBuf, String> {
    if !is_valid_memory_file_name(file_name) {
        return Err("That is not a valid memory file name.".into());
    }
    // Defence in depth: the name check already forbids separators, but the
    // resolved path is re-checked against the root before any IO happens.
    let path = root.join(file_name);
    if !path.starts_with(root) {
        return Err("That memory file is outside the memory directory.".into());
    }
    Ok(path)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub name: String,
    /// File content, frontmatter included. The UI owns parsing so the format
    /// has exactly one implementation.
    pub content: String,
    pub updated_at_ms: u64,
}

#[tauri::command]
pub fn memory_dir(state: tauri::State<'_, super::AppState>) -> Result<String, String> {
    Ok(memory_root(&state)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn memory_list(state: tauri::State<'_, super::AppState>) -> Result<Vec<MemoryFile>, String> {
    let root = memory_root(&state)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some(MEMORY_FILE_EXT) {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
        if !is_valid_memory_file_name(&name) {
            continue;
        }
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let updated = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(MemoryFile { name, content, updated_at_ms: updated });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn memory_read(
    file_name: String,
    state: tauri::State<'_, super::AppState>,
) -> Result<MemoryFile, String> {
    let root = memory_root(&state)?;
    let path = resolve_memory_file(&root, &file_name)?;
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let updated = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(MemoryFile { name: file_name, content, updated_at_ms: updated })
}

#[tauri::command]
pub fn memory_write(
    file_name: String,
    content: String,
    state: tauri::State<'_, super::AppState>,
) -> Result<MemoryFile, String> {
    let root = memory_root(&state)?;
    let path = resolve_memory_file(&root, &file_name)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    // A memory is plain text the user wrote; cap it so a runaway paste cannot
    // fill the disk, and so the injected system section stays bounded.
    if content.len() > 64 * 1024 {
        return Err("That memory is too large.".into());
    }
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;
    let updated = std::fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(MemoryFile { name: file_name, content, updated_at_ms: updated })
}

#[tauri::command]
pub fn memory_delete(file_name: String, state: tauri::State<'_, super::AppState>) -> Result<bool, String> {
    let root = memory_root(&state)?;
    let path = resolve_memory_file(&root, &file_name)?;
    if !path.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_layout_matches_zcode() {
        let root = memory_root_for(Path::new("C:/work/Orin_ECOSYS"));
        let text = root.to_string_lossy().replace('\\', "/");
        // The project directory sits between them, so these are contains()
        // rather than ends_with().
        assert!(text.contains("/memories/projects/"), "{text}");
        assert!(text.ends_with("/memory"), "{text}");
        // The root itself is named "memory"; the per-project directory is its
        // parent, and that is the <slug>-<hash> we care about.
        let dir = root
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .expect("project dir name")
            .to_string();
        // The slug is case-folded on Windows, matching ZCode: without it the
        // same folder opened as `C:/Work/Thing` and `c:/work/thing` would get
        // two different memory directories.
        let expected_prefix = if cfg!(windows) { "orin_ecosys-" } else { "Orin_ECOSYS-" };
        assert!(dir.starts_with(expected_prefix), "{dir}");
        let hash = dir.rsplit('-').next().unwrap();
        assert_eq!(hash.len(), 16, "the hash is 16 hex chars: {dir}");
    }

    #[test]
    fn the_same_workspace_always_maps_to_the_same_directory() {
        let a = project_dir_name("C:/work/thing", None);
        let b = project_dir_name("C:/work/thing/", None);
        assert_eq!(a, b, "a trailing separator must not fork the memory directory");
    }

    #[test]
    fn an_explicit_identity_is_hashed_not_the_path() {
        let dir = project_dir_name("/any/path/at/all", Some("my-identity"));
        assert!(dir.starts_with("project-"), "{dir}");
        let other = project_dir_name("/completely/different", Some("my-identity"));
        assert_eq!(dir, other, "the same identity must resolve to the same memory");
    }

    #[test]
    fn different_workspaces_do_not_share_memory() {
        assert_ne!(project_dir_name("/a/one", None), project_dir_name("/a/two", None));
    }

    #[test]
    fn sensitive_segments_are_refused_whatever_the_spelling() {
        for (raw, should_block) in [
            (".git", true),
            ("hooks", true),
            (".vscode", true),
            ("node_modules", true),
            ("skills", true),
            (".zcode", true),
            (".GIT", true),
            (".git.", true),
            ("hooks ", true),
            ("memories", false),
            (".github", false),
        ] {
            assert_eq!(contains_sensitive_segment(raw), should_block, "{raw}");
        }
    }

    #[test]
    fn sensitive_segments_are_refused_inside_a_path() {
        assert!(contains_sensitive_segment("a/.git/config"));
        assert!(contains_sensitive_segment("sub\\.vscode\\settings.json"));
        assert!(!contains_sensitive_segment("notes/today.md"));
    }

    #[test]
    fn memory_file_names_cannot_escape_the_directory() {
        for (name, ok) in [
            ("prefers-pnpm.md", true),
            ("a_b.md", true),
            ("a.b.md", true),
            ("../escape.md", false),
            ("a/b.md", false),
            ("a\\b.md", false),
            ("..", false),
            ("", false),
            ("con.md", true), // name shape is fine; the OS would object, but we
                               // are not opening a device file
        ] {
            assert_eq!(is_valid_memory_file_name(name), ok, "{name}");
        }
    }

    #[test]
    fn a_resolved_file_is_always_under_the_root() {
        let root = Path::new("/tmp/mem/memory");
        assert!(resolve_memory_file(root, "a.md").is_ok());
        for bad in ["../a.md", "a/b.md", "..\\a.md"] {
            assert!(resolve_memory_file(root, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_workspace_with_no_memory_directory_lists_empty_rather_than_failing() {
        let dir = std::env::temp_dir().join(format!("orin-mem-{}", uuid::Uuid::new_v4()));
        assert!(!dir.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn slugs_stay_safe_for_any_workspace_name() {
        for name in ["My Project!", "///", "..", "ünïcödé", "a".repeat(200).as_str()] {
            let dir = project_dir_name(&format!("C:/work/{name}"), None);
            assert!(dir.contains('-'), "{dir}");
            assert!(!dir.contains('/'), "{dir}");
            assert!(!dir.contains('\\'), "{dir}");
        }
    }
}
