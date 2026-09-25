//! Canonical workspace boundary for every renderer-controlled filesystem path.
//!
//! The renderer may display paths, but it cannot choose a new filesystem root
//! for an individual read, write, search, or agent tool call. Roots are
//! canonicalized in Rust and every candidate is checked after following any
//! existing symlink. This also handles a new file whose parent does not exist
//! yet without accidentally accepting a `..` or symlink escape.
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    pub fn from_path(path: impl AsRef<Path>) -> Result<Self, String> {
        let requested = path.as_ref();
        if requested.as_os_str().is_empty() {
            return Err("Workspace path is empty.".into());
        }
        reject_parent_components(requested)?;
        let root = std::fs::canonicalize(requested)
            .map_err(|e| format!("Could not open workspace: {}", io_message(&e)))?;
        if !root.is_dir() {
            return Err("Workspace must be a directory.".into());
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve an existing path and reject it if it is not below this root.
    pub fn resolve_existing(&self, input: &str) -> Result<PathBuf, String> {
        let candidate = self.candidate(input)?;
        let resolved = std::fs::canonicalize(&candidate)
            .map_err(|e| format!("Could not resolve workspace path: {}", io_message(&e)))?;
        self.ensure_inside(&resolved)?;
        Ok(resolved)
    }

    /// Resolve a path that may not exist yet. The nearest existing ancestor is
    /// canonicalized, so a missing file below a symlinked directory is rejected
    /// just like an existing target.
    pub fn resolve_for_write(&self, input: &str) -> Result<PathBuf, String> {
        let candidate = self.candidate(input)?;
        if candidate.exists() {
            let resolved = std::fs::canonicalize(&candidate)
                .map_err(|e| format!("Could not resolve workspace path: {}", io_message(&e)))?;
            self.ensure_inside(&resolved)?;
            return Ok(resolved);
        }

        let mut probe = candidate.clone();
        let mut suffix: Vec<OsString> = Vec::new();
        loop {
            let Some(name) = probe.file_name().map(ToOwned::to_owned) else {
                return Err("Workspace path has no existing parent.".into());
            };
            suffix.push(name);
            if !probe.pop() {
                return Err("Workspace path has no existing parent.".into());
            }
            if probe.exists() {
                break;
            }
        }
        let base = std::fs::canonicalize(&probe)
            .map_err(|e| format!("Could not resolve workspace parent: {}", io_message(&e)))?;
        self.ensure_inside(&base)?;
        let mut resolved = base;
        for part in suffix.into_iter().rev() {
            resolved.push(part);
        }
        Ok(resolved)
    }

    pub fn contains_existing(&self, path: &Path) -> bool {
        std::fs::canonicalize(path)
            .map(|resolved| self.ensure_inside(&resolved).is_ok())
            .unwrap_or(false)
    }

    fn candidate(&self, input: &str) -> Result<PathBuf, String> {
        if input.is_empty() || input.contains('\0') {
            return Err("Invalid workspace path.".into());
        }
        let requested = Path::new(input);
        reject_parent_components(requested)?;
        Ok(if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            self.root.join(requested)
        })
    }

    fn ensure_inside(&self, path: &Path) -> Result<(), String> {
        if path_key(path) == path_key(&self.root) || path_key(path).starts_with(&format!("{}/", path_key(&self.root))) {
            Ok(())
        } else {
            Err("Path is outside the active workspace.".into())
        }
    }
}

fn reject_parent_components(path: &Path) -> Result<(), String> {
    if path.components().any(|component| matches!(component, Component::ParentDir)) {
        return Err("Parent-directory path segments are not allowed.".into());
    }
    Ok(())
}

fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) { value.to_ascii_lowercase() } else { value }
}

fn io_message(error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "it does not exist".into(),
        std::io::ErrorKind::PermissionDenied => "access was denied".into(),
        _ => error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("orin-code-workspace-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn rejects_parent_segments() {
        let root = temp_dir("parent");
        let workspace = Workspace::from_path(&root).unwrap();
        assert!(workspace.resolve_existing("../secret").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_relative_and_missing_children() {
        let root = temp_dir("child");
        let workspace = Workspace::from_path(&root).unwrap();
        fs::write(root.join("inside.txt"), "ok").unwrap();
        assert!(workspace.resolve_existing("inside.txt").unwrap().ends_with("inside.txt"));
        assert!(workspace.resolve_for_write("new/nested/file.txt").unwrap().ends_with("new/nested/file.txt"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_absolute_outside_path() {
        let root = temp_dir("absolute");
        let outside = temp_dir("outside");
        fs::write(outside.join("secret.txt"), "no").unwrap();
        let workspace = Workspace::from_path(&root).unwrap();
        assert!(workspace.resolve_existing(outside.join("secret.txt").to_str().unwrap()).is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_even_for_missing_child() {
        let root = temp_dir("symlink");
        let outside = temp_dir("symlink-target");
        fs::create_dir_all(outside.join("nested")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        let workspace = Workspace::from_path(&root).unwrap();
        assert!(workspace.resolve_existing("escape/nested/file.txt").is_err());
        assert!(workspace.resolve_for_write("escape/new.txt").is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
