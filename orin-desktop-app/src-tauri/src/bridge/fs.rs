// Filesystem, folder picking, git status, and text search commands.
// Every renderer-provided path is resolved against the backend-owned active
// workspace; see workspace.rs for the canonicalization and symlink checks.
use super::workspace::Workspace;
use super::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Clone)]
pub struct FolderPick {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub async fn dialog_pick_folder(app: AppHandle, state: State<'_, AppState>) -> Result<Option<FolderPick>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<PathBuf>>();
    app.dialog()
        .file()
        .pick_folder(move |file_path| {
            let picked = file_path.and_then(|p| p.into_path().ok());
            let _ = tx.send(picked);
        });
    let Some(path) = rx.await.unwrap_or(None) else { return Ok(None) };
    state.authorize_workspace(&path)?;
    state.set_workspace(&path)?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "Workspace".into());
    Ok(Some(FolderPick { name, path: path.to_string_lossy().to_string() }))
}

/// Restore a persisted project after an app restart. The path still has to be
/// a real directory; it is canonicalized in Rust before becoming active.
#[tauri::command]
pub fn workspace_activate(root: String, state: State<'_, AppState>) -> Result<String, String> {
    state.set_workspace(Path::new(&root))?;
    state.active_root_string()
}

#[derive(Serialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String, // "file" | "folder"
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

fn ignored(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | "target" | "dist" | "build" | ".next" | ".venv" | "__pycache__" | ".vs" | "out"
    )
}

fn walk(workspace: &Workspace, dir: &Path, depth: u32, budget: &mut usize) -> Vec<FileNode> {
    let mut nodes = Vec::new();
    if depth == 0 || *budget == 0 || !workspace.contains_existing(dir) {
        return nodes;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return nodes };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if *budget == 0 { break; }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let Ok(resolved) = workspace.resolve_existing(path.to_str().unwrap_or_default()) else { continue };
        let Ok(metadata) = std::fs::metadata(&resolved) else { continue };
        if metadata.is_dir() {
            if ignored(&name) { continue; }
            *budget -= 1;
            let children = walk(workspace, &resolved, depth - 1, budget);
            nodes.push(FileNode {
                name,
                path: resolved.to_string_lossy().to_string(),
                kind: "folder".into(),
                size: 0,
                children: Some(children),
            });
        } else {
            *budget -= 1;
            nodes.push(FileNode {
                name,
                path: resolved.to_string_lossy().to_string(),
                kind: "file".into(),
                size: metadata.len(),
                children: None,
            });
        }
    }
    nodes
}

const SKIP_BINARY_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "exe", "dll", "so", "dylib",
    "zip", "gz", "tar", "7z", "rar", "pdf", "woff", "woff2", "ttf", "otf", "eot",
    "mp3", "mp4", "mov", "avi", "mkv", "wasm", "pdb", "lib", "a", "class", "jar",
];

#[tauri::command]
pub fn fs_read_dir(path: String, depth: u32, state: State<'_, AppState>) -> Result<Vec<FileNode>, String> {
    let workspace = state.active_workspace()?;
    let requested = workspace.resolve_existing(if path.trim().is_empty() { "." } else { &path })?;
    if !requested.is_dir() { return Err("Requested path is not a directory.".into()); }
    let mut budget = 800usize;
    Ok(walk(&workspace, &requested, depth.clamp(1, 4), &mut budget))
}

#[tauri::command]
pub async fn fs_read_file(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let workspace = state.active_workspace()?;
    let full = workspace.resolve_existing(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&full).map_err(|e| e.to_string())?;
        if !meta.is_file() { return Err("Requested path is not a file.".into()); }
        if meta.len() > 4 * 1024 * 1024 {
            return Err("File is too large to open in the editor (over 4 MB).".into());
        }
        let ext = full.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
        if SKIP_BINARY_EXT.contains(&ext.as_str()) {
            return Err(format!("“{}” is a binary file and can't be shown as text.", file_name_of(&full)));
        }
        std::fs::read_to_string(&full).map_err(|e| format!("Could not read {}: {}", file_name_of(&full), friendly_io_error(&e)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_write_file(path: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    let workspace = state.active_workspace()?;
    let full = workspace.resolve_for_write(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        if full.is_dir() { return Err("Cannot write over a directory.".into()); }
        if let Some(parent) = full.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        std::fs::write(&full, content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn fs_exists(path: String, state: State<'_, AppState>) -> Result<bool, String> {
    let workspace = state.active_workspace()?;
    let full = workspace.resolve_for_write(&path)?;
    Ok(full.exists())
}

#[derive(Serialize)]
pub struct GitStatusMap(pub std::collections::HashMap<String, char>);

#[tauri::command]
pub async fn git_status(root: String, state: State<'_, AppState>) -> Result<GitStatusMap, String> {
    let workspace = state.active_workspace()?;
    let requested = workspace.resolve_existing(&root)?;
    if requested != workspace.root() {
        return Err("Git status is limited to the active workspace root.".into());
    }
    let root2 = workspace.root().to_path_buf();
    let output = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("git")
            .args(["-C", root2.to_str().unwrap_or_default(), "status", "--porcelain"])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| "not a git repository".to_string())?;

    if !output.status.success() { return Err("not a git repository".into()); }
    let mut map = std::collections::HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if line.len() < 4 { continue; }
        let code = line.as_bytes()[0] as char;
        let code2 = line.as_bytes()[1] as char;
        let status_char = match (code, code2) {
            ('?', _) => '?',
            ('U', _) | (_, 'U') | ('A', 'A') => 'U',
            ('A', _) | (_, 'A') => 'A',
            ('D', _) | (_, 'D') => 'D',
            _ => 'M',
        };
        map.insert(line[3..].trim().to_string(), status_char);
    }
    Ok(GitStatusMap(map))
}

#[derive(Serialize)]
pub struct SearchHit { pub path: String, pub line: u32, pub text: String }

#[tauri::command]
pub async fn search_workspace(root: String, query: String, max_results: u32, state: State<'_, AppState>) -> Result<Vec<SearchHit>, String> {
    if query.trim().is_empty() { return Ok(vec![]); }
    if query.chars().count() > 512 { return Err("Search query is too long.".into()); }
    let workspace = state.active_workspace()?;
    let requested = workspace.resolve_existing(&root)?;
    if requested != workspace.root() { return Err("Search is limited to the active workspace root.".into()); }
    let root_path = workspace.root().to_path_buf();
    let needle = query.to_lowercase();
    let limit = max_results.clamp(1, 200);
    tauri::async_runtime::spawn_blocking(move || search_sync(&workspace, &root_path, &needle, limit as usize))
        .await
        .map_err(|e| e.to_string())
}

fn search_sync(workspace: &Workspace, root: &Path, query: &str, max_results: usize) -> Vec<SearchHit> {
    let needle = query.to_lowercase();
    let mut hits = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if hits.len() >= max_results || !workspace.contains_existing(&dir) { break; }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(resolved) = workspace.resolve_existing(path.to_str().unwrap_or_default()) else { continue };
            let name = entry.file_name().to_string_lossy().to_string();
            if resolved.is_dir() {
                if !ignored(&name) { stack.push(resolved); }
                continue;
            }
            if SKIP_BINARY_EXT.iter().any(|ext| name.to_lowercase().ends_with(ext)) { continue; }
            let Ok(content) = std::fs::read(&resolved) else { continue };
            if content.len() > 1024 * 1024 { continue; }
            let text = String::from_utf8_lossy(&content);
            for (index, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    hits.push(SearchHit {
                        path: resolved.to_string_lossy().to_string(),
                        line: (index + 1) as u32,
                        text: line.trim().chars().take(200).collect(),
                    });
                    if hits.len() >= max_results { return hits; }
                    break;
                }
            }
        }
    }
    hits
}

fn file_name_of(path: &impl AsRef<Path>) -> String {
    path.as_ref().file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.as_ref().to_string_lossy().to_string())
}

fn friendly_io_error(error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "it no longer exists".into(),
        std::io::ErrorKind::PermissionDenied => "access was denied".into(),
        _ => error.to_string(),
    }
}
