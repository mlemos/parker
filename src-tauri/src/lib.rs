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
use std::process::Command;

use serde::{Deserialize, Serialize};

mod monitor;

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
    /// Split layout tree (opaque JSON owned by the frontend). None → single pane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    layout: Option<serde_json::Value>,
    /// Focused group id within the layout.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    focused: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Settings {
    /// Absolute path to the notes folder. None → default (~/Documents/Parker).
    #[serde(default)]
    notes_dir: Option<String>,
    /// Global shortcut accelerator (Tauri format). None → default.
    #[serde(default)]
    shortcut: Option<String>,
    /// Auto commit+push the notes repo when quitting.
    #[serde(default)]
    git_auto_sync: bool,
    /// Minutes between timed commit+push runs. 0 (the default) = off.
    #[serde(default)]
    git_sync_interval: u32,
    /// Webview zoom factor. 1.0 = 100%.
    #[serde(default = "one")]
    zoom: f64,
}

/// serde default for `zoom` — a missing value means "no zoom", not 0×.
fn one() -> f64 {
    1.0
}

// Written by hand rather than derived: a derived Default gives `zoom` the f64
// default of 0.0, and load_settings() falls back to Default whenever there is
// no settings file to read — which is every first launch. Scaling a webview by
// zero paints nothing, so the app came up as a black window.
impl Default for Settings {
    fn default() -> Self {
        Self {
            notes_dir: None,
            shortcut: None,
            git_auto_sync: false,
            git_sync_interval: 0,
            zoom: 1.0,
        }
    }
}

/// The saved zoom, sanitized.
fn saved_zoom() -> f64 {
    clamp_zoom(load_settings().zoom)
}

/// A zoom factor safe to hand the webview. A hand-edited settings.json can
/// hold 0, a negative or a NaN, and a webview scaled by any of those paints
/// nothing at all — so anything outside the usable range means "no zoom".
fn clamp_zoom(z: f64) -> f64 {
    if z.is_finite() && z >= ZOOM_MIN && z <= ZOOM_MAX {
        z
    } else {
        1.0
    }
}

/// Zoom is applied to the whole webview, so it is clamped to what stays usable
/// rather than to what the API accepts.
const ZOOM_MIN: f64 = 0.5;
const ZOOM_MAX: f64 = 3.0;

/// Dev vs release identity. `debug_assertions` is on for `tauri dev` and off
/// for `tauri build`, so a dev instance runs alongside the installed
/// Parker.app without fighting over its data, tray, session or global hotkey.
#[cfg(debug_assertions)]
mod variant {
    pub const CONFIG_DIR: &str = "Parker-dev"; // ~/Library/Application Support
    pub const NOTES_DIR: &str = "Parker (Dev)"; // ~/Documents
    pub const TITLE: &str = "Parker Dev";
    pub const SHORTCUT: &str = "Ctrl+Alt+Shift+P"; // ⌃⌥⇧P
}
#[cfg(not(debug_assertions))]
mod variant {
    pub const CONFIG_DIR: &str = "Parker";
    pub const NOTES_DIR: &str = "Parker";
    pub const TITLE: &str = "Parker";
    pub const SHORTCUT: &str = "Ctrl+Alt+P"; // ⌃⌥P
}

/// The default global shortcut that summons/dismisses the window. Two
/// modifiers so it won't clash with single-modifier app shortcuts; ⌃⌥ is
/// rarely system-reserved and doesn't steal ⌥P's special character.
const TOGGLE_SHORTCUT: &str = variant::SHORTCUT;

/// The shortcut from settings, or the default.
fn current_shortcut() -> String {
    load_settings()
        .shortcut
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| TOGGLE_SHORTCUT.to_string())
}

// ---- Paths ----------------------------------------------------------------

/// ~/Library/Application Support/Parker — created if missing.
pub(crate) fn config_dir() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join(variant::CONFIG_DIR);
    let _ = fs::create_dir_all(&dir);
    dir
}

fn session_path() -> PathBuf {
    config_dir().join("session.json")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

/// In-memory settings cache. Every command used to re-read + re-parse
/// settings.json (via notes_dir()) — thousands of disk hits per session with
/// a 500ms autosave. All writes go through write_settings, which refreshes
/// the cache; external edits to settings.json apply on next launch.
static SETTINGS: std::sync::OnceLock<std::sync::RwLock<Settings>> = std::sync::OnceLock::new();

fn settings_cache() -> &'static std::sync::RwLock<Settings> {
    SETTINGS.get_or_init(|| {
        std::sync::RwLock::new(
            fs::read_to_string(settings_path())
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
        )
    })
}

fn load_settings() -> Settings {
    settings_cache().read().map(|s| s.clone()).unwrap_or_default()
}

fn write_settings(s: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    let path = settings_path();
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    if let Ok(mut cache) = settings_cache().write() {
        *cache = s.clone();
    }
    Ok(())
}

fn default_notes_dir() -> PathBuf {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(variant::NOTES_DIR)
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
/// The webview only ever addresses notes by bare name, so a separator, a
/// "..", or a leading dot is not a note — it's an attempt to reach out of the
/// notes folder, or to write a file the app then refuses to list.
fn validate_note_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.starts_with('.')
    {
        return Err(format!("invalid note name: {name:?}"));
    }
    Ok(())
}

fn safe_note_path(name: &str) -> Result<PathBuf, String> {
    validate_note_name(name)?;
    Ok(notes_dir().join(name))
}

/// Whether a file in the notes folder is a note the app shows and syncs.
/// Dotfiles are the OS's business, and .parker-tmp files are ours mid-write.
fn is_listed_note(name: &str) -> bool {
    !name.starts_with('.') && !name.ends_with(".parker-tmp")
}

/// The scratch file `atomic_write` writes before renaming into place. Built
/// from the whole filename rather than its stem, so saving "notes.md" and
/// "notes.txt" at the same time can't have them writing over each other's
/// temp file.
fn temp_path(path: &PathBuf) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!("{name}.parker-tmp"))
}

/// Atomic write: temp file in the same dir, then rename over the target.
fn atomic_write(path: &PathBuf, content: &str) -> Result<(), String> {
    let tmp = temp_path(path);
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
async fn list_notes() -> Result<Vec<NoteMeta>, String> {
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
        if !is_listed_note(&name) {
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

#[derive(Serialize)]
struct NoteHit {
    name: String,
    modified: u64,
    in_name: bool,           // matched by filename
    snippet: Option<String>, // first matching content line (content matches)
}

/// Search notes by filename AND content. Empty query returns all notes.
/// Filename matches rank first; content matches carry a snippet of the line.
#[tauri::command]
async fn search_notes(query: String) -> Result<Vec<NoteHit>, String> {
    let q = query.trim().to_lowercase();
    let dir = notes_dir();
    let mut hits = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !is_listed_note(&name) {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        if q.is_empty() {
            hits.push(NoteHit { name, modified, in_name: true, snippet: None });
            continue;
        }

        let in_name = name.to_lowercase().contains(&q);
        // Look for the first content line containing the query (for a snippet).
        let snippet = fs::read_to_string(&path).ok().and_then(|content| {
            content
                .lines()
                .find(|line| line.to_lowercase().contains(&q))
                .map(|line| line.trim().chars().take(140).collect::<String>())
        });

        if in_name || snippet.is_some() {
            hits.push(NoteHit { name, modified, in_name, snippet });
        }
    }
    // Filename matches first, then most-recently-modified.
    hits.sort_by(|a, b| b.in_name.cmp(&a.in_name).then(b.modified.cmp(&a.modified)));
    Ok(hits)
}

#[tauri::command]
async fn read_note(name: String) -> Result<String, String> {
    let path = safe_note_path(&name)?;
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_note(name: String, content: String) -> Result<(), String> {
    let path = safe_note_path(&name)?;
    atomic_write(&path, &content)
}

/// Move a note to the OS Trash (recoverable), never a hard unlink.
#[tauri::command]
fn delete_note(name: String) -> Result<(), String> {
    let path = safe_note_path(&name)?;
    if !path.exists() {
        return Ok(()); // already gone — treat as success
    }
    trash::delete(&path).map_err(|e| format!("couldn't move to Trash: {e}"))
}

/// The extension a new note gets: alphanumerics only, "md" when nothing
/// usable is left. Keeps a dot or a separator out of the generated filename.
fn note_ext(ext: Option<String>) -> String {
    let ext: String = ext
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    if ext.is_empty() {
        "md".to_string()
    } else {
        ext
    }
}

/// Create a new empty note "Untitled-N.<ext>" (ext defaults to "md") and
/// return its name. N is the first integer that doesn't collide.
#[tauri::command]
fn create_note(ext: Option<String>) -> Result<String, String> {
    let ext = note_ext(ext);
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
    git_auto_sync: bool,
    git_sync_interval: u32,
    zoom: f64,
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> SettingsInfo {
    let autostart = autostart_enabled(&app);
    let s = load_settings();
    SettingsInfo {
        notes_dir: notes_dir().to_string_lossy().into_owned(),
        autostart,
        shortcut: current_shortcut(),
        default_shortcut: TOGGLE_SHORTCUT.to_string(),
        git_auto_sync: s.git_auto_sync,
        git_sync_interval: s.git_sync_interval,
        zoom: s.zoom,
    }
}

#[tauri::command]
fn set_git_auto_sync(enabled: bool) -> Result<(), String> {
    let mut s = load_settings();
    s.git_auto_sync = enabled;
    write_settings(&s)
}

/// Zoom the whole interface, the way a browser or VS Code does — one
/// transformation over the entire webview, so the editor, the gutter, the tabs
/// and the status bar all change together and in the same frame. Scaling the
/// editor's font instead left the gutter to catch up on its own schedule.
/// Returns the value actually applied, after clamping.
#[tauri::command]
fn set_zoom(app: tauri::AppHandle, scale: f64) -> Result<f64, String> {
    let scale = scale.clamp(ZOOM_MIN, ZOOM_MAX);
    apply_zoom(&app, scale);
    let mut s = load_settings();
    s.zoom = scale;
    write_settings(&s)?;
    Ok(scale)
}

/// Push a zoom factor to every window Parker owns, so About and the shortcut
/// sheet don't sit at 100% next to a zoomed editor.
fn apply_zoom<R: tauri::Runtime>(app: &tauri::AppHandle<R>, scale: f64) {
    use tauri::Manager;
    for label in ["main", "about", "help"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.set_zoom(scale);
        }
    }
}

/// Minutes between timed syncs; 0 turns the timer off. The timer itself lives
/// in the frontend (GitMenu), which already owns the status poll and the
/// flush-before-commit step — this only persists the choice.
#[tauri::command]
fn set_git_sync_interval(minutes: u32) -> Result<(), String> {
    let mut s = load_settings();
    s.git_sync_interval = minutes;
    write_settings(&s)
}

// ---- Git sync -------------------------------------------------------------
// Parker never runs `git init` or touches credentials — it drives an existing
// repo the user set up in their notes folder, doing only add + commit + push.
// Inspired by the Health Dashboard's commit menu: a rich per-file status, a
// real (editable) commit message, separate commit/push, and a history view.

fn run_git(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        // Keep non-ASCII note names literal instead of octal-escaped.
        .arg("-c")
        .arg("core.quotepath=false")
        .args(args)
        .current_dir(notes_dir())
        .output()
        .map_err(|e| format!("git not available: {e}"))
}

fn git_is_repo() -> bool {
    run_git(&["rev-parse", "--is-inside-work-tree"])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn git_has_remote() -> bool {
    run_git(&["remote"])
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}

/// Push URL of the first remote (usually `origin`), if any.
fn git_remote_url() -> Option<String> {
    let name = run_git(&["remote"]).ok().and_then(|o| {
        String::from_utf8_lossy(&o.stdout)
            .lines()
            .next()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    })?;
    run_git(&["remote", "get-url", &name])
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Push to the remote, setting upstream on the first push so later pushes
/// (and the ahead/behind count) work without manual `git push -u`.
fn git_do_push() -> Result<std::process::Output, String> {
    let has_upstream = run_git(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .map(|o| o.status.success())
        .unwrap_or(false);
    if has_upstream {
        run_git(&["push"])
    } else {
        let branch = run_git(&["rev-parse", "--abbrev-ref", "HEAD"])
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|| "HEAD".to_string());
        run_git(&["push", "-u", "origin", &branch])
    }
}

/// Count newline bytes in an untracked file (its "added" line count).
fn count_lines(rel: &str) -> u32 {
    match std::fs::read(notes_dir().join(rel)) {
        Ok(b) => b.iter().filter(|&&c| c == b'\n').count() as u32,
        Err(_) => 0,
    }
}

#[derive(Serialize)]
struct GitFileChange {
    status: String, // two-char porcelain code (e.g. " M", "A ", "??")
    path: String,
    added: u32,
    deleted: u32,
    binary: bool,
}

#[derive(Serialize)]
struct GitStatus {
    is_repo: bool,
    has_remote: bool,
    /// Push URL of the remote (origin), when one exists. Drives the UI's
    /// "backed up to GitHub vs. local only" indicator.
    remote_url: Option<String>,
    branch: Option<String>,
    /// Commits on HEAD not yet on upstream. -1 when no upstream is configured.
    ahead: i32,
    files: Vec<GitFileChange>,
    total_added: u32,
    total_deleted: u32,
}

impl GitStatus {
    fn empty(is_repo: bool) -> Self {
        GitStatus {
            is_repo,
            has_remote: false,
            remote_url: None,
            branch: None,
            ahead: -1,
            files: Vec::new(),
            total_added: 0,
            total_deleted: 0,
        }
    }
}

/// `git diff --numstat` output → path ↦ (added, deleted, is-binary).
/// Binary files report "-" for both counts instead of a number.
fn parse_numstat(stdout: &str) -> std::collections::HashMap<String, (u32, u32, bool)> {
    let mut out = std::collections::HashMap::new();
    for line in stdout.lines() {
        let mut it = line.splitn(3, '\t');
        let a = it.next().unwrap_or("");
        let d = it.next().unwrap_or("");
        let path = it.next().unwrap_or("");
        if path.is_empty() {
            continue;
        }
        let binary = a == "-" || d == "-";
        out.insert(
            path.to_string(),
            (a.parse().unwrap_or(0), d.parse().unwrap_or(0), binary),
        );
    }
    out
}

/// One line of `git status --porcelain=v1` → (two-char status code, path).
/// A rename reads "old -> new"; the destination is the file that exists now.
/// Paths git chose to quote come back unquoted.
fn parse_status_line(line: &str) -> Option<(String, String)> {
    // XY, a space, then the path. Those first bytes are ASCII in porcelain
    // output; the boundary check keeps a malformed line from panicking.
    if line.len() < 4 || !line.is_char_boundary(3) {
        return None;
    }
    let status = line[..2].to_string();
    let mut path = line[3..].to_string();
    if let Some(idx) = path.find(" -> ") {
        path = path[idx + 4..].to_string();
    }
    if path.len() >= 2 && path.starts_with('"') && path.ends_with('"') {
        path = path[1..path.len() - 1].to_string();
    }
    if path.is_empty() {
        return None;
    }
    Some((status, path))
}

#[tauri::command]
async fn git_status() -> GitStatus {
    if !git_is_repo() {
        return GitStatus::empty(false);
    }

    // Line deltas for tracked changes (staged + unstaged vs HEAD).
    let numstat = run_git(&["diff", "--numstat", "HEAD"])
        .ok()
        .filter(|o| o.status.success())
        .map(|o| parse_numstat(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();

    let mut files = Vec::new();
    let mut total_added = 0u32;
    let mut total_deleted = 0u32;
    if let Ok(o) = run_git(&["status", "--porcelain=v1"]) {
        for line in String::from_utf8_lossy(&o.stdout).lines() {
            let Some((status, path)) = parse_status_line(line) else {
                continue;
            };
            let (added, deleted, binary) = if status.trim() == "??" {
                (count_lines(&path), 0, false)
            } else if let Some(&(a, d, b)) = numstat.get(&path) {
                (a, d, b)
            } else {
                (0, 0, false)
            };
            total_added += added;
            total_deleted += deleted;
            files.push(GitFileChange {
                status,
                path,
                added,
                deleted,
                binary,
            });
        }
    }

    let branch = run_git(&["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    // -1 when there's no upstream to compare against.
    let ahead = run_git(&["rev-list", "--count", "@{u}..HEAD"])
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .unwrap_or(-1);

    let remote_url = git_remote_url();
    GitStatus {
        is_repo: true,
        has_remote: remote_url.is_some(),
        remote_url,
        branch,
        ahead,
        files,
        total_added,
        total_deleted,
    }
}

#[derive(Serialize)]
struct GitLogEntry {
    hash: String,
    subject: String,
    rel_date: String,
    /// True when this commit has not yet been pushed to upstream.
    unpushed: bool,
}

/// One line of the `%H\t%h\t%s\t%cr` log format → (full hash, short hash,
/// subject, relative date). The date is split off the end, because a commit
/// subject may itself contain a tab.
fn parse_log_line(line: &str) -> Option<(&str, &str, &str, &str)> {
    let mut it = line.splitn(3, '\t');
    let full = it.next()?;
    let short = it.next()?;
    let rest = it.next()?;
    if short.is_empty() {
        return None;
    }
    let (subject, rel_date) = rest.rsplit_once('\t').unwrap_or((rest, ""));
    Some((full, short, subject, rel_date))
}

#[tauri::command]
async fn git_log(limit: Option<u32>) -> Vec<GitLogEntry> {
    use std::collections::HashSet;
    if !git_is_repo() {
        return Vec::new();
    }
    // Full hashes of commits not yet on upstream.
    let mut unpushed: HashSet<String> = HashSet::new();
    if let Ok(o) = run_git(&["rev-list", "@{u}..HEAD"]) {
        if o.status.success() {
            for l in String::from_utf8_lossy(&o.stdout).lines() {
                let h = l.trim();
                if !h.is_empty() {
                    unpushed.insert(h.to_string());
                }
            }
        }
    }
    let n = limit.unwrap_or(30).clamp(1, 200).to_string();
    let out = match run_git(&[
        "log",
        "-n",
        &n,
        "--pretty=format:%H%x09%h%x09%s%x09%cr",
    ]) {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    let mut entries = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let Some((full, short, subject, rel_date)) = parse_log_line(line) else {
            continue;
        };
        entries.push(GitLogEntry {
            hash: short.to_string(),
            subject: subject.to_string(),
            rel_date: rel_date.to_string(),
            unpushed: unpushed.contains(full),
        });
    }
    entries
}

#[derive(Serialize)]
struct CommitResult {
    ok: bool,
    error: Option<String>,
    hash: Option<String>,
    message: String, // human-readable note on success
}

/// What a commit message has to be before Parker will run git with it.
/// Length is counted in characters, not bytes, so a message of emoji is
/// measured the way the person who typed it would measure it.
fn validate_commit_message(message: &str) -> Result<&str, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("Commit message is required.".to_string());
    }
    if msg.chars().count() > 500 {
        return Err("Message too long (>500 chars).".to_string());
    }
    Ok(msg)
}

fn commit_err(msg: impl Into<String>) -> CommitResult {
    CommitResult {
        ok: false,
        error: Some(msg.into()),
        hash: None,
        message: String::new(),
    }
}

#[tauri::command]
async fn git_commit(message: String, push: bool) -> CommitResult {
    if !git_is_repo() {
        return commit_err("Not a git repository — run `git init` in your notes folder first.");
    }
    let msg = match validate_commit_message(&message) {
        Ok(msg) => msg,
        Err(e) => return commit_err(e),
    };
    // Stage everything (respects .gitignore).
    match run_git(&["add", "-A"]) {
        Ok(o) if o.status.success() => {}
        Ok(o) => return commit_err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(e) => return commit_err(e),
    }
    // Anything actually staged?
    let staged = run_git(&["diff", "--cached", "--name-only"])
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);
    if !staged {
        return commit_err("No changes to commit.");
    }
    match run_git(&["commit", "-m", msg]) {
        Ok(o) if o.status.success() => {}
        Ok(o) => return commit_err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(e) => return commit_err(e),
    }
    let hash = run_git(&["rev-parse", "--short", "HEAD"])
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    if push && git_has_remote() {
        match git_do_push() {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                return CommitResult {
                    ok: false,
                    error: Some(format!(
                        "Commit saved but push failed: {}. Try `git push` in the terminal — credentials may be needed.",
                        String::from_utf8_lossy(&o.stderr).trim()
                    )),
                    hash,
                    message: String::new(),
                };
            }
            Err(e) => {
                return CommitResult {
                    ok: false,
                    error: Some(format!("Commit saved but push failed: {e}")),
                    hash,
                    message: String::new(),
                };
            }
        }
        return CommitResult {
            ok: true,
            error: None,
            hash,
            message: "Committed & pushed".into(),
        };
    }

    CommitResult {
        ok: true,
        error: None,
        hash,
        message: "Committed".into(),
    }
}

/// Push already-made commits without committing anything new.
#[tauri::command]
async fn git_push() -> CommitResult {
    if !git_is_repo() {
        return commit_err("Not a git repository.");
    }
    if !git_has_remote() {
        return commit_err("No remote configured (add an `origin`).");
    }
    match git_do_push() {
        Ok(o) if o.status.success() => CommitResult {
            ok: true,
            error: None,
            hash: None,
            message: "Pushed".into(),
        },
        Ok(o) => commit_err(format!(
            "Push failed: {}. Try `git push` in the terminal — credentials may be needed.",
            String::from_utf8_lossy(&o.stderr).trim()
        )),
        Err(e) => commit_err(format!("Push failed: {e}")),
    }
}

/// Best-effort commit+push used by the auto-sync-on-quit path.
fn auto_commit_push() {
    if !git_is_repo() {
        return;
    }
    let _ = run_git(&["add", "-A"]);
    let staged = run_git(&["diff", "--cached", "--name-only"])
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);
    if staged {
        let _ = run_git(&["commit", "-m", "Parker auto-sync on quit"]);
    }
    if git_has_remote() {
        let _ = git_do_push();
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
fn set_notes_dir(
    #[allow(unused_variables)] app: tauri::AppHandle,
    path: String,
    move_existing: bool,
) -> Result<String, String> {
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
                if !is_listed_note(&name) {
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

    // Point the file watcher at the new folder (no restart needed).
    #[cfg(desktop)]
    rewatch_notes(&app);

    Ok(notes_dir().to_string_lossy().into_owned())
}

/// Flush is done on the frontend before this fires. If auto-sync is on and the
/// notes folder is a git repo, commit & push before exiting (best-effort).
#[tauri::command]
async fn quit(app: tauri::AppHandle) {
    if load_settings().git_auto_sync {
        auto_commit_push();
    }
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

/// Make the window follow the user to whatever Space is active when it's
/// summoned, instead of yanking them back to the Space it was created on.
/// Sets NSWindowCollectionBehaviorMoveToActiveSpace on the underlying NSWindow.
#[cfg(target_os = "macos")]
fn follow_active_space<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    // NSWindowCollectionBehaviorMoveToActiveSpace = 1 << 1
    const MOVE_TO_ACTIVE_SPACE: usize = 1 << 1;
    if let Ok(ptr) = window.ns_window() {
        let ns_window = ptr as *mut AnyObject;
        if !ns_window.is_null() {
            unsafe {
                let _: () = msg_send![ns_window, setCollectionBehavior: MOVE_TO_ACTIVE_SPACE];
            }
        }
    }
}

/// Bring the main window to the front (showing it if hidden). Re-asserts the
/// "move to active Space" behavior right before showing so summon always lands
/// on the current desktop.
fn show_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        follow_active_space(&w);
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Open (or focus) the standalone About window — a small, fixed-size window
/// loading the frontend with ?view=about.
fn show_about_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    if let Some(w) = app.get_webview_window("about") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    // Pass the current theme so the About window matches the editor's look.
    let theme = load_session().theme.unwrap_or_default();
    let url = format!("index.html?view=about&theme={theme}");
    // Secondary windows are sized in logical pixels, so a zoomed webview inside
    // a fixed frame would simply be cropped — the frame scales with it.
    let z = saved_zoom();
    #[allow(unused_mut)]
    let mut b = WebviewWindowBuilder::new(app, "about", WebviewUrl::App(url.into()))
        .title("About Parker")
        .inner_size(440.0 * z, 440.0 * z)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center();
    #[cfg(target_os = "macos")]
    {
        b = b
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }
    if let Ok(w) = b.build() {
        let _ = w.set_zoom(z);
    }
}

/// Open (or focus) the standalone Keyboard Shortcuts window.
fn show_help_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    if let Some(w) = app.get_webview_window("help") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let theme = load_session().theme.unwrap_or_default();
    let url = format!("index.html?view=help&theme={theme}");
    let z = saved_zoom();
    #[allow(unused_mut)]
    let mut b = WebviewWindowBuilder::new(app, "help", WebviewUrl::App(url.into()))
        .title("Keyboard Shortcuts")
        .inner_size(620.0 * z, 560.0 * z)
        .min_inner_size(460.0 * z, 420.0 * z)
        .maximizable(false)
        // Start hidden: the frontend applies the theme, then shows the window on
        // the first painted frame so it never flashes an unstyled (white) frame.
        .visible(false)
        .center();
    #[cfg(target_os = "macos")]
    {
        b = b
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 22.0));
    }
    if let Ok(w) = b.build() {
        let _ = w.set_zoom(z);
    }
}

/// Command so the in-app (?) button can open the shortcuts window.
#[tauri::command]
fn open_help(app: tauri::AppHandle) {
    show_help_window(&app);
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
            show_window(app);
        }
    }
}

/// Ask the frontend to flush and then quit. If there's no window to flush
/// through, exit immediately.
///
/// `confirm` marks a quit the *user* asked for (⌘Q, the menu, the tray): the
/// frontend puts up a confirmation first. Every other path — a quit Parker
/// itself decided on, or one the system imposes at logout/reboot — flushes and
/// goes, because there is nobody there to answer a dialog.
fn request_quit<R: tauri::Runtime>(app: &tauri::AppHandle<R>, confirm: bool) {
    use tauri::{Emitter, Manager};
    if let Some(w) = app.get_webview_window("main") {
        // A quit request with the window hidden would pop a dialog nobody can
        // see — show the window first so the question is answerable.
        if confirm && !w.is_visible().unwrap_or(false) {
            show_window(app);
        }
        let _ = w.emit(
            if confirm {
                "parker://confirm-quit"
            } else {
                "parker://quit"
            },
            (),
        );
    } else {
        app.exit(0);
    }
}


#[cfg(desktop)]
fn build_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    // Custom Quit: routes through request_quit so the frontend confirms and
    // flushes first. ⌘Q is the macOS convention and Parker now answers to it —
    // the confirmation dialog is what keeps a stray press from costing you the
    // window you were mid-thought in.
    let quit = MenuItemBuilder::with_id("quit", "Quit Parker")
        .accelerator("CmdOrCtrl+Q")
        .build(handle)?;
    // Settings opens the in-app panel (Cmd+, is the macOS convention).
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;
    // Our own About panel (with the beta disclaimer) instead of the OS default.
    let about = MenuItemBuilder::with_id("about", "About Parker").build(handle)?;
    // Keyboard shortcuts help overlay.
    let help = MenuItemBuilder::with_id("help", "Keyboard Shortcuts")
        .accelerator("CmdOrCtrl+K")
        .build(handle)?;

    let app_menu = SubmenuBuilder::new(handle, variant::TITLE)
        .item(&about)
        .separator()
        .item(&settings)
        .item(&help)
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
    let about = MenuItemBuilder::with_id("tray_about", "About Parker").build(app)?;
    let quit = MenuItemBuilder::with_id("tray_quit", "Quit Parker").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &settings, &about])
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
        .tooltip(variant::TITLE)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => show_window(app),
            "tray_settings" => {
                show_window(app);
                let _ = app.emit("parker://open-settings", ());
            }
            "tray_about" => show_about_window(app),
            "tray_quit" => request_quit(app, true),
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

/// Holds the notes-folder watcher in mutable Tauri state — a `notify` watcher
/// stops firing the moment it's dropped, so we keep it alive here and swap it
/// when the notes folder changes.
#[cfg(desktop)]
struct NotesWatcher(std::sync::Mutex<Option<notify::RecommendedWatcher>>);

/// Build a watcher over the *current* notes folder (non-recursive) that emits
/// `parker://note-changed` with the file's basename on create/modify/remove.
#[cfg(desktop)]
fn build_notes_watcher(app: &tauri::AppHandle) -> Option<notify::RecommendedWatcher> {
    use notify::{EventKind, RecursiveMode, Watcher};
    use tauri::Emitter;

    let handle = app.clone();
    let mut watcher = match notify::recommended_watcher(
        move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            if !matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            ) {
                return;
            }
            for path in event.paths {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    // Skip our own autosave temp files and dotfiles — they'd
                    // fire 2-4 spurious emissions per autosave otherwise.
                    if !is_listed_note(name) {
                        continue;
                    }
                    let _ = handle.emit("parker://note-changed", name.to_string());
                }
            }
        },
    ) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("notes watcher: init failed: {e}");
            return None;
        }
    };
    if let Err(e) = watcher.watch(&notes_dir(), RecursiveMode::NonRecursive) {
        eprintln!("notes watcher: watch failed: {e}");
        return None;
    }
    Some(watcher)
}

/// (Re)point the notes watcher at the current folder. Called at startup and
/// again whenever the user changes the notes folder — dropping the previous
/// watcher stops it, so we never keep watching a stale directory.
#[cfg(desktop)]
fn rewatch_notes(app: &tauri::AppHandle) {
    use tauri::Manager;
    let fresh = build_notes_watcher(app);
    match app.try_state::<NotesWatcher>() {
        Some(state) => {
            if let Ok(mut slot) = state.0.lock() {
                *slot = fresh; // old watcher dropped here → stops watching
            }
        }
        None => {
            app.manage(NotesWatcher(std::sync::Mutex::new(fresh)));
        }
    }
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
            // Only our own accelerator is ever registered, so any Pressed event is ours.
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
            // Build the main window in code (not via config) so we can center
            // the macOS traffic lights inside our 40px custom title bar.
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                #[allow(unused_mut)]
                let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title(variant::TITLE)
                    .inner_size(900.0, 700.0)
                    .min_inner_size(480.0, 360.0)
                    // Let HTML5 drag-and-drop work (tab reordering). Otherwise
                    // the webview swallows drag events for OS file-drop, which
                    // Parker doesn't use.
                    .disable_drag_drop_handler();
                #[cfg(target_os = "macos")]
                {
                    b = b
                        .title_bar_style(tauri::TitleBarStyle::Overlay)
                        .hidden_title(true)
                        .traffic_light_position(tauri::LogicalPosition::new(16.0, 22.0));
                }
                let win = b.build()?;
                // Restore the saved zoom before anything is painted, so the
                // window doesn't flash at 100% on every launch.
                let _ = win.set_zoom(saved_zoom());
                // Follow the user across Spaces: summon brings Parker to the
                // *current* desktop, not the Space it was created on.
                #[cfg(target_os = "macos")]
                follow_active_space(&win);
            }

            #[cfg(desktop)]
            {
                // Regular activation: Parker shows in the Dock and Cmd-Tab.
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Regular);

                build_tray(app.handle())?;

                // Register the summon/dismiss shortcut (from settings, or the
                // ⌃⌥P default) — it toggles Parker from anywhere.
                use std::str::FromStr;
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let sc = Shortcut::from_str(&current_shortcut()).unwrap_or_else(|_| {
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP)
                });
                app.global_shortcut().register(sc)?;

                // Watch the notes folder: when a file changes on disk (git
                // pull, another machine/editor), tell the frontend so it can
                // reload the open tab instead of letting autosave clobber it.
                rewatch_notes(app.handle());

                // One perf sample a minute into perf.jsonl, so slow memory
                // growth is diagnosable after the fact (⌘⇧D shows it live).
                monitor::start_sampler();
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            // Real quit — flush on the frontend, then exit.
            "quit" => request_quit(app, true),
            "settings" => {
                use tauri::Emitter;
                let _ = app.emit("parker://open-settings", ());
            }
            "about" => show_about_window(app),
            "help" => show_help_window(app),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            notes_dir_path,
            home_dir_path,
            list_notes,
            search_notes,
            read_note,
            write_note,
            delete_note,
            create_note,
            rename_note,
            load_session,
            save_session,
            get_settings,
            set_shortcut,
            set_autostart,
            set_git_auto_sync,
            set_git_sync_interval,
            set_zoom,
            open_help,
            git_status,
            git_commit,
            git_push,
            git_log,
            pick_notes_dir,
            set_notes_dir,
            quit,
            monitor::perf_stats,
            monitor::perf_log_path,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Clicking the Dock icon (now that we're a Regular app) re-summons
            // the window even after the red button hid it back to the tray.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &_event {
                show_window(_app);
            }
        });
}

// ---- Tests ----------------------------------------------------------------
// Everything covered here is pure: names in, decision out; git's stdout in,
// parsed rows out. The commands themselves aren't tested — they need a running
// app and a real notes folder — so the rule is that anything worth being sure
// about lives in a function that takes its input as an argument.

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Settings & session ----------------------------------------------

    // The black-window bug: a derived Default gave zoom 0.0, load_settings()
    // falls back to Default on every first launch, and scaling a webview by
    // zero paints nothing.
    #[test]
    fn default_settings_do_not_zoom_to_nothing() {
        assert_eq!(Settings::default().zoom, 1.0);
    }

    #[test]
    fn a_settings_file_without_zoom_still_means_100_percent() {
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.zoom, 1.0);
    }

    #[test]
    fn nonsense_zooms_fall_back_to_no_zoom() {
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 99.0, 0.49, 3.01] {
            assert_eq!(clamp_zoom(bad), 1.0, "{bad} should have fallen back");
        }
    }

    #[test]
    fn usable_zooms_are_kept_as_they_are() {
        for ok in [ZOOM_MIN, 0.9, 1.0, 1.5, ZOOM_MAX] {
            assert_eq!(clamp_zoom(ok), ok);
        }
    }

    #[test]
    fn settings_survive_a_round_trip_through_the_file_format() {
        let s = Settings {
            notes_dir: Some("/notes".into()),
            shortcut: Some("Ctrl+Alt+K".into()),
            git_auto_sync: true,
            git_sync_interval: 15,
            zoom: 1.25,
        };
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back.notes_dir, s.notes_dir);
        assert_eq!(back.shortcut, s.shortcut);
        assert_eq!(back.git_auto_sync, s.git_auto_sync);
        assert_eq!(back.git_sync_interval, s.git_sync_interval);
        assert_eq!(back.zoom, s.zoom);
    }

    // A settings file written by an older Parker is missing whatever was added
    // since; one written by a newer Parker carries keys this build has never
    // heard of. Neither may reset the user's settings.
    #[test]
    fn settings_tolerate_both_older_and_newer_files() {
        let old: Settings = serde_json::from_str(r#"{"notes_dir":"/notes"}"#).unwrap();
        assert_eq!(old.notes_dir.as_deref(), Some("/notes"));
        assert_eq!(old.zoom, 1.0);

        let new: Settings =
            serde_json::from_str(r#"{"notes_dir":"/notes","zoom":2.0,"from_the_future":true}"#)
                .unwrap();
        assert_eq!(new.zoom, 2.0);
    }

    #[test]
    fn an_empty_session_file_opens_an_empty_session() {
        let s: Session = serde_json::from_str("{}").unwrap();
        assert!(s.open.is_empty());
        assert!(s.active.is_none());
        assert!(s.layout.is_none());
    }

    // The layout tree belongs to the frontend; the backend stores it verbatim
    // and must not normalise, reorder or drop any of it.
    #[test]
    fn the_layout_tree_round_trips_untouched() {
        let layout = r#"{"id":"s1","kind":"split","dir":"row","children":[{"id":"g1","kind":"group","tabs":["a.md"],"active":"a.md","mode":"preview"}],"sizes":[1.0]}"#;
        let json = format!(r#"{{"open":["a.md"],"active":"a.md","layout":{layout},"focused":"g1"}}"#);
        let s: Session = serde_json::from_str(&json).unwrap();
        let back: Session = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back.layout, serde_json::from_str::<serde_json::Value>(layout).ok());
        assert_eq!(back.focused.as_deref(), Some("g1"));
    }

    // No layout means no "layout" key — a null there is a value the frontend
    // would have to defend against on every read.
    #[test]
    fn a_session_without_a_layout_writes_no_layout_key() {
        let json = serde_json::to_string(&Session::default()).unwrap();
        assert!(!json.contains("layout"), "{json}");
        assert!(!json.contains("focused"), "{json}");
    }

    // load_session falls back to an empty session when the file won't parse,
    // so what matters isn't that every corruption is an error — it's that none
    // of them can come back as a half-restored workspace.
    #[test]
    fn a_corrupt_session_file_never_half_restores() {
        for junk in ["", "not json", "[]", r#"{"open":"a.md"}"#, r#"{"open":[1,2]}"#] {
            if let Ok(s) = serde_json::from_str::<Session>(junk) {
                assert!(
                    s.open.is_empty() && s.active.is_none() && s.layout.is_none(),
                    "{junk:?} restored {:?}",
                    s.open
                );
            }
        }
    }

    // ---- Note names -------------------------------------------------------

    #[test]
    fn ordinary_note_names_are_accepted() {
        for name in [
            "note.md",
            "Untitled-1.md",
            "two words.txt",
            "acentuação.md",
            "日本語.md",
            "no-extension",
            "weird!@#$%^&()name.md",
        ] {
            assert!(validate_note_name(name).is_ok(), "{name:?} should be a valid note name");
        }
    }

    // The webview can ask for any name it likes; none of these may resolve to
    // a file outside the notes folder.
    #[test]
    fn names_that_could_escape_the_notes_folder_are_refused() {
        for name in [
            "",
            "..",
            "../secret",
            "../../etc/passwd",
            "sub/note.md",
            "/etc/passwd",
            "notes/../../etc/passwd",
            "sub\\note.md",
            ".ssh",
            ".hidden.md",
            "a..b.md", // a legitimate name, refused as collateral: ".." is out
        ] {
            assert!(validate_note_name(name).is_err(), "{name:?} should be refused");
        }
    }

    #[test]
    fn dotfiles_and_our_own_temp_files_are_not_notes() {
        assert!(is_listed_note("note.md"));
        assert!(is_listed_note("Untitled-1.txt"));
        assert!(!is_listed_note(".DS_Store"));
        assert!(!is_listed_note(".gitignore"));
        assert!(!is_listed_note("note.md.parker-tmp"));
        assert!(!is_listed_note("note.parker-tmp"));
    }

    #[test]
    fn a_new_notes_extension_is_always_a_usable_one() {
        assert_eq!(note_ext(None), "md");
        assert_eq!(note_ext(Some("txt".into())), "txt");
        assert_eq!(note_ext(Some("MD".into())), "MD");
        assert_eq!(note_ext(Some("".into())), "md");
        assert_eq!(note_ext(Some("!!!".into())), "md");
        assert_eq!(note_ext(Some("../evil".into())), "evil");
        assert_eq!(note_ext(Some(".md".into())), "md");
    }

    // ---- Atomic writes ----------------------------------------------------

    #[test]
    fn a_write_lands_whole_and_leaves_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        atomic_write(&path, "first").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");
        atomic_write(&path, "second, shorter").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second, shorter");

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".parker-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");
    }

    #[test]
    fn an_empty_note_overwrites_a_full_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        atomic_write(&path, "some text").unwrap();
        atomic_write(&path, "").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "");
    }

    #[test]
    fn notes_that_differ_only_by_extension_do_not_share_a_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let md = temp_path(&dir.path().join("notes.md"));
        let txt = temp_path(&dir.path().join("notes.txt"));
        assert_ne!(md, txt, "autosaving both at once would clobber one of them");
        assert!(md.to_string_lossy().ends_with(".parker-tmp"));
    }

    // ---- Git output parsing ----------------------------------------------

    #[test]
    fn numstat_counts_lines_and_spots_binaries() {
        let out = parse_numstat("3\t1\tnote.md\n0\t7\told.md\n-\t-\timage.png\n");
        assert_eq!(out.get("note.md"), Some(&(3, 1, false)));
        assert_eq!(out.get("old.md"), Some(&(0, 7, false)));
        assert_eq!(out.get("image.png"), Some(&(0, 0, true)));
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn numstat_ignores_lines_that_carry_no_path() {
        let out = parse_numstat("\n3\t1\n\t\t\ngarbage\n");
        assert!(out.is_empty(), "{out:?}");
    }

    #[test]
    fn numstat_keeps_paths_with_spaces_intact() {
        let out = parse_numstat("1\t0\tmy notes/a b.md\n");
        assert_eq!(out.get("my notes/a b.md"), Some(&(1, 0, false)));
    }

    #[test]
    fn a_status_line_yields_its_code_and_path() {
        assert_eq!(
            parse_status_line(" M note.md"),
            Some((" M".into(), "note.md".into()))
        );
        assert_eq!(
            parse_status_line("?? Untitled-1.md"),
            Some(("??".into(), "Untitled-1.md".into()))
        );
        assert_eq!(
            parse_status_line("A  staged.md"),
            Some(("A ".into(), "staged.md".into()))
        );
        assert_eq!(
            parse_status_line(" M two words.md"),
            Some((" M".into(), "two words.md".into()))
        );
    }

    // A rename is reported against the file that exists now, not the one that
    // doesn't — the UI lists it, and count_lines would read the wrong path.
    #[test]
    fn a_rename_is_reported_against_its_destination() {
        assert_eq!(
            parse_status_line("R  old name.md -> new name.md"),
            Some(("R ".into(), "new name.md".into()))
        );
    }

    #[test]
    fn a_quoted_path_comes_back_unquoted() {
        assert_eq!(
            parse_status_line(r#" M "note with \"quotes\".md""#),
            Some((" M".into(), r#"note with \"quotes\".md"#.into()))
        );
    }

    #[test]
    fn a_status_line_with_no_room_for_a_path_is_skipped() {
        for line in ["", " ", "??", "?? ", " M "] {
            assert_eq!(parse_status_line(line), None, "{line:?}");
        }
    }

    // Note names are the user's prose: `core.quotepath=false` keeps them
    // literal, so the parser has to handle multi-byte paths without slicing
    // through a character.
    #[test]
    fn a_status_line_handles_a_non_ascii_path() {
        assert_eq!(
            parse_status_line(" M anotação.md"),
            Some((" M".into(), "anotação.md".into()))
        );
    }

    #[test]
    fn a_log_line_splits_into_its_four_fields() {
        assert_eq!(
            parse_log_line("abc123full\tabc123\tFix the thing\t2 hours ago"),
            Some(("abc123full", "abc123", "Fix the thing", "2 hours ago"))
        );
    }

    // The date is taken from the end, so a subject containing a tab doesn't
    // push the date into the subject.
    #[test]
    fn a_log_subject_may_contain_a_tab() {
        assert_eq!(
            parse_log_line("full\tshort\tsubject\twith tab\t3 days ago"),
            Some(("full", "short", "subject\twith tab", "3 days ago"))
        );
    }

    #[test]
    fn a_log_line_without_a_date_still_yields_a_commit() {
        assert_eq!(
            parse_log_line("full\tshort\tjust a subject"),
            Some(("full", "short", "just a subject", ""))
        );
    }

    #[test]
    fn a_log_line_that_is_not_a_commit_is_skipped() {
        for line in ["", "onefield", "full\t", "\t\tsubject"] {
            assert_eq!(parse_log_line(line), None, "{line:?}");
        }
    }

    // ---- Commit messages --------------------------------------------------

    #[test]
    fn a_commit_message_is_trimmed_before_it_is_used() {
        assert_eq!(validate_commit_message("  notes  ").unwrap(), "notes");
    }

    #[test]
    fn an_empty_commit_message_is_refused() {
        for msg in ["", "   ", "\n\t "] {
            assert!(validate_commit_message(msg).is_err(), "{msg:?}");
        }
    }

    #[test]
    fn a_commit_message_is_measured_in_characters_not_bytes() {
        // 500 emoji is 2000 bytes and exactly at the limit; 501 is over it.
        assert!(validate_commit_message(&"🙂".repeat(500)).is_ok());
        assert!(validate_commit_message(&"🙂".repeat(501)).is_err());
        assert!(validate_commit_message(&"a".repeat(500)).is_ok());
        assert!(validate_commit_message(&"a".repeat(501)).is_err());
    }
}
