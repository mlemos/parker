// What the status bar does with a click (1.5.2): copy a path, show a note or
// the notes folder in the Finder, and know how long the Mac waits before a
// second click is a double click.
//
// The copy goes through Rust, not navigator.clipboard: a single click waits
// for the double-click time before it acts (so a double click never also
// copies), and WebKit only lets the page write the clipboard inside the click
// itself, not a moment later.

/// Put `text` on the general pasteboard, as plain text.
#[tauri::command]
pub fn copy_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::NSString;
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let ok = unsafe { pb.setString_forType(&NSString::from_str(&text), NSPasteboardTypeString) };
        if ok {
            Ok(())
        } else {
            Err("The clipboard didn't take it.".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err("Copying is only wired up on macOS.".into())
    }
}

/// The Mac's double-click time, in milliseconds (System Settings ›
/// Accessibility › Pointer Control). 500 ms when it can't be read.
#[tauri::command]
pub fn double_click_ms() -> u32 {
    #[cfg(target_os = "macos")]
    {
        let s = objc2_app_kit::NSEvent::doubleClickInterval();
        if s.is_finite() && s > 0.0 {
            return (s * 1000.0).round() as u32;
        }
    }
    500
}

/// Show a note in the Finder, selected — or, with no name, the notes folder
/// itself, opened.
#[tauri::command]
pub fn reveal_note(name: Option<String>) -> Result<(), String> {
    match name {
        Some(n) => {
            let path = crate::safe_note_path(&n)?;
            if !path.exists() {
                return Err("That note isn't on disk.".into());
            }
            tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
        }
        None => {
            let dir = crate::notes_dir();
            if !dir.is_dir() {
                return Err("Your notes folder isn't there.".into());
            }
            tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| e.to_string())
        }
    }
}
