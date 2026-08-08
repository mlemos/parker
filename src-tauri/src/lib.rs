// Parker backend — file, session & settings commands, plus the menu-bar app
// wiring (tray icon, accessory activation, global shortcut, quit/hide).
//
// Design notes:
// - The frontend never passes absolute paths for notes. It passes a note *name*
//   (a bare filename). The backend joins it to the notes directory and rejects
//   anything with a path separator or "..". Path traversal from the webview is
//   impossible.
// - Writes are atomic: content goes to a temp file which is then renamed over
//   the target. A crash mid-write can never leave a half-written note.
// - The notes directory is configurable (Settings), defaulting to
//   ~/Documents/Parker.

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

#[derive(Serialize, Deserialize, Clone, Default)]
struct Settings {
    /// Absolute path to the notes folder. None → default (~/Documents/Parker).
    #[serde(default)]
    notes_dir: Option<String>,
    /// Global shortcut accelerator (Tauri format). None → default.
    #[serde(default)]
    shortcut: Option<String>,
}

/// The default global shortcut that summons/dismisses the window.
/// Ctrl+Alt+P (⌃⌥P): two modifiers so it won't clash with single-modifier app
/// shortcuts, ⌃⌥ is rarely system-reserved, and it doesn't steal ⌥P's special
/// character the way a single-⌥ shortcut would.
const TOGGLE_SHORTCUT: &str = "Ctrl+Alt+P";

/// The shortcut from settings, or the default.
fn current_shortcut() -> String {
    load_settings()
        .shortcut
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| TOGGLE_SHORTCUT.to_string())
}

// ---- Paths ----------------------------------------------------------------

/// ~/Library/Application Support/Parker — created if missing.
fn config_dir() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("Parker");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn session_path() -> PathBuf {
    config_dir().join("session.json")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

fn load_settings() -> Settings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_settings(s: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    let path = settings_path();
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn default_notes_dir() -> PathBuf {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Parker")
}

/// The resolved notes directory (from settings, or the default), created if
/// missing.
fn notes_dir() -> PathBuf {
    let dir = match load_settings().notes_dir {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => default_notes_dir(),
    };
    let _ = fs::create_dir_all(&dir);
    dir
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

// ---- Note & session commands ---------------------------------------------

#[tauri::command]
fn notes_dir_path() -> String {
    notes_dir().to_string_lossy().into_owned()
}

/// The user's home directory — used by the frontend to abbreviate paths to
/// the "~/…" form for display.
#[tauri::command]
fn home_dir_path() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
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

// ---- Settings commands ----------------------------------------------------

#[derive(Serialize)]
struct SettingsInfo {
    notes_dir: String,
    autostart: bool,
    shortcut: String,
    default_shortcut: String,
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> SettingsInfo {
    let autostart = autostart_enabled(&app);
    SettingsInfo {
        notes_dir: notes_dir().to_string_lossy().into_owned(),
        autostart,
        shortcut: current_shortcut(),
        default_shortcut: TOGGLE_SHORTCUT.to_string(),
    }
}

/// Re-register the global summon/dismiss shortcut and persist it.
#[tauri::command]
fn set_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use std::str::FromStr;
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
        let accel = accelerator.trim().to_string();
        let sc = Shortcut::from_str(&accel)
            .map_err(|_| format!("invalid shortcut: {accel}"))?;
        let gs = app.global_shortcut();
        let _ = gs.unregister_all();
        gs.register(sc).map_err(|e| e.to_string())?;
        let mut s = load_settings();
        s.shortcut = Some(accel);
        write_settings(&s)?;
        return Ok(());
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, accelerator);
        Ok(())
    }
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let m = app.autolaunch();
        return if enabled {
            m.enable().map_err(|e| e.to_string())
        } else {
            m.disable().map_err(|e| e.to_string())
        };
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, enabled);
        Ok(())
    }
}

/// Open a native folder picker; returns the chosen absolute path (or None if
/// the user cancels). Async so the blocking dialog runs off the main thread.
#[tauri::command]
async fn pick_notes_dir(app: tauri::AppHandle) -> Option<String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        return app
            .dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|pb| pb.to_string_lossy().into_owned());
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        None
    }
}

/// Point Parker at a new notes folder. When `move_existing` is true, existing
/// notes are moved into the new folder first (never clobbering files already
/// there). Returns the resolved absolute path.
#[tauri::command]
fn set_notes_dir(path: String, move_existing: bool) -> Result<String, String> {
    let new_dir = PathBuf::from(path.trim());
    if new_dir.as_os_str().is_empty() {
        return Err("empty folder path".into());
    }
    fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;

    if move_existing {
        let old = notes_dir();
        let old = old.canonicalize().unwrap_or(old);
        let target = new_dir.canonicalize().unwrap_or_else(|_| new_dir.clone());
        if old != target {
            for entry in fs::read_dir(&old).map_err(|e| e.to_string())?.flatten() {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                let name = match p.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                if name.starts_with('.') || name.ends_with(".parker-tmp") {
                    continue;
                }
                let dest = target.join(&name);
                if dest.exists() {
                    continue; // don't overwrite a note already in the new folder
                }
                // Prefer a rename; fall back to copy+remove across filesystems.
                if fs::rename(&p, &dest).is_err() {
                    fs::copy(&p, &dest).map_err(|e| e.to_string())?;
                    let _ = fs::remove_file(&p);
                }
            }
        }
    }

    let mut s = load_settings();
    s.notes_dir = Some(new_dir.to_string_lossy().into_owned());
    write_settings(&s)?;
    Ok(notes_dir().to_string_lossy().into_owned())
}

/// Flush is done on the frontend before this fires; here we simply exit.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

// ---- Menu-bar app wiring --------------------------------------------------

fn autostart_enabled(_app: &tauri::AppHandle) -> bool {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        return _app.autolaunch().is_enabled().unwrap_or(false);
    }
    #[cfg(not(desktop))]
    {
        false
    }
}

/// Bring the main window to the front (showing it if hidden).
fn show_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Toggle: if the window is visible and focused, hide it; otherwise summon it.
fn toggle_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

/// Ask the frontend to flush and then quit. If there's no window to flush
/// through, exit immediately.
fn request_quit<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::{Emitter, Manager};
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit("parker://quit", ());
    } else {
        app.exit(0);
    }
}

#[cfg(desktop)]
fn build_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    // Custom Quit: routes through request_quit so the frontend flushes first.
    let quit = MenuItemBuilder::with_id("quit", "Quit Parker")
        .accelerator("CmdOrCtrl+Q")
        .build(handle)?;
    // Settings opens the in-app panel (Cmd+, is the macOS convention).
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;

    let app_menu = SubmenuBuilder::new(handle, "Parker")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .hide()
        .hide_others()
        .separator()
        .item(&quit)
        .build()?;

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

#[cfg(desktop)]
fn build_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Emitter;

    let show = MenuItemBuilder::with_id("tray_show", "Show Parker").build(app)?;
    let settings = MenuItemBuilder::with_id("tray_settings", "Settings…").build(app)?;
    let quit = MenuItemBuilder::with_id("tray_quit", "Quit Parker").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &settings])
        .separator()
        .item(&quit)
        .build()?;

    // Monochrome "pk" template glyph — macOS recolors it for the light/dark
    // menu bar automatically. Embedded at compile time.
    let icon = tauri::image::Image::from_bytes(include_bytes!(
        "../icons/menubar-template.png"
    ))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Parker")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => show_window(app),
            "tray_settings" => {
                show_window(app);
                let _ = app.emit("parker://open-settings", ());
            }
            "tray_quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            // Only Alt+Space is ever registered, so any Pressed event is ours.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .menu(|handle| build_menu(handle));

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                // Menu bar only — hide the Dock icon.
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);

                build_tray(app.handle())?;

                // Register the summon/dismiss shortcut (from settings, or the
                // Alt+Space default) — it toggles Parker from anywhere.
                use std::str::FromStr;
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let sc = Shortcut::from_str(&current_shortcut()).unwrap_or_else(|_| {
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP)
                });
                app.global_shortcut().register(sc)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            // Real quit — flush on the frontend, then exit.
            "quit" => request_quit(app),
            "settings" => {
                use tauri::Emitter;
                let _ = app.emit("parker://open-settings", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            notes_dir_path,
            home_dir_path,
            list_notes,
            read_note,
            write_note,
            create_note,
            rename_note,
            load_session,
            save_session,
            get_settings,
            set_shortcut,
            set_autostart,
            pick_notes_dir,
            set_notes_dir,
            quit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
