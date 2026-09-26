// Files opened from outside the notes folder — double-clicked in the Finder,
// or picked from File › Open…. Parker edits them where they are.
//
// The rule the rest of the backend lives by is that the webview never names a
// path: it names a note, and the note lives in the notes folder. A file from
// anywhere else has to be addressed by its path, so this module keeps the rule
// by turning it around — the webview may only read and write a path that was
// *admitted* here first, and admission only comes from the OS (the Finder's
// open event, the Open… panel) or from the session file Parker wrote itself.
// A path arriving any other way is refused exactly as `validate_note_name`
// refuses it: there is a second door, and the door has a list.
//
// A file the Finder hands over that turns out to live *in* the notes folder —
// at any depth — is not external at all: it goes back to the webview as a
// note name, relative to the folder, and opens like any other note.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::Emitter;

use crate::{atomic_write, note_name_of, show_window};

#[derive(Default)]
pub struct Externals {
    /// Paths the webview may address. Shared with the watcher's callback,
    /// which has to answer "is this one of ours?" from another thread.
    admitted: Arc<Mutex<HashSet<PathBuf>>>,
    /// Watched parent folders and how many admitted files live in each. The
    /// folder is watched rather than the file: an editor that saves by
    /// writing a temp file and renaming it into place replaces the inode, and
    /// a watch on the old one goes quiet.
    dirs: HashMap<PathBuf, usize>,
    watcher: Option<notify::RecommendedWatcher>,
    /// What the OS asked Parker to open and the webview has not collected yet.
    /// The open event can arrive before the webview exists (a cold launch by
    /// double-click), so it is queued here and drained by a command — the
    /// event Parker emits only says "come and get them".
    pending: Vec<String>,
}

pub struct ExternalState(pub Mutex<Externals>);

impl Default for ExternalState {
    fn default() -> Self {
        Self(Mutex::new(Externals::default()))
    }
}

/// Where the file sits relative to Parker: a note in the notes folder, known
/// by name, or a file anywhere else, known by its full path.
enum Place {
    Note(String),
    Outside(PathBuf),
}

fn locate(path: &Path) -> Result<Place, String> {
    // Resolve symlinks and the /private prefix so the path the watcher reports
    // later matches the one admitted now.
    let real = path
        .canonicalize()
        .map_err(|e| format!("{}: {e}", path.display()))?;
    if !real.is_file() {
        return Err(format!("{}: not a file", real.display()));
    }
    if let Some(name) = note_name_of(&real) {
        return Ok(Place::Note(name));
    }
    Ok(Place::Outside(real))
}

impl Externals {
    /// Let the webview address this path, and start watching its folder. Gives
    /// back what the webview should open: a bare name for a note, the full
    /// path for anything else.
    /// `app` builds the watcher on first use; tests pass None and get the
    /// bookkeeping without one.
    fn admit(&mut self, app: Option<&tauri::AppHandle>, path: &Path) -> Result<String, String> {
        let real = match locate(path)? {
            Place::Note(name) => return Ok(name),
            Place::Outside(real) => real,
        };
        let fresh = self
            .admitted
            .lock()
            .map_err(|_| "external files: poisoned lock".to_string())?
            .insert(real.clone());
        if fresh {
            if let Some(dir) = real.parent() {
                self.watch(app, dir);
                // Its images, next to it, load in the preview like a note's.
                if let Some(app) = app {
                    super::allow_images(app, dir);
                }
            }
        }
        Ok(real.to_string_lossy().into_owned())
    }

    /// The webview closed the file: forget it, and stop watching its folder
    /// when nothing else of ours lives there.
    fn release(&mut self, path: &Path) {
        let Ok(mut set) = self.admitted.lock() else { return };
        if !set.remove(path) {
            return;
        }
        drop(set);
        if let Some(dir) = path.parent() {
            self.unwatch(dir);
        }
    }

    fn watch(&mut self, app: Option<&tauri::AppHandle>, dir: &Path) {
        use notify::{RecursiveMode, Watcher};
        let count = self.dirs.entry(dir.to_path_buf()).or_insert(0);
        *count += 1;
        if *count > 1 {
            return;
        }
        if self.watcher.is_none() {
            self.watcher = app.and_then(|a| build_watcher(a, Arc::clone(&self.admitted)));
        }
        if let Some(w) = self.watcher.as_mut() {
            if let Err(e) = w.watch(dir, RecursiveMode::NonRecursive) {
                eprintln!("external watcher: watch {} failed: {e}", dir.display());
            }
        }
    }

    fn unwatch(&mut self, dir: &Path) {
        use notify::Watcher;
        let Some(count) = self.dirs.get_mut(dir) else { return };
        *count -= 1;
        if *count > 0 {
            return;
        }
        self.dirs.remove(dir);
        if let Some(w) = self.watcher.as_mut() {
            let _ = w.unwatch(dir);
        }
    }

    /// Only an admitted path comes back as a `PathBuf` the commands may touch.
    fn check(&self, path: &str) -> Result<PathBuf, String> {
        let p = PathBuf::from(path);
        let set = self
            .admitted
            .lock()
            .map_err(|_| "external files: poisoned lock".to_string())?;
        if set.contains(&p) {
            Ok(p)
        } else {
            Err(format!("not an open file: {path}"))
        }
    }
}

/// A watcher over the folders of admitted files, emitting the same
/// `parker://note-changed` the notes watcher does — with the full path, which
/// is the name the webview knows an external file by.
fn build_watcher(
    app: &tauri::AppHandle,
    admitted: Arc<Mutex<HashSet<PathBuf>>>,
) -> Option<notify::RecommendedWatcher> {
    use notify::EventKind;
    let handle = app.clone();
    match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !matches!(
            event.kind,
            EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
        ) {
            return;
        }
        let Ok(set) = admitted.lock() else { return };
        for path in event.paths {
            if set.contains(&path) {
                let _ = handle.emit("parker://note-changed", path.to_string_lossy().into_owned());
            }
        }
    }) {
        Ok(w) => Some(w),
        Err(e) => {
            eprintln!("external watcher: init failed: {e}");
            None
        }
    }
}

fn state(app: &tauri::AppHandle) -> tauri::State<'_, ExternalState> {
    use tauri::Manager;
    app.state::<ExternalState>()
}

/// The OS asked Parker to open these (Finder double-click, drag onto the Dock
/// icon, `open -a`). Admit them, queue them, wake the webview and the window.
pub fn queue_open(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    let st = state(app);
    let Ok(mut ext) = st.0.lock() else { return };
    let mut any = false;
    for path in paths {
        match ext.admit(Some(app), &path) {
            Ok(name) => {
                ext.pending.push(name);
                any = true;
            }
            Err(e) => eprintln!("open file: {e}"),
        }
    }
    drop(ext);
    if any {
        let _ = app.emit("parker://files-opened", ());
        show_window(app);
    }
}

/// Re-admit the external files a saved session lists, so the restore can read
/// them. A path that no longer exists is left out: the webview treats a file
/// it cannot read as gone, the same as a deleted note.
pub fn admit_session(app: &tauri::AppHandle, open: &[String]) {
    let st = state(app);
    let Ok(mut ext) = st.0.lock() else { return };
    for name in open.iter().filter(|n| n.starts_with('/')) {
        if let Err(e) = ext.admit(Some(app), Path::new(name)) {
            eprintln!("session: {e}");
        }
    }
}

/// Admit one file by absolute path — for a note window about to read it, or
/// the main window taking it back. Not a file any more: nothing happens, and
/// the read that follows says so.
pub fn admit_path(app: &tauri::AppHandle, path: &str) {
    let st = state(app);
    let Ok(mut ext) = st.0.lock() else { return };
    if let Err(e) = ext.admit(Some(app), Path::new(path)) {
        eprintln!("note window: {e}");
    }
}

// ---- Commands -------------------------------------------------------------

#[tauri::command]
pub async fn read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let p = state(&app)
        .0
        .lock()
        .map_err(|_| "external files: poisoned lock".to_string())?
        .check(&path)?;
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let p = state(&app)
        .0
        .lock()
        .map_err(|_| "external files: poisoned lock".to_string())?
        .check(&path)?;
    atomic_write(&p, &content)
}

/// The webview closed the last tab showing this file.
#[tauri::command]
pub fn close_file(app: tauri::AppHandle, window: tauri::Window, path: String) {
    // A note window that took this file over still needs it readable — the
    // main window letting go of its tab is not the file being closed.
    if let Some(holder) = crate::windows::locate_note(&app, &path) {
        if holder != window.label() {
            return;
        }
    }
    if let Ok(mut ext) = state(&app).0.lock() {
        ext.release(Path::new(&path));
    }
}

/// Everything the OS asked Parker to open since the last call. Bare names are
/// notes in the notes folder; anything else is an absolute path.
#[tauri::command]
pub fn take_opened_files(app: tauri::AppHandle) -> Vec<String> {
    match state(&app).0.lock() {
        Ok(mut ext) => std::mem::take(&mut ext.pending),
        Err(_) => Vec::new(),
    }
}

/// File › Open…: a native panel, then the same road as a Finder open. The
/// panel blocks, so it runs on its own thread; the menu handler returns at
/// once.
pub fn open_dialog(app: &tauri::AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    let app = app.clone();
    std::thread::spawn(move || {
        let picked: Vec<PathBuf> = app
            .dialog()
            .file()
            .add_filter("Markdown & text", &["md", "markdown", "mdown", "mkd", "txt"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .collect();
        if !picked.is_empty() {
            queue_open(&app, picked);
        }
    });
}

/// Show the file in the Finder — the one action Parker offers on a file it
/// does not own besides editing it.
#[tauri::command]
pub fn reveal_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = state(&app)
        .0
        .lock()
        .map_err(|_| "external files: poisoned lock".to_string())?
        .check(&path)?;
    tauri_plugin_opener::reveal_item_in_dir(&p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A scratch folder of our own, gone when the test is.
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("parker-external-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
        fn file(&self, name: &str) -> PathBuf {
            let p = self.0.join(name);
            fs::write(&p, "x").unwrap();
            p
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn check_refuses_what_was_never_admitted() {
        let ext = Externals::default();
        assert!(ext.check("/etc/passwd").is_err());
        assert!(ext.check("").is_err());
    }

    #[test]
    fn locate_rejects_missing_and_directories() {
        assert!(locate(Path::new("/definitely/not/here.md")).is_err());
        assert!(locate(Path::new("/tmp")).is_err());
    }

    #[test]
    fn locate_gives_the_real_path_of_a_file() {
        let s = Scratch::new("locate");
        let f = s.file("a.md");
        match locate(&f).unwrap() {
            Place::Outside(real) => {
                assert_eq!(real, f.canonicalize().unwrap());
                assert!(real.is_absolute());
            }
            Place::Note(_) => panic!("a scratch file is not a note"),
        }
    }

    #[test]
    fn locate_resolves_a_symlink_to_its_target() {
        let s = Scratch::new("symlink");
        let target = s.file("real.md");
        let link = s.0.join("link.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        match locate(&link).unwrap() {
            Place::Outside(real) => assert_eq!(real, target.canonicalize().unwrap()),
            Place::Note(_) => panic!(),
        }
    }

    #[test]
    fn admit_then_check_then_release() {
        let s = Scratch::new("admit");
        let f = s.file("a.md");
        let mut ext = Externals::default();
        let name = ext.admit(None, &f).unwrap();
        assert_eq!(name, f.canonicalize().unwrap().to_string_lossy());
        assert_eq!(ext.check(&name).unwrap(), PathBuf::from(&name));
        // The folder is counted once for the one file in it.
        assert_eq!(ext.dirs.len(), 1);
        assert_eq!(ext.dirs.values().next(), Some(&1));

        ext.release(Path::new(&name));
        assert!(ext.check(&name).is_err(), "released path must not be served");
        assert!(ext.dirs.is_empty(), "last file out stops the folder watch");
    }

    #[test]
    fn a_folder_is_watched_once_for_all_its_files() {
        let s = Scratch::new("refcount");
        let a = s.file("a.md");
        let b = s.file("b.md");
        let mut ext = Externals::default();
        let na = ext.admit(None, &a).unwrap();
        let nb = ext.admit(None, &b).unwrap();
        assert_eq!(ext.dirs.len(), 1);
        assert_eq!(ext.dirs.values().next(), Some(&2));
        // Admitting the same file again is not a second file.
        ext.admit(None, &a).unwrap();
        assert_eq!(ext.dirs.values().next(), Some(&2));

        ext.release(Path::new(&na));
        assert_eq!(ext.dirs.values().next(), Some(&1), "b still lives there");
        assert!(ext.check(&nb).is_ok());
        ext.release(Path::new(&nb));
        assert!(ext.dirs.is_empty());
    }

    #[test]
    fn release_of_unknown_path_is_a_no_op() {
        let mut ext = Externals::default();
        ext.release(Path::new("/nowhere/at/all.md"));
        assert!(ext.dirs.is_empty());
    }

    #[test]
    fn admit_refuses_what_is_not_a_file() {
        let s = Scratch::new("notafile");
        let mut ext = Externals::default();
        assert!(ext.admit(None, &s.0).is_err());
        assert!(ext.admit(None, &s.0.join("missing.md")).is_err());
        assert!(ext.dirs.is_empty(), "nothing admitted, nothing watched");
    }
}
