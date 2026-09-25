//! Note windows: a note in a window of its own.
//!
//! The main window is the workspace — tabs, splits, the picker. A note window
//! is the same frontend with the tab strip locked to one tab (`?view=note`),
//! and there can be any number of them. Everything the frontend used to
//! assume about "the window" is decided here instead:
//!
//! - which window a summon (tray, global shortcut, Dock) lands on — the last
//!   one that had focus — and which ones a dismiss hides (all of them);
//! - the rule that a note is open in exactly one window at a time, so two
//!   autosaves never fight over a file: `locate_note` / `focus_note`;
//! - the quit barrier: every window flushes, and the process leaves when the
//!   last one has said so;
//! - what survives a relaunch: the list of note windows, each with its note,
//!   its frame and its pin, written into session.json beside the main
//!   window's layout.
//!
//! Labels: the main window is `main`, note windows are `note-<n>`. The About
//! and Help windows are not editor windows and never hold a note.
//!
//! A note window is never destroyed while the app runs: it is *parked* —
//! hidden, forgotten by the session, kept for the next note. wry deliberately
//! leaks a WKWebView it drops (a `retain()` in its Drop, against callbacks
//! arriving after the free), so every destroyed window would cost its webview
//! and web process for the rest of the session. Parking caps that at the most
//! windows ever open at once, and makes the next pop-out instant.
//!
//! The bookkeeping — which label shows which note, which windows are parked,
//! where the keyboard was, how many windows still owe a flush — lives in
//! [`Registry`] and [`QuitBarrier`], plain data with no window in sight, so
//! the rules can be asserted on. The functions below take a window handle
//! and act on what they decide.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, EventTarget, Manager};

/// Default frame of a fresh note window, in logical pixels — narrow on
/// purpose: a note beside something else, not a second workspace.
const NOTE_W: f64 = 620.0;
const NOTE_H: f64 = 700.0;
/// Where a new note window opens relative to the window it came from.
const CASCADE: f64 = 36.0;
/// A window opened under the pointer sits so the pointer is on its tab strip
/// — the tab lands where the drag let go of it.
const DROP_DX: f64 = 120.0;
const DROP_DY: f64 = 58.0;

/// A note window as the session remembers it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NoteWindowSession {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub on_top: bool,
    /// The window shows the note's preview rather than its editor.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub preview: bool,
}

impl NoteWindowSession {
    fn bare(name: &str, preview: bool) -> Self {
        NoteWindowSession {
            name: name.to_string(),
            x: None,
            y: None,
            w: None,
            h: None,
            on_top: false,
            preview,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NoteWindow {
    pub name: String,
    pub on_top: bool,
    pub preview: bool,
}

// ---- The books ----------------------------------------------------------------

/// Which window shows what. Pure: every rule about labels, notes, parking and
/// focus is decided here and tested below; nothing in it touches a window.
#[derive(Default, Debug)]
pub struct Registry {
    /// Live note windows by label.
    notes: HashMap<String, NoteWindow>,
    /// Parked note windows: hidden, empty, ready to take the next note.
    pool: Vec<String>,
    /// Notes the main window has open, as of its last session save.
    main_open: Vec<String>,
    /// The editor window that last had focus; where a summon lands.
    last_focused: Option<String>,
    next_id: u32,
}

impl Registry {
    /// The next label: `note-1`, `note-2`, … never reused within a run.
    pub fn new_label(&mut self) -> String {
        self.next_id += 1;
        format!("note-{}", self.next_id)
    }

    /// A parked window to reuse, if any — the most recently parked first.
    pub fn take_parked(&mut self) -> Option<String> {
        self.pool.pop()
    }

    /// The window `label` now shows this note.
    pub fn show(&mut self, label: &str, nw: NoteWindow) {
        self.pool.retain(|l| l != label);
        self.notes.insert(label.to_string(), nw);
    }

    /// The window `label` shows a different note, or the same the other way.
    pub fn retarget(&mut self, label: &str, name: &str, preview: bool) {
        if let Some(nw) = self.notes.get_mut(label) {
            nw.name = name.to_string();
            nw.preview = preview;
        }
    }

    pub fn set_on_top(&mut self, label: &str, on_top: bool) {
        if let Some(nw) = self.notes.get_mut(label) {
            nw.on_top = on_top;
        }
    }

    /// Take a note window out of service and keep it for later. False when
    /// the label is not a live note window — nothing to park.
    pub fn park(&mut self, label: &str) -> bool {
        if self.notes.remove(label).is_none() {
            return false;
        }
        self.blur(label);
        if !self.pool.iter().any(|l| l == label) {
            self.pool.push(label.to_string());
        }
        true
    }

    /// The OS took the window away: it is neither live nor parked.
    pub fn destroyed(&mut self, label: &str) {
        self.notes.remove(label);
        self.pool.retain(|l| l != label);
        self.blur(label);
    }

    pub fn is_parked(&self, label: &str) -> bool {
        self.pool.iter().any(|l| l == label)
    }

    pub fn focused(&mut self, label: &str) {
        self.last_focused = Some(label.to_string());
    }

    fn blur(&mut self, label: &str) {
        if self.last_focused.as_deref() == Some(label) {
            self.last_focused = None;
        }
    }

    /// The window a summon lands on: the last focused, else main.
    pub fn focus_label(&self) -> String {
        self.last_focused
            .clone()
            .unwrap_or_else(|| "main".to_string())
    }

    /// The main window said what it has open.
    pub fn main_saved(&mut self, open: &[String]) {
        self.main_open = open.to_vec();
    }

    /// The window holding this note, if any: a note window's label, or
    /// `main`. A note window first — the main window's list is as fresh as its
    /// last save, a note window's is exact.
    pub fn locate(&self, name: &str) -> Option<String> {
        if let Some(label) = self.label_of(name) {
            return Some(label);
        }
        if self.main_open.iter().any(|n| n == name) {
            return Some("main".to_string());
        }
        None
    }

    /// The note window showing this note.
    pub fn label_of(&self, name: &str) -> Option<String> {
        self.notes
            .iter()
            .find(|(_, nw)| nw.name == name)
            .map(|(l, _)| l.clone())
    }

    /// A note moved to a new name — wherever it is. True when a note window
    /// followed it.
    pub fn renamed(&mut self, from: &str, to: &str) -> bool {
        let mut changed = false;
        for nw in self.notes.values_mut() {
            if nw.name == from {
                nw.name = to.to_string();
                changed = true;
            }
        }
        for n in self.main_open.iter_mut() {
            if n == from {
                *n = to.to_string();
            }
        }
        changed
    }

    /// Live note windows, by label: `note-1`, `note-2`, … — a stable order
    /// for the session file and the eye.
    pub fn live(&self) -> Vec<(String, NoteWindow)> {
        let mut v: Vec<_> = self
            .notes
            .iter()
            .map(|(l, nw)| (l.clone(), nw.clone()))
            .collect();
        v.sort_by(|a, b| a.0.cmp(&b.0));
        v
    }

    pub fn live_labels(&self) -> Vec<String> {
        self.live().into_iter().map(|(l, _)| l).collect()
    }
}

/// How many windows still owe a flush before the process may exit. `None`:
/// no quit under way.
#[derive(Default, Debug)]
pub struct QuitBarrier(Option<usize>);

impl QuitBarrier {
    pub fn armed(&self) -> bool {
        self.0.is_some()
    }

    /// Wait for this many windows.
    pub fn arm(&mut self, n: usize) {
        self.0 = Some(n);
    }

    /// One window has flushed; how many are still to come.
    pub fn flushed(&mut self) -> usize {
        let left = self.0.unwrap_or(0).saturating_sub(1);
        self.0 = Some(left);
        left
    }
}

// ---- Geometry ---------------------------------------------------------------

/// A frame in logical points, top-left origin.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Frame {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }
}

/// The top-left of a window opened by a drop at `(x, y)`: the pointer ends up
/// on its tab strip, and the window never starts off the top or left edge.
pub fn dropped_at(x: f64, y: f64) -> (f64, f64) {
    ((x - DROP_DX).max(0.0), (y - DROP_DY).max(0.0))
}

/// The frame of a window that saved these, or the default when a saved size
/// is missing or too small to be a window.
pub fn frame_for(
    entry: &NoteWindowSession,
    fallback: Option<(f64, f64)>,
) -> ((f64, f64), Option<(f64, f64)>) {
    let size = match (entry.w, entry.h) {
        (Some(w), Some(h)) if w >= 200.0 && h >= 200.0 => (w, h),
        _ => (NOTE_W, NOTE_H),
    };
    let pos = match (entry.x, entry.y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => fallback,
    };
    (size, pos)
}

// ---- State ------------------------------------------------------------------

#[derive(Default)]
pub struct WindowState {
    reg: Mutex<Registry>,
    quit: Mutex<QuitBarrier>,
    /// Windows hidden by the last dismiss, brought back together by the next
    /// summon. Empty when nothing is dismissed.
    dismissed: Mutex<Vec<String>>,
    /// Set once a quit is under way: windows going away from here on are the
    /// quit's doing and must not be written out of the session.
    quitting: AtomicBool,
    /// Generation counter behind the debounced geometry save.
    persist_gen: AtomicU64,
}

fn state(app: &tauri::AppHandle) -> tauri::State<'_, WindowState> {
    app.state::<WindowState>()
}

/// Run `f` over the books. A poisoned lock is a bug elsewhere; here it means
/// the operation is skipped rather than the app brought down.
fn with_reg<T>(app: &tauri::AppHandle, f: impl FnOnce(&mut Registry) -> T) -> Option<T> {
    state(app).reg.lock().ok().map(|mut r| f(&mut r))
}

pub fn is_note_label(label: &str) -> bool {
    label.starts_with("note-")
}

/// Main or a note window — the ones that hold notes and take part in
/// summon, dismiss and quit.
pub fn is_editor_label(label: &str) -> bool {
    label == "main" || is_note_label(label)
}

/// Main and the note windows that hold a note — a parked window holds none
/// and takes no part in summon, dismiss or quit.
fn editor_windows(app: &tauri::AppHandle) -> Vec<tauri::WebviewWindow> {
    let mut v: Vec<_> = app
        .webview_windows()
        .into_iter()
        .filter(|(l, _)| {
            is_editor_label(l) && !with_reg(app, |r| r.is_parked(l)).unwrap_or(false)
        })
        .map(|(_, w)| w)
        .collect();
    v.sort_by_key(|w| (w.label() != "main", w.label().to_string()));
    v
}

/// An event for one window. `Emitter::emit` on a window reaches every
/// listener in the app; only a labeled target, met by a listener registered
/// on that window (`getCurrentWebviewWindow().listen` in the frontend),
/// keeps it there.
fn tell<S: Serialize + Clone>(app: &tauri::AppHandle, label: &str, event: &str, payload: S) {
    if let Err(e) = app.emit_to(EventTarget::labeled(label), event, payload) {
        eprintln!("windows: emit {event} to {label} failed: {e}");
    }
}

fn raise(w: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    super::follow_active_space(w);
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
}

// ---- Building --------------------------------------------------------------

/// The one way an editor window is built — main and note windows alike get
/// the overlay title bar with the traffic lights inside Parker's own 40px
/// strip, HTML5 drag-and-drop for the tabs, the saved zoom before the first
/// paint, the follow-the-user Space behaviour and the Finder file drop.
pub fn build_editor_window(
    app: &tauri::AppHandle,
    label: &str,
    url: tauri::WebviewUrl,
    size: (f64, f64),
    position: Option<(f64, f64)>,
) -> tauri::Result<tauri::WebviewWindow> {
    use tauri::WebviewWindowBuilder;
    #[allow(unused_mut)]
    let mut b = WebviewWindowBuilder::new(app, label, url)
        .title(super::variant::TITLE)
        .inner_size(size.0, size.1)
        .min_inner_size(480.0, 360.0)
        // Let HTML5 drag-and-drop work (tab reordering). Otherwise the
        // webview swallows drag events for OS file-drop, which Parker
        // handles itself — filedrop.rs.
        .disable_drag_drop_handler();
    if let Some((x, y)) = position {
        b = b.position(x, y);
    }
    #[cfg(target_os = "macos")]
    {
        b = b
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 22.0));
    }
    let win = super::paint_before_load(b).build()?;
    super::clear_webview_background(&win);
    let _ = win.set_zoom(super::saved_zoom());
    #[cfg(target_os = "macos")]
    super::follow_active_space(&win);
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let _ = win.with_webview(move |wv| super::filedrop::install(&handle, wv.inner()));
    }
    Ok(win)
}

/// The URL a note window loads: the note view, with the note, the window's
/// own label and the current theme, so it paints right on the first frame.
fn note_url(label: &str, name: &str, theme: &str, on_top: bool, preview: bool) -> String {
    format!(
        "index.html?view=note&label={}&name={}&theme={}{}{}",
        urlencode(label),
        urlencode(name),
        urlencode(theme),
        if on_top { "&top=1" } else { "" },
        if preview { "&preview=1" } else { "" }
    )
}

/// Percent-encode for a query value. Note names carry spaces, slashes and
/// anything else a filename may; the query must survive them all.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// The pointer, in logical screen coordinates — the space window positions
/// are given in. On macOS tao reads the pointer in points and scales it by
/// the *primary* monitor's factor, whatever monitor it is on; the same factor
/// undoes it. (Scaling by the monitor under the pointer put a window on a
/// second display of a different density almost off the screen.)
fn cursor_logical(app: &tauri::AppHandle) -> Option<(f64, f64)> {
    let p = app.cursor_position().ok()?;
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    Some((p.x / scale, p.y / scale))
}

/// A window's frame in logical points.
fn frame_of(w: &tauri::Window) -> Option<Frame> {
    let scale = w.scale_factor().unwrap_or(1.0);
    let pos = w.outer_position().ok()?.to_logical::<f64>(scale);
    let size = w.outer_size().ok()?.to_logical::<f64>(scale);
    Some(Frame {
        x: pos.x,
        y: pos.y,
        w: size.width,
        h: size.height,
    })
}

/// Where the next note window opens: a step down and right of the window the
/// user is in, so a second one never hides the first exactly. None when the
/// origin's position can't be read — the OS picks then.
fn cascade_from(app: &tauri::AppHandle) -> Option<(f64, f64)> {
    let label = with_reg(app, |r| r.focus_label())?;
    let w = app.get_webview_window(&label)?;
    let scale = w.scale_factor().unwrap_or(1.0);
    let pos = w.outer_position().ok()?.to_logical::<f64>(scale);
    Some((pos.x + CASCADE, pos.y + CASCADE))
}

fn create(
    app: &tauri::AppHandle,
    entry: &NoteWindowSession,
    position: Option<(f64, f64)>,
) -> tauri::Result<String> {
    // A file from outside the notes folder is named by path; admit it here
    // so the window's first read is allowed.
    if entry.name.starts_with('/') {
        super::external::admit_path(app, &entry.name);
    }
    let (size, pos) = frame_for(entry, position);
    let nw = NoteWindow {
        name: entry.name.clone(),
        on_top: entry.on_top,
        preview: entry.preview,
    };
    // A parked window first: it already runs the frontend, so it only has to
    // be told which note to show, and moved to where the new one would go.
    let parked = with_reg(app, |r| r.take_parked()).flatten();
    if let Some(label) = parked {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.set_size(tauri::LogicalSize::new(size.0, size.1));
            if let Some((x, y)) = pos {
                let _ = win.set_position(tauri::LogicalPosition::new(x, y));
            }
            let _ = win.set_always_on_top(entry.on_top);
            with_reg(app, |r| r.show(&label, nw));
            tell(
                app,
                &label,
                "parker://show-note",
                serde_json::json!({
                    "name": entry.name,
                    "preview": entry.preview,
                    "onTop": entry.on_top,
                }),
            );
            raise(&win);
            eprintln!("note window: {label} reused for {:?}", entry.name);
            return Ok(label);
        }
    }
    let label = with_reg(app, |r| r.new_label()).unwrap_or_else(|| "note-0".to_string());
    let theme = super::current_theme().0;
    eprintln!("note window: building {label} for {:?}", entry.name);
    let win = build_editor_window(
        app,
        &label,
        tauri::WebviewUrl::App(
            note_url(&label, &entry.name, &theme, entry.on_top, entry.preview).into(),
        ),
        size,
        pos,
    )?;
    if entry.on_top {
        let _ = win.set_always_on_top(true);
    }
    with_reg(app, |r| r.show(&label, nw));
    Ok(label)
}

/// Take a note window out of service: hidden, out of the session, its
/// frontend told to let go of its note, and kept for the next one. See the
/// module note on why this is never a destroy.
fn park(app: &tauri::AppHandle, label: &str) {
    let Some(win) = app.get_webview_window(label) else { return };
    if !with_reg(app, |r| r.park(label)).unwrap_or(false) {
        return;
    }
    let _ = win.hide();
    let _ = win.set_always_on_top(false);
    tell(app, label, "parker://parked", ());
    eprintln!("note window: {label} parked");
    persist(app);
}

/// Bring back the note windows a session lists. Called once at startup, after
/// the main window exists — they stack above it.
pub fn restore(app: &tauri::AppHandle, saved: &[NoteWindowSession]) {
    for entry in saved {
        if let Err(e) = create(app, entry, None) {
            eprintln!("note window: restore failed for {:?}: {e}", entry.name);
        }
    }
}

// ---- Session -----------------------------------------------------------------

/// The live note windows, frames read off the screen, in the shape the
/// session stores them.
pub fn snapshot(app: &tauri::AppHandle) -> Vec<NoteWindowSession> {
    let live = with_reg(app, |r| r.live()).unwrap_or_default();
    live.into_iter()
        .filter_map(|(label, nw)| {
            let w = app.get_webview_window(&label)?;
            let scale = w.scale_factor().unwrap_or(1.0);
            let pos = w.outer_position().ok().map(|p| p.to_logical::<f64>(scale));
            let size = w.inner_size().ok().map(|s| s.to_logical::<f64>(scale));
            // Whole points: a fraction written and read back would creep.
            Some(NoteWindowSession {
                name: nw.name,
                x: pos.map(|p| p.x.round()),
                y: pos.map(|p| p.y.round()),
                w: size.map(|s| s.width.round()),
                h: size.map(|s| s.height.round()),
                on_top: nw.on_top,
                preview: nw.preview,
            })
        })
        .collect()
}

/// Write the note windows into the saved session, leaving the main window's
/// part as it is. Skipped while quitting: the windows going away then are the
/// quit's doing, and the session must still list them for the next launch.
pub fn persist(app: &tauri::AppHandle) {
    if state(app).quitting.load(Ordering::SeqCst) {
        return;
    }
    let mut session = super::read_session();
    session.windows = snapshot(app);
    if let Err(e) = super::write_session(&session) {
        eprintln!("note windows: session save failed: {e}");
    }
}

/// A move or a resize fires many times a second; one write after the last of
/// them is enough.
fn persist_soon(app: &tauri::AppHandle) {
    let st = state(app);
    let gen = st.persist_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        if state(&app).persist_gen.load(Ordering::SeqCst) == gen {
            persist(&app);
        }
    });
}

/// The main window saved its session: remember which notes it has, and fill
/// in the note windows before the file is written.
pub fn on_main_session_save(app: &tauri::AppHandle, session: &mut super::Session) {
    with_reg(app, |r| r.main_saved(&session.open));
    session.windows = snapshot(app);
}

// ---- Focus, summon, dismiss ----------------------------------------------------

pub fn on_window_event(app: &tauri::AppHandle, label: &str, event: &tauri::WindowEvent) {
    if !is_editor_label(label) {
        return;
    }
    match event {
        tauri::WindowEvent::Focused(true) => {
            with_reg(app, |r| r.focused(label));
        }
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            if is_note_label(label) {
                persist_soon(app);
            }
        }
        tauri::WindowEvent::Destroyed => {
            if is_note_label(label) {
                with_reg(app, |r| r.destroyed(label));
                persist(app);
            }
        }
        _ => {}
    }
}

/// The window a summon lands on: the last focused editor window that still
/// exists, else main.
pub fn focus_target(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let label = with_reg(app, |r| r.focus_label())?;
    app.get_webview_window(&label)
        .or_else(|| app.get_webview_window("main"))
}

/// Summon: the windows the last dismiss hid come back together; otherwise the
/// focus target alone. Always ends with the keyboard in the focus target.
pub fn summon(app: &tauri::AppHandle) {
    let hidden: Vec<String> = state(app)
        .dismissed
        .lock()
        .map(|mut d| std::mem::take(&mut *d))
        .unwrap_or_default();
    for label in &hidden {
        if let Some(w) = app.get_webview_window(label) {
            #[cfg(target_os = "macos")]
            super::follow_active_space(&w);
            let _ = w.show();
            let _ = w.unminimize();
        }
    }
    if let Some(w) = focus_target(app) {
        raise(&w);
    }
}

/// Dismiss: hide every visible editor window, remembering which, so the next
/// summon undoes exactly this.
pub fn dismiss(app: &tauri::AppHandle) {
    let mut hidden = Vec::new();
    for w in editor_windows(app) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            hidden.push(w.label().to_string());
        }
    }
    if let Ok(mut d) = state(app).dismissed.lock() {
        *d = hidden;
    }
}

/// Is Parker "up" — the focus target visible and holding the keyboard?
pub fn is_front(app: &tauri::AppHandle) -> bool {
    focus_target(app)
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false)
}

// ---- Quit ---------------------------------------------------------------------

/// Start a quit: every editor window is asked to flush, and `quit` below
/// counts them in. `confirm` puts the question to the focus target first —
/// only that window asks, and its answer speaks for all of them.
pub fn request_quit(app: &tauri::AppHandle, confirm: bool) {
    let windows = editor_windows(app);
    if windows.is_empty() {
        app.exit(0);
        return;
    }
    if confirm {
        let Some(target) = focus_target(app) else {
            app.exit(0);
            return;
        };
        // A question nobody can see is not a question.
        if !target.is_visible().unwrap_or(false) {
            summon(app);
        }
        tell(app, target.label(), "parker://confirm-quit", ());
        return;
    }
    begin_quit(app, None);
}

/// Ask every editor window but `except` to flush, and arm the barrier. Once
/// armed, a safety timer leaves anyway: a window that never answers must not
/// keep the process alive through a logout.
fn begin_quit(app: &tauri::AppHandle, except: Option<&str>) -> usize {
    let st = state(app);
    st.quitting.store(true, Ordering::SeqCst);
    let others: Vec<_> = editor_windows(app)
        .into_iter()
        .filter(|w| Some(w.label()) != except)
        .collect();
    if let Ok(mut q) = st.quit.lock() {
        q.arm(others.len());
    }
    for w in &others {
        tell(app, w.label(), "parker://quit", ());
    }
    if others.is_empty() {
        return 0;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        eprintln!("quit: a window did not flush in time — leaving anyway");
        super::finish_quit(&app);
    });
    others.len()
}

/// A window has flushed. The first call from a window nobody asked (the one
/// that confirmed) starts the round for the others; the process leaves when
/// the count reaches zero.
pub fn window_flushed(app: &tauri::AppHandle, label: &str) {
    let armed = state(app).quit.lock().map(|q| q.armed()).unwrap_or(false);
    let remaining = if armed {
        state(app).quit.lock().map(|mut q| q.flushed()).unwrap_or(0)
    } else {
        begin_quit(app, Some(label))
    };
    if remaining == 0 {
        super::finish_quit(app);
    }
}

// ---- Where a note is ----------------------------------------------------------

/// The window holding this note, if any: a note window's label, or `main`.
pub fn locate_note(app: &tauri::AppHandle, name: &str) -> Option<String> {
    with_reg(app, |r| r.locate(name)).flatten()
}

/// A note moved to a new name — in whatever window holds it, and in the
/// main window's list.
pub fn note_renamed(app: &tauri::AppHandle, from: &str, to: &str) {
    if with_reg(app, |r| r.renamed(from, to)).unwrap_or(false) {
        persist(app);
    }
}

/// A note is gone (moved to the Trash): the window showing it closes.
pub fn note_deleted(app: &tauri::AppHandle, name: &str) {
    if let Some(label) = with_reg(app, |r| r.label_of(name)).flatten() {
        park(app, &label);
    }
}

/// The notes folder changed: note windows name their notes relative to the
/// old folder, so they all close.
pub fn close_all(app: &tauri::AppHandle) {
    for label in with_reg(app, |r| r.live_labels()).unwrap_or_default() {
        park(app, &label);
    }
}

// ---- Commands -------------------------------------------------------------------

/// Open (or focus) the window for this note. The caller has already taken the
/// note out of its own window and written it to disk; the new window reads it
/// back. `preview` opens it on the note's preview, as the tab was; `at_cursor`
/// puts it under the pointer (a tab dragged out) instead of cascading from
/// the window it came from. Returns the label.
#[tauri::command]
pub fn open_note_window(
    app: tauri::AppHandle,
    name: String,
    preview: bool,
    at_cursor: bool,
) -> Result<String, String> {
    if let Some(label) = with_reg(&app, |r| r.label_of(&name)).flatten() {
        if let Some(w) = app.get_webview_window(&label) {
            raise(&w);
        }
        return Ok(label);
    }
    let entry = NoteWindowSession::bare(&name, preview);
    let pos = if at_cursor {
        cursor_logical(&app).map(|(x, y)| dropped_at(x, y))
    } else {
        None
    }
    .or_else(|| cascade_from(&app));
    let label = create(&app, &entry, pos).map_err(|e| e.to_string())?;
    persist(&app);
    Ok(label)
}

/// A note window now shows a different note (⌘O inside it), or the same note
/// the other way round (editor ↔ preview).
#[tauri::command]
pub fn set_note_window_note(
    app: tauri::AppHandle,
    window: tauri::Window,
    name: String,
    preview: bool,
) {
    if name.starts_with('/') {
        super::external::admit_path(&app, &name);
    }
    with_reg(&app, |r| r.retarget(window.label(), &name, preview));
    persist(&app);
}

/// Pin the calling window above the others, or let it go.
#[tauri::command]
pub fn set_window_on_top(app: tauri::AppHandle, window: tauri::Window, on_top: bool) {
    let _ = window.set_always_on_top(on_top);
    with_reg(&app, |r| r.set_on_top(window.label(), on_top));
    persist(&app);
}

/// If another window already shows this note, bring it forward and select the
/// note there. True when that happened — the caller opens nothing.
#[tauri::command]
pub fn focus_note(app: tauri::AppHandle, window: tauri::Window, name: String) -> bool {
    let Some(label) = locate_note(&app, &name) else { return false };
    if label == window.label() {
        return false;
    }
    let Some(w) = app.get_webview_window(&label) else { return false };
    raise(&w);
    tell(&app, &label, "parker://focus-note", name);
    true
}

/// Send the calling window's note back to the main window as a tab — a
/// preview tab if that is how the window showed it — and close the window.
/// The frontend has flushed already.
#[tauri::command]
pub fn dock_note(app: tauri::AppHandle, window: tauri::Window, name: String, preview: bool) {
    if name.starts_with('/') {
        super::external::admit_path(&app, &name);
    }
    if let Some(main) = app.get_webview_window("main") {
        raise(&main);
        tell(
            &app,
            "main",
            "parker://open-note",
            serde_json::json!({ "name": name, "preview": preview }),
        );
    }
    if is_note_label(window.label()) {
        park(&app, window.label());
    }
}

/// Is the pointer outside the calling window right now? Asked at the end of a
/// tab drag that nothing took: the answer decides whether the tab was let go
/// of on the desktop (a window of its own) or merely somewhere in the window
/// that takes no drop. Decided here, from the real pointer, because what the
/// webview reports for a drag that ended outside it is not to be relied on.
#[tauri::command]
pub fn pointer_outside_window(app: tauri::AppHandle, window: tauri::Window) -> bool {
    let (Some((x, y)), Some(frame)) = (cursor_logical(&app), frame_of(&window)) else {
        return false;
    };
    !frame.contains(x, y)
}

/// Close the calling note window. The main window never comes through here —
/// its red button hides it.
#[tauri::command]
pub fn close_note_window(app: tauri::AppHandle, window: tauri::Window) {
    if is_note_label(window.label()) {
        park(&app, window.label());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nw(name: &str) -> NoteWindow {
        NoteWindow {
            name: name.into(),
            on_top: false,
            preview: false,
        }
    }

    #[test]
    fn labels_tell_editor_windows_apart() {
        assert!(is_editor_label("main"));
        assert!(is_editor_label("note-1"));
        assert!(is_note_label("note-12"));
        assert!(!is_note_label("main"));
        assert!(!is_editor_label("about"));
        assert!(!is_editor_label("help"));
    }

    #[test]
    fn note_url_survives_any_filename() {
        let url = note_url("note-3", "meetings/Q3 plan (draft)#2.md", "parker-night", false, false);
        assert_eq!(
            url,
            "index.html?view=note&label=note-3&name=meetings%2FQ3%20plan%20%28draft%29%232.md&theme=parker-night"
        );
        assert!(note_url("note-1", "a.md", "light", true, false).ends_with("&theme=light&top=1"));
        assert!(note_url("note-1", "a.md", "light", false, true).ends_with("&theme=light&preview=1"));
        assert_eq!(urlencode("é"), "%C3%A9");
        assert_eq!(urlencode("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn session_entry_round_trips_and_omits_defaults() {
        let e = NoteWindowSession {
            name: "a.md".into(),
            x: Some(10.0),
            y: Some(20.0),
            w: Some(600.0),
            h: Some(700.0),
            on_top: false,
            preview: false,
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(!json.contains("on_top"), "false pin is not written: {json}");
        assert!(!json.contains("preview"), "editor mode is not written: {json}");
        let back: NoteWindowSession = serde_json::from_str(&json).unwrap();
        assert_eq!(back, e);
        // A hand-written entry with only a name is complete.
        let bare: NoteWindowSession = serde_json::from_str(r#"{"name":"b.md"}"#).unwrap();
        assert_eq!(bare.name, "b.md");
        assert_eq!(bare.w, None);
        assert!(!bare.on_top);
    }

    // ---- Registry ---------------------------------------------------------

    #[test]
    fn labels_count_up_and_are_never_reused() {
        let mut r = Registry::default();
        assert_eq!(r.new_label(), "note-1");
        assert_eq!(r.new_label(), "note-2");
        r.show("note-1", nw("a.md"));
        r.park("note-1");
        r.destroyed("note-1");
        assert_eq!(r.new_label(), "note-3");
    }

    #[test]
    fn a_note_is_found_in_its_note_window_before_the_main_list() {
        let mut r = Registry::default();
        r.main_saved(&["a.md".into(), "b.md".into()]);
        assert_eq!(r.locate("a.md"), Some("main".into()));
        assert_eq!(r.locate("zzz.md"), None);
        // The main list lags a save behind; the note window is the truth.
        r.show("note-1", nw("a.md"));
        assert_eq!(r.locate("a.md"), Some("note-1".into()));
        assert_eq!(r.label_of("a.md"), Some("note-1".into()));
        assert_eq!(r.label_of("b.md"), None);
    }

    #[test]
    fn parking_takes_a_window_out_of_service_and_keeps_it() {
        let mut r = Registry::default();
        r.show("note-1", nw("a.md"));
        r.focused("note-1");
        assert!(r.park("note-1"));
        assert!(r.is_parked("note-1"));
        assert_eq!(r.locate("a.md"), None, "a parked window holds no note");
        assert_eq!(r.focus_label(), "main", "a summon never lands on a parked window");
        assert!(r.live().is_empty());
        // Parking twice, or parking main, changes nothing.
        assert!(!r.park("note-1"));
        assert!(!r.park("main"));
        assert_eq!(r.take_parked(), Some("note-1".into()));
        assert_eq!(r.take_parked(), None);
    }

    #[test]
    fn a_reused_window_leaves_the_pool() {
        let mut r = Registry::default();
        r.show("note-1", nw("a.md"));
        r.park("note-1");
        let label = r.take_parked().unwrap();
        r.show(&label, nw("b.md"));
        assert!(!r.is_parked("note-1"));
        assert_eq!(r.locate("b.md"), Some("note-1".into()));
        assert_eq!(r.locate("a.md"), None);
    }

    #[test]
    fn a_destroyed_window_is_neither_live_nor_parked() {
        let mut r = Registry::default();
        r.show("note-1", nw("a.md"));
        r.park("note-1");
        r.destroyed("note-1");
        assert!(!r.is_parked("note-1"));
        assert_eq!(r.take_parked(), None);
        assert!(r.live().is_empty());
    }

    #[test]
    fn a_rename_follows_the_note_everywhere() {
        let mut r = Registry::default();
        r.show("note-1", nw("a.md"));
        r.main_saved(&["a.md".into(), "c.md".into()]);
        assert!(r.renamed("a.md", "b.md"));
        assert_eq!(r.locate("b.md"), Some("note-1".into()));
        assert_eq!(r.locate("a.md"), None);
        r.park("note-1");
        // Only the main list has c.md: no note window followed.
        assert!(!r.renamed("c.md", "d.md"));
        assert_eq!(r.locate("d.md"), Some("main".into()));
    }

    #[test]
    fn retarget_and_pin_change_what_the_session_will_say() {
        let mut r = Registry::default();
        r.show("note-1", nw("a.md"));
        r.retarget("note-1", "b.md", true);
        r.set_on_top("note-1", true);
        let live = r.live();
        assert_eq!(
            live,
            vec![(
                "note-1".to_string(),
                NoteWindow {
                    name: "b.md".into(),
                    on_top: true,
                    preview: true
                }
            )]
        );
        // Unknown labels are ignored, not created.
        r.retarget("note-9", "x.md", false);
        r.set_on_top("note-9", true);
        assert_eq!(r.live().len(), 1);
    }

    #[test]
    fn live_windows_come_out_in_label_order() {
        let mut r = Registry::default();
        r.show("note-2", nw("b.md"));
        r.show("note-1", nw("a.md"));
        r.show("note-3", nw("c.md"));
        r.park("note-2");
        assert_eq!(r.live_labels(), vec!["note-1", "note-3"]);
    }

    #[test]
    fn focus_falls_back_to_main() {
        let mut r = Registry::default();
        assert_eq!(r.focus_label(), "main");
        r.focused("note-1");
        assert_eq!(r.focus_label(), "note-1");
        r.focused("main");
        assert_eq!(r.focus_label(), "main");
        r.focused("note-1");
        r.destroyed("note-1");
        assert_eq!(r.focus_label(), "main");
    }

    // ---- Quit barrier -------------------------------------------------------

    #[test]
    fn the_barrier_counts_windows_down_to_zero_and_no_further() {
        let mut q = QuitBarrier::default();
        assert!(!q.armed());
        q.arm(2);
        assert!(q.armed());
        assert_eq!(q.flushed(), 1);
        assert_eq!(q.flushed(), 0);
        // A late or doubled answer never wraps around.
        assert_eq!(q.flushed(), 0);
    }

    // ---- Geometry ---------------------------------------------------------

    #[test]
    fn a_dropped_tab_gets_a_window_under_the_pointer_but_on_screen() {
        assert_eq!(dropped_at(500.0, 300.0), (500.0 - DROP_DX, 300.0 - DROP_DY));
        assert_eq!(dropped_at(10.0, 10.0), (0.0, 0.0));
    }

    #[test]
    fn a_frame_knows_what_is_inside_it() {
        let f = Frame {
            x: 100.0,
            y: 50.0,
            w: 600.0,
            h: 400.0,
        };
        assert!(f.contains(100.0, 50.0));
        assert!(f.contains(700.0, 450.0));
        assert!(f.contains(300.0, 200.0));
        assert!(!f.contains(99.0, 200.0));
        assert!(!f.contains(300.0, 451.0));
    }

    #[test]
    fn a_saved_frame_is_used_only_when_it_could_be_a_window() {
        let mut e = NoteWindowSession::bare("a.md", false);
        assert_eq!(frame_for(&e, Some((1.0, 2.0))), ((NOTE_W, NOTE_H), Some((1.0, 2.0))));
        e.w = Some(50.0);
        e.h = Some(50.0);
        e.x = Some(10.0);
        e.y = Some(20.0);
        assert_eq!(frame_for(&e, None), ((NOTE_W, NOTE_H), Some((10.0, 20.0))));
        e.w = Some(800.0);
        e.h = Some(600.0);
        assert_eq!(frame_for(&e, None), ((800.0, 600.0), Some((10.0, 20.0))));
    }
}
