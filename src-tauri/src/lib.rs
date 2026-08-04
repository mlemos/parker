// Parker backend — file & session commands.
//
// Design notes:
// - The frontend never passes absolute paths. It passes a note *name* (a bare
//   filename). The backend joins it to the notes directory and rejects anything
//   containing a path separator or "..". This makes path traversal from the
//   webview impossible.
// - Writes are atomic: content goes to a temp file which is then renamed over
//   the target. A crash mid-write can never leave a half-written note.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
struct NoteMeta {
    name: String,
    modified: u64, // seconds since UNIX epoch, 0 if unknown
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct Session {
    #[serde(default)]
    open: Vec<String>,
    #[serde(default)]
    active: Option<String>,
    #[serde(default)]
    theme: Option<String>,
}

/// ~/Documents/Parker — created if missing. Falls back to the home dir.
fn notes_dir() -> PathBuf {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("Parker");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// ~/Library/Application Support/Parker/session.json (created lazily).
fn session_path() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("Parker");
    let _ = fs::create_dir_all(&dir);
    dir.join("session.json")
}

/// Reject anything that isn't a plain filename living directly in notes_dir.
fn safe_note_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.starts_with('.')
    {
        return Err(format!("invalid note name: {name:?}"));
    }
    Ok(notes_dir().join(name))
}

/// Atomic write: temp file in the same dir, then rename over the target.
fn atomic_write(path: &PathBuf, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("parker-tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn notes_dir_path() -> String {
    notes_dir().to_string_lossy().into_owned()
}

#[tauri::command]
fn list_notes() -> Result<Vec<NoteMeta>, String> {
    let dir = notes_dir();
    let mut notes = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Hide dotfiles and our own temp files.
        if name.starts_with('.') || name.ends_with(".parker-tmp") {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        notes.push(NoteMeta { name, modified });
    }
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(notes)
}

#[tauri::command]
fn read_note(name: String) -> Result<String, String> {
    let path = safe_note_path(&name)?;
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_note(name: String, content: String) -> Result<(), String> {
    let path = safe_note_path(&name)?;
    atomic_write(&path, &content)
}

/// Create a new empty note "Untitled-N.<ext>" (ext defaults to "md") and
/// return its name. N is the first integer that doesn't collide.
#[tauri::command]
fn create_note(ext: Option<String>) -> Result<String, String> {
    let ext = ext.unwrap_or_else(|| "md".to_string());
    let ext: String = ext.chars().filter(|c| c.is_alphanumeric()).collect();
    let ext = if ext.is_empty() { "md".to_string() } else { ext };
    let dir = notes_dir();
    for n in 1..100_000 {
        let name = format!("Untitled-{n}.{ext}");
        let path = dir.join(&name);
        if !path.exists() {
            atomic_write(&path, "")?;
            return Ok(name);
        }
    }
    Err("could not allocate a new note name".to_string())
}

#[tauri::command]
fn rename_note(from: String, to: String) -> Result<(), String> {
    let from_path = safe_note_path(&from)?;
    let to_path = safe_note_path(&to)?;
    if to_path.exists() {
        return Err(format!("a note named {to:?} already exists"));
    }
    fs::rename(&from_path, &to_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_session() -> Session {
    fs::read_to_string(session_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_session(session: Session) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    let path = session_path();
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(desktop)]
fn build_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};

    // App menu (About / Hide / Quit). Cmd+Q, Cmd+H come from here.
    let app_menu = SubmenuBuilder::new(handle, "Parker")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;

    // Standard Edit menu so Cmd+Z/X/C/V/A behave natively.
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // Deliberately NO File/Window submenu: this frees Cmd+T, Cmd+W and
    // Cmd+1..9 so the webview handles tab management itself.
    MenuBuilder::new(handle)
        .items(&[&app_menu, &edit_menu])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.menu(|handle| build_menu(handle));

    builder
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            notes_dir_path,
            list_notes,
            read_note,
            write_note,
            create_note,
            rename_note,
            load_session,
            save_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
