// A file dragged from the Finder onto the window opens like a double-click.
//
// Tauri has a drag-and-drop handler for exactly this, and Parker turns it off
// (`disable_drag_drop_handler` in setup) because it is all or nothing: it
// answers "handled" to every drag, the internal HTML5 ones included, and the
// tab strip's drag-to-reorder never sees a drop again. With it off, a file
// drop reaches WebKit untouched — which navigates the whole window to the
// file, or pastes its text into the editor. Neither is opening it.
//
// So the one method that decides, `performDragOperation:` on the webview's
// NSView, is replaced here with a version that takes the drop only when the
// pasteboard carries file paths, and hands everything else to the original —
// where wry's disabled handler defers to WebKit and the tab drag lands in the
// DOM as before.

use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::OnceLock;

use objc2::runtime::{AnyObject, Bool, Sel};
use objc2::{msg_send, sel};
// Deprecated in favour of per-item file URLs, but it is the one type that
// answers with plain paths, and it is what wry itself reads.
#[allow(deprecated)]
use objc2_app_kit::NSFilenamesPboardType;
use objc2_foundation::{NSArray, NSString};

use crate::external;

/// The implementation the swizzle replaced: WebKit's own drop handling, via
/// wry's disabled hook.
static ORIGINAL: OnceLock<unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> Bool> =
    OnceLock::new();
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// File paths on the drag's pasteboard, if any — the same reading wry does.
unsafe fn dropped_paths(drag_info: *mut AnyObject) -> Vec<PathBuf> {
    let pb: *mut AnyObject = msg_send![drag_info, draggingPasteboard];
    if pb.is_null() {
        return Vec::new();
    }
    #[allow(deprecated)]
    let list: *mut AnyObject = msg_send![pb, propertyListForType: NSFilenamesPboardType];
    if list.is_null() {
        return Vec::new();
    }
    let Some(arr) = (&*list).downcast_ref::<NSArray>() else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| item.downcast_ref::<NSString>().map(|s| PathBuf::from(s.to_string())))
        .collect()
}

unsafe extern "C-unwind" fn perform_drag_operation(
    this: *mut AnyObject,
    cmd: Sel,
    drag_info: *mut AnyObject,
) -> Bool {
    let paths = dropped_paths(drag_info);
    if !paths.is_empty() {
        if let Some(app) = APP.get() {
            external::queue_open(app, paths);
        }
        return Bool::YES;
    }
    match ORIGINAL.get() {
        Some(orig) => orig(this, cmd, drag_info),
        None => Bool::NO,
    }
}

/// Install the swizzle on the class of this webview. Once per process: the
/// class is shared by every webview wry makes, and the About and Help windows
/// are the same class.
pub fn install(app: &tauri::AppHandle, webview: *mut c_void) {
    if webview.is_null() {
        return;
    }
    let _ = APP.set(app.clone());
    let view = unsafe { &*(webview as *mut AnyObject) };
    let class = view.class();
    let Some(method) = class.instance_method(sel!(performDragOperation:)) else {
        eprintln!("file drop: performDragOperation: not found on {:?}", class.name());
        return;
    };
    if ORIGINAL.get().is_some() {
        return;
    }
    // SAFETY: same signature as the method being replaced (self, _cmd,
    // sender) -> BOOL; the original is kept and called for every drag the
    // replacement does not take.
    let previous = unsafe {
        method.set_implementation(std::mem::transmute::<
            unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> Bool,
            objc2::runtime::Imp,
        >(perform_drag_operation))
    };
    let _ = ORIGINAL.set(unsafe { std::mem::transmute(previous) });
}
