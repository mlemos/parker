// What Parker can tell about a notes folder, for the first run on a Mac and
// for Settings (Onda 5, decisions a–g of 24/09):
//
// - Parker looks for notes in ONE place, Documents › Parker. On a Mac with
//   Desktop & Documents in iCloud that is ~/Documents/Parker; on one without,
//   the same folder as an iPhone sees it is iCloud Drive › Documents › Parker.
//   Anything else is a folder the person picked: it works, and nothing
//   searches for it.
// - For any folder, it says what is in it (notes, other files, git) and where
//   it syncs, as far as the Mac can tell — never "only on this Mac" as a fact
//   unless it is one.
//
// The pure parts (which service a path belongs to, the path as the Finder
// shows it, what counts as a note) are tested here; the macOS lookups (is it
// in iCloud, is iCloud Drive on, the Finder's localized names) are thin.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SyncInfo {
    /// "icloud", "google-drive", "dropbox", "onedrive", "box", "cloud" (another
    /// File Provider), "local" (known to stay on this Mac) or "unknown".
    pub service: String,
    /// The service's name, for the screen ("iCloud Drive", "Google Drive"…).
    pub label: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct FolderInfo {
    pub path: String,
    /// "Documents › Parker", "iCloud Drive › Notes", "~/Projects/notes".
    pub display: String,
    pub exists: bool,
    /// False when macOS didn't let Parker look (the Documents prompt refused).
    pub readable: bool,
    pub notes: u32,
    pub other: u32,
    pub git: bool,
    pub git_remote: Option<String>,
    pub sync: SyncInfo,
}

#[derive(Serialize, Clone, Debug)]
pub struct ICloudState {
    /// iCloud Drive is on for this Mac's account.
    pub drive: bool,
    /// Desktop & Documents is in iCloud: ~/Documents syncs.
    pub documents: bool,
}

/// The files the app treats as notes when counting a folder; everything else
/// visible is "other files", which Parker leaves alone.
pub fn is_note_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".md", ".markdown", ".mdown", ".mkd", ".txt"].iter().any(|e| lower.ends_with(e))
}

/// Which service syncs `path`, from where it lives. `ubiquitous` is macOS's
/// answer for iCloud (the only way to know ~/Documents is in it);
/// `dropbox_roots` are the folders the old Dropbox app says it syncs.
pub fn sync_of(path: &Path, home: &Path, ubiquitous: bool, dropbox_roots: &[PathBuf]) -> SyncInfo {
    let s = |service: &str, label: &str| SyncInfo { service: service.into(), label: label.into() };
    if path.starts_with(home.join("Library/Mobile Documents")) || ubiquitous {
        return s("icloud", "iCloud Drive");
    }
    if let Ok(rest) = path.strip_prefix(home.join("Library/CloudStorage")) {
        let provider = rest.components().next().map(|c| c.as_os_str().to_string_lossy().into_owned()).unwrap_or_default();
        return match provider.split('-').next().unwrap_or("") {
            "GoogleDrive" => s("google-drive", "Google Drive"),
            "Dropbox" => s("dropbox", "Dropbox"),
            "OneDrive" => s("onedrive", "OneDrive"),
            "Box" => s("box", "Box"),
            other => s("cloud", if other.is_empty() { "a cloud service" } else { other }),
        };
    }
    if dropbox_roots.iter().any(|r| path.starts_with(r)) {
        return s("dropbox", "Dropbox");
    }
    // Documents that isn't in iCloud: a fact, Desktop & Documents is off.
    if path.starts_with(home.join("Documents")) || path.starts_with(home.join("Desktop")) {
        return s("local", "this Mac");
    }
    s("unknown", "")
}

/// A path the way the Finder and the Files app name it: "Documents › Parker",
/// "iCloud Drive › Notes", "Google Drive › My Drive › Notes". Outside those,
/// the home-relative path ("~/Projects/notes"). `name` gives each folder's
/// display name (localized: "Documentos" on a Mac in Portuguese).
pub fn display_of(path: &Path, home: &Path, name: &dyn Fn(&Path) -> String) -> String {
    let join = |base: &Path, rest: &Path, head: Vec<String>| {
        let mut parts = head;
        let mut cur = base.to_path_buf();
        for c in rest.components() {
            cur.push(c);
            parts.push(name(&cur));
        }
        parts.join(" › ")
    };
    let docs = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    if let Ok(rest) = path.strip_prefix(&docs) {
        return join(&docs, rest, vec!["iCloud Drive".into()]);
    }
    let storage = home.join("Library/CloudStorage");
    if let Ok(rest) = path.strip_prefix(&storage) {
        let mut comps = rest.components();
        if let Some(first) = comps.next() {
            let provider = first.as_os_str().to_string_lossy();
            let label = match provider.split('-').next().unwrap_or("") {
                "GoogleDrive" => "Google Drive".to_string(),
                "OneDrive" => "OneDrive".to_string(),
                "Dropbox" => "Dropbox".to_string(),
                "Box" => "Box".to_string(),
                p => p.to_string(),
            };
            let base = storage.join(first);
            return join(&base, comps.as_path(), vec![label]);
        }
    }
    for top in ["Documents", "Desktop"] {
        let base = home.join(top);
        if let Ok(rest) = path.strip_prefix(&base) {
            return join(&base, rest, vec![name(&base)]);
        }
    }
    match path.strip_prefix(home) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

/// Where Parker looks for notes, in order: Documents › Parker on this Mac,
/// then — when Documents isn't in iCloud — the same folder as the iPhone sees
/// it, in iCloud Drive. `dir_name` is "Parker" ("Parker (Dev)" for the Dev
/// build, so the two never share a folder).
pub fn default_places(home: &Path, dir_name: &str, icloud: &ICloudState) -> Vec<PathBuf> {
    let mut v = vec![home.join("Documents").join(dir_name)];
    if icloud.drive && !icloud.documents {
        v.push(home.join("Library/Mobile Documents/com~apple~CloudDocs/Documents").join(dir_name));
    }
    v
}

// ---- The macOS side ----------------------------------------------------------

/// Whether macOS keeps this path in iCloud (NSURLIsUbiquitousItemKey).
#[cfg(target_os = "macos")]
pub fn is_ubiquitous(path: &Path) -> bool {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSNumber, NSString, NSURLIsUbiquitousItemKey, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let mut value: Option<Retained<AnyObject>> = None;
    let ok = unsafe { url.getResourceValue_forKey_error(&mut value, NSURLIsUbiquitousItemKey) };
    ok.is_ok()
        && value
            .and_then(|v| v.downcast::<NSNumber>().ok())
            .map(|n| n.boolValue())
            .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
pub fn is_ubiquitous(_path: &Path) -> bool {
    false
}

/// iCloud Drive on, and Desktop & Documents in it.
pub fn icloud_state(home: &Path) -> ICloudState {
    #[cfg(target_os = "macos")]
    let drive = unsafe { objc2_foundation::NSFileManager::defaultManager().ubiquityIdentityToken().is_some() };
    #[cfg(not(target_os = "macos"))]
    let drive = false;
    ICloudState { drive, documents: drive && is_ubiquitous(&home.join("Documents")) }
}

/// A folder's name as the Finder shows it (localized for Documents, Desktop…).
pub fn finder_name(path: &Path) -> String {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSFileManager, NSString};
        let s = NSFileManager::defaultManager().displayNameAtPath(&NSString::from_str(&path.to_string_lossy()));
        return s.to_string();
    }
    #[allow(unreachable_code)]
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Folders the classic Dropbox app syncs (~/.dropbox/info.json).
fn dropbox_roots(home: &Path) -> Vec<PathBuf> {
    let Ok(text) = std::fs::read_to_string(home.join(".dropbox/info.json")) else { return vec![] };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return vec![] };
    v.as_object()
        .map(|o| o.values().filter_map(|a| a.get("path")?.as_str().map(PathBuf::from)).collect())
        .unwrap_or_default()
}

/// Everything the screens say about one folder.
pub fn inspect(path: &Path, home: &Path, git_remote: &dyn Fn(&Path) -> Option<String>) -> FolderInfo {
    let meta = std::fs::metadata(path);
    let denied = matches!(&meta, Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied);
    let exists = meta.map(|m| m.is_dir()).unwrap_or(false);
    let (mut notes, mut other, mut readable) = (0u32, 0u32, !denied);
    if exists {
        match std::fs::read_dir(path) {
            Ok(_) => {
                for (name, _) in crate::walk_notes(&path.to_path_buf()) {
                    if is_note_file(&name) {
                        notes += 1;
                    } else {
                        other += 1;
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => readable = false,
            Err(_) => {}
        }
    }
    let git = exists && path.join(".git").exists();
    FolderInfo {
        path: path.to_string_lossy().into_owned(),
        display: display_of(path, home, &finder_name),
        exists,
        readable,
        notes,
        other,
        git,
        git_remote: if git { git_remote(path) } else { None },
        sync: sync_of(path, home, is_ubiquitous(path) || (!exists && path.parent().map(is_ubiquitous).unwrap_or(false)), &dropbox_roots(home)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "/home/me";
    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }
    fn plain(path: &Path) -> String {
        path.file_name().unwrap().to_string_lossy().into_owned()
    }

    #[test]
    fn a_path_says_which_service_syncs_it() {
        let h = p(HOME);
        let svc = |path: &str, ubi: bool| sync_of(&p(path), &h, ubi, &[p("/home/me/Dropbox")]).service;
        assert_eq!(svc("/home/me/Library/Mobile Documents/com~apple~CloudDocs/Notes", false), "icloud");
        assert_eq!(svc("/home/me/Documents/Parker", true), "icloud"); // Desktop & Documents on
        assert_eq!(svc("/home/me/Documents/Parker", false), "local"); // …and off: a fact
        assert_eq!(svc("/home/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive/Notes", false), "google-drive");
        assert_eq!(svc("/home/me/Library/CloudStorage/Dropbox/Notes", false), "dropbox");
        assert_eq!(svc("/home/me/Library/CloudStorage/OneDrive-Personal/Notes", false), "onedrive");
        assert_eq!(svc("/home/me/Library/CloudStorage/Box-Box/Notes", false), "box");
        assert_eq!(svc("/home/me/Library/CloudStorage/pCloud/Notes", false), "cloud");
        assert_eq!(svc("/home/me/Dropbox/Notes", false), "dropbox"); // the classic app
        assert_eq!(svc("/home/me/Projects/notes", false), "unknown"); // never "only this Mac" as a fact
    }

    #[test]
    fn a_path_is_named_the_way_the_finder_names_it() {
        let h = p(HOME);
        let show = |path: &str| display_of(&p(path), &h, &plain);
        assert_eq!(show("/home/me/Documents/Parker"), "Documents › Parker");
        assert_eq!(show("/home/me/Library/Mobile Documents/com~apple~CloudDocs/Documents/Parker"), "iCloud Drive › Documents › Parker");
        assert_eq!(show("/home/me/Library/Mobile Documents/com~apple~CloudDocs/Notes"), "iCloud Drive › Notes");
        assert_eq!(show("/home/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive/Notes"), "Google Drive › My Drive › Notes");
        assert_eq!(show("/home/me/Projects/notes"), "~/Projects/notes");
        assert_eq!(show("/Volumes/Work/Notes"), "/Volumes/Work/Notes");
    }

    #[test]
    fn localized_folder_names_come_from_the_finder() {
        // A Mac in Portuguese: the Finder says "Documentos"; the path doesn't.
        let h = p(HOME);
        let pt = |path: &Path| if plain(path) == "Documents" { "Documentos".into() } else { plain(path) };
        assert_eq!(display_of(&p("/home/me/Documents/Parker"), &h, &pt), "Documentos › Parker");
    }

    #[test]
    fn parker_looks_in_documents_and_in_icloud_only_when_documents_isnt_there() {
        let h = p(HOME);
        let on = ICloudState { drive: true, documents: true };
        let off = ICloudState { drive: true, documents: false };
        let none = ICloudState { drive: false, documents: false };
        assert_eq!(default_places(&h, "Parker", &on), vec![p("/home/me/Documents/Parker")]);
        assert_eq!(
            default_places(&h, "Parker", &off),
            vec![p("/home/me/Documents/Parker"), p("/home/me/Library/Mobile Documents/com~apple~CloudDocs/Documents/Parker")]
        );
        assert_eq!(default_places(&h, "Parker (Dev)", &none), vec![p("/home/me/Documents/Parker (Dev)")]);
    }

    #[test]
    fn notes_and_other_files_are_counted_apart() {
        for n in ["a.md", "B.MARKDOWN", "c.txt", "d.mkd", "e.mdown"] {
            assert!(is_note_file(n), "{n}");
        }
        for n in ["photo.png", "data.csv", "README", "notes.md.bak"] {
            assert!(!is_note_file(n), "{n}");
        }
    }

    #[test]
    fn inspecting_a_folder_counts_it_and_finds_its_git() {
        let dir = std::env::temp_dir().join(format!("parker-folder-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("trips/.hidden")).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        for f in ["a.md", "trips/b.md", "photo.png", "trips/.hidden/x.md", ".DS_Store"] {
            std::fs::write(dir.join(f), "x").unwrap();
        }
        let info = inspect(&dir, &p(HOME), &|_| Some("github.com/me/notes".into()));
        assert!(info.exists && info.readable && info.git);
        assert_eq!((info.notes, info.other), (2, 1));
        assert_eq!(info.git_remote.as_deref(), Some("github.com/me/notes"));
        let missing = inspect(&dir.join("nope"), &p(HOME), &|_| None);
        assert!(!missing.exists && missing.readable && !missing.git);
        assert_eq!((missing.notes, missing.other), (0, 0));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
