// Parker updates itself (Onda 6, decisions of 24/09).
//
// - It asks GitHub for latest.json ~10 s after launch and then once a day
//   while open — on by default, off in Settings › Updates.
// - A newer version is announced quietly: an "Update" badge in the status
//   bar, and the app and menu-bar menus say "Update to Parker X.Y.Z…". No
//   modal, no system notification.
// - NOTHING is downloaded before "Update & Restart" ("prefiro não baixar
//   coisas na máquina do usuário sem ele saber"). Then the package is checked
//   against the public key in tauri.conf.json, swapped in, and Parker
//   restarts through the quit path: saves flushed, git sync on quit, note
//   windows remembered — the session comes back after.
// - "Skip This Version" hides that version until a newer one.
// - Parker Dev never updates: the plugin isn't even loaded in debug builds.
//
// The rules (what to offer, when a check is due, whether this copy of the app
// can replace itself) are pure and tested here.

// Most of this is only called by the release build (the plugin isn't in
// Parker Dev); the tests use it everywhere.
#![cfg_attr(debug_assertions, allow(dead_code))]

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

/// What the windows are told about an update.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    /// The release notes (Markdown).
    pub notes: String,
}

/// Everything a window needs to draw the update UI, asked for when it opens.
#[derive(Serialize, Clone, Debug)]
pub struct UpdateState {
    /// Updates can happen at all in this build (not in Parker Dev).
    pub enabled: bool,
    pub current: String,
    pub available: Option<UpdateInfo>,
    /// Why this copy can't update itself, when it can't (run from the DMG).
    pub blocked: Option<String>,
}

/// How long between automatic checks while Parker stays open.
pub const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// The first automatic check, after launch: late enough not to compete with
/// opening the notes.
pub const FIRST_CHECK: Duration = Duration::from_secs(10);

/// Whether an automatic check should offer this version: not one the person
/// skipped. A manual check ("Check for Updates…") always offers it.
pub fn should_offer(version: &str, skipped: Option<&str>, manual: bool) -> bool {
    manual || skipped != Some(version)
}

/// Whether an automatic check is due.
pub fn check_due(last: Option<SystemTime>, now: SystemTime) -> bool {
    match last {
        None => true,
        Some(t) => now.duration_since(t).map(|d| d >= CHECK_EVERY).unwrap_or(true),
    }
}

/// A copy of Parker that can't replace itself, and what to tell the person:
/// opened straight from the DMG (a read-only volume), or translocated by
/// Gatekeeper (a random read-only path until it's moved).
pub fn blocked_reason(exe: &str) -> Option<String> {
    let moved = "Move Parker to your Applications folder to update it.";
    if exe.starts_with("/Volumes/") {
        return Some(format!("Parker is running from its disk image. {moved}"));
    }
    if exe.contains("/AppTranslocation/") {
        return Some(format!("macOS is running Parker from a temporary place. {moved}"));
    }
    None
}

/// The update found, kept until it's installed or a newer one replaces it.
#[derive(Default)]
pub struct Pending(pub Mutex<Option<PendingUpdate>>);

pub struct PendingUpdate {
    pub info: UpdateInfo,
    #[cfg(all(desktop, not(debug_assertions)))]
    pub update: tauri_plugin_updater::Update,
}

/// When the last automatic check ran.
#[derive(Default)]
pub struct LastCheck(pub Mutex<Option<SystemTime>>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skipped_version_is_only_offered_when_asked_for() {
        assert!(should_offer("1.5.1", None, false));
        assert!(!should_offer("1.5.1", Some("1.5.1"), false));
        assert!(should_offer("1.5.2", Some("1.5.1"), false), "a newer one comes back");
        assert!(should_offer("1.5.1", Some("1.5.1"), true), "Check for Updates… always tells");
    }

    #[test]
    fn a_check_is_due_once_a_day() {
        let now = SystemTime::now();
        assert!(check_due(None, now));
        assert!(!check_due(Some(now - Duration::from_secs(3600)), now));
        assert!(check_due(Some(now - CHECK_EVERY), now));
        // A clock that went backwards doesn't stop checks for good.
        assert!(check_due(Some(now + Duration::from_secs(3600)), now));
    }

    #[test]
    fn a_copy_run_from_the_dmg_or_translocated_cant_update() {
        assert!(blocked_reason("/Applications/Parker.app/Contents/MacOS/parker").is_none());
        assert!(blocked_reason("/Volumes/Parker/Parker.app/Contents/MacOS/parker").unwrap().contains("disk image"));
        let t = "/private/var/folders/x/T/AppTranslocation/ABC/d/Parker.app/Contents/MacOS/parker";
        assert!(blocked_reason(t).unwrap().contains("Applications folder"));
    }
}
