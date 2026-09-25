// ConPTY terminal commands. Each terminal is a real pseudo-console running the
// system shell; output streams to the renderer as `term-data` events.
use super::AppState;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter, State};

pub struct TermHandle {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub killer: Box<dyn Fn() + Send>,
}

#[tauri::command]
pub fn term_create(cwd: Option<String>, app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let cwd = if let Some(requested) = cwd {
        let workspace = state.active_workspace()?;
        let resolved = workspace.resolve_existing(&requested)?;
        if !resolved.is_dir() {
            return Err("Terminal working directory must be a directory inside the active workspace.".into());
        }
        Some(resolved)
    } else {
        None
    };
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 30, cols: 110, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Could not open a terminal: {e}"))?;

    let shell = if cfg!(windows) { "powershell.exe" } else { "bash" };
    let mut command = CommandBuilder::new(shell);
    if let Some(dir) = cwd {
        command.cwd(dir);
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("Could not start the shell: {e}"))?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let terminal_id = uuid::Uuid::new_v4().to_string();
    let app_for_reader = app.clone();
    let id_for_reader = terminal_id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_for_reader.emit(
                        "term-data",
                        serde_json::json!({ "terminalId": id_for_reader, "data": String::from_utf8_lossy(&buffer[..n]) }),
                    );
                }
            }
        }
        let _ = app_for_reader.emit(
            "term-exit",
            serde_json::json!({ "terminalId": id_for_reader, "exitCode": 0 }),
        );
    });

    // Fn-mutability without interior state: the kill closure may fire more
    // than once (UI stop button), so the child sits behind a mutex.
    let child = std::sync::Mutex::new(child);
    state.terminals.lock().map_err(|_| "terminal registry poisoned")?.insert(
        terminal_id.clone(),
        TermHandle {
            master: pair.master,
            writer,
            killer: Box::new(move || {
                if let Ok(mut child) = child.lock() {
                    let _ = child.kill();
                }
            }),
        },
    );
    Ok(terminal_id)
}

#[tauri::command]
pub fn term_write(terminal_id: String, data: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut registry = state.terminals.lock().map_err(|_| "terminal registry poisoned")?;
    let handle = registry.get_mut(&terminal_id).ok_or("That terminal is no longer running")?;
    handle.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    handle.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_resize(terminal_id: String, cols: u16, rows: u16, state: State<'_, AppState>) -> Result<(), String> {
    let registry = state.terminals.lock().map_err(|_| "terminal registry poisoned")?;
    let handle = registry.get(&terminal_id).ok_or("That terminal is no longer running")?;
    handle
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_kill(terminal_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut registry: std::sync::MutexGuard<'_, HashMap<String, TermHandle>> =
        state.terminals.lock().map_err(|_| "terminal registry poisoned")?;
    if let Some(handle) = registry.remove(&terminal_id) {
        (handle.killer)();
    }
    Ok(())
}
