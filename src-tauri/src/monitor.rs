// Performance monitor — real memory/CPU numbers for Parker and the WebKit
// helper processes that render its webviews.
//
// Why not just measure our own process? On macOS the WKWebView content runs in
// separate system processes (com.apple.WebKit.WebContent / GPU / Networking)
// whose *parent* is launchd, not the app. Activity Monitor attributes them to
// the app via the "responsible process" mechanism — we do the same, through
// `responsibility_get_pid_responsible_for_pid`. Memory is reported as
// `ri_phys_footprint` from `proc_pid_rusage`, the exact figure Activity
// Monitor's "Memory" column shows.
//
// Two consumers:
// - The `perf_stats` command feeds the in-app debug overlay (⌘⇧D).
// - A background thread appends one JSONL sample per minute to
//   <config dir>/perf.jsonl (rotated at ~2 MB) so slow leaks show up in data
//   even when nobody is watching the overlay.

use serde::Serialize;
use std::io::Write;

#[cfg(target_os = "macos")]
mod sys {
    use std::os::raw::{c_char, c_int, c_void};

    // Subset of `struct rusage_info_v2` (sys/resource.h). V2 is enough: it
    // carries phys_footprint and disk I/O. Field order must match the header.
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct RusageInfoV2 {
        pub ri_uuid: [u8; 16],
        pub ri_user_time: u64,
        pub ri_system_time: u64,
        pub ri_pkg_idle_wkups: u64,
        pub ri_interrupt_wkups: u64,
        pub ri_pageins: u64,
        pub ri_wired_size: u64,
        pub ri_resident_size: u64,
        pub ri_phys_footprint: u64,
        pub ri_proc_start_abstime: u64,
        pub ri_proc_exit_abstime: u64,
        pub ri_child_user_time: u64,
        pub ri_child_system_time: u64,
        pub ri_child_pkg_idle_wkups: u64,
        pub ri_child_interrupt_wkups: u64,
        pub ri_child_pageins: u64,
        pub ri_child_elapsed_abstime: u64,
        pub ri_diskio_bytesread: u64,
        pub ri_diskio_byteswritten: u64,
    }

    const RUSAGE_INFO_V2: c_int = 2;
    const PROC_PIDPATHINFO_MAXSIZE: usize = 4096;

    #[repr(C)]
    struct MachTimebaseInfo {
        numer: u32,
        denom: u32,
    }

    extern "C" {
        fn proc_listallpids(buffer: *mut c_void, buffersize: c_int) -> c_int;
        fn proc_pidpath(pid: c_int, buffer: *mut c_char, buffersize: u32) -> c_int;
        fn proc_pid_rusage(pid: c_int, flavor: c_int, buffer: *mut c_void) -> c_int;
        // Same attribution Activity Monitor uses to nest WebKit helpers under
        // the app that owns them. Exported by libsystem; used by many tools.
        fn responsibility_get_pid_responsible_for_pid(pid: c_int) -> c_int;
        fn mach_timebase_info(info: *mut MachTimebaseInfo) -> c_int;
    }

    pub fn rusage(pid: i32) -> Option<RusageInfoV2> {
        let mut info = RusageInfoV2::default();
        let rc = unsafe {
            proc_pid_rusage(pid, RUSAGE_INFO_V2, &mut info as *mut _ as *mut c_void)
        };
        (rc == 0).then_some(info)
    }

    pub fn all_pids() -> Vec<i32> {
        unsafe {
            let n = proc_listallpids(std::ptr::null_mut(), 0);
            if n <= 0 {
                return Vec::new();
            }
            let mut pids = vec![0 as c_int; n as usize + 64];
            let bytes = (pids.len() * std::mem::size_of::<c_int>()) as c_int;
            let filled = proc_listallpids(pids.as_mut_ptr() as *mut c_void, bytes);
            if filled <= 0 {
                return Vec::new();
            }
            pids.truncate(filled as usize);
            pids.into_iter().filter(|&p| p > 0).collect()
        }
    }

    pub fn pid_path(pid: i32) -> Option<String> {
        let mut buf = vec![0u8; PROC_PIDPATHINFO_MAXSIZE];
        let rc = unsafe {
            proc_pidpath(pid, buf.as_mut_ptr() as *mut c_char, buf.len() as u32)
        };
        if rc <= 0 {
            return None;
        }
        buf.truncate(rc as usize);
        String::from_utf8(buf).ok()
    }

    pub fn responsible_pid(pid: i32) -> i32 {
        unsafe { responsibility_get_pid_responsible_for_pid(pid) }
    }

    /// Convert mach_absolute_time units to milliseconds.
    pub fn mach_to_ms(t: u64) -> u64 {
        let mut tb = MachTimebaseInfo { numer: 0, denom: 0 };
        unsafe { mach_timebase_info(&mut tb) };
        if tb.denom == 0 {
            return 0;
        }
        ((t as u128 * tb.numer as u128) / (tb.denom as u128 * 1_000_000)) as u64
    }
}

#[derive(Serialize, Clone)]
pub struct ProcStats {
    pub pid: i32,
    pub kind: String, // "app" | "WebContent" | "GPU" | "Networking"
    /// Bytes — same figure as Activity Monitor's Memory column.
    pub footprint: u64,
    pub resident: u64,
    /// Cumulative CPU (user+system) in milliseconds.
    pub cpu_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct PerfStats {
    pub app: ProcStats,
    pub helpers: Vec<ProcStats>,
    pub total_footprint: u64,
    /// Milliseconds since UNIX epoch, stamped by the backend.
    pub ts: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn collect() -> Option<PerfStats> {
    let me = std::process::id() as i32;
    // WebKit helpers are attributed to the *responsible* app. For the packaged
    // app that's Parker itself; under `tauri dev` responsibility rolls up to
    // whatever launched the dev process (terminal, IDE), so compare against
    // our own responsible pid rather than our pid.
    let owner = match sys::responsible_pid(me) {
        p if p > 0 => p,
        _ => me,
    };
    let mine = sys::rusage(me)?;
    let app = ProcStats {
        pid: me,
        kind: "app".into(),
        footprint: mine.ri_phys_footprint,
        resident: mine.ri_resident_size,
        cpu_ms: sys::mach_to_ms(mine.ri_user_time + mine.ri_system_time),
    };

    let mut helpers = Vec::new();
    for pid in sys::all_pids() {
        if pid == me {
            continue;
        }
        // Cheap filter first: only WebKit XPC helpers are interesting.
        let Some(path) = sys::pid_path(pid) else { continue };
        let kind = if path.contains("com.apple.WebKit.WebContent") {
            "WebContent"
        } else if path.contains("com.apple.WebKit.GPU") {
            "GPU"
        } else if path.contains("com.apple.WebKit.Networking") {
            "Networking"
        } else {
            continue;
        };
        if sys::responsible_pid(pid) != owner {
            continue; // some other app's webview
        }
        if let Some(r) = sys::rusage(pid) {
            helpers.push(ProcStats {
                pid,
                kind: kind.into(),
                footprint: r.ri_phys_footprint,
                resident: r.ri_resident_size,
                cpu_ms: sys::mach_to_ms(r.ri_user_time + r.ri_system_time),
            });
        }
    }

    let total_footprint =
        app.footprint + helpers.iter().map(|h| h.footprint).sum::<u64>();
    Some(PerfStats {
        app,
        helpers,
        total_footprint,
        ts: now_ms(),
    })
}

#[cfg(not(target_os = "macos"))]
fn collect() -> Option<PerfStats> {
    None
}

#[tauri::command]
pub fn perf_stats() -> Result<PerfStats, String> {
    collect().ok_or_else(|| "perf stats unavailable".to_string())
}

// ---- Background sampler -----------------------------------------------------

const LOG_NAME: &str = "perf.jsonl";
const LOG_MAX_BYTES: u64 = 2_000_000; // ~2 MB ≈ several weeks at 1 sample/min
const SAMPLE_EVERY: std::time::Duration = std::time::Duration::from_secs(60);

fn log_path() -> std::path::PathBuf {
    crate::config_dir().join(LOG_NAME)
}

#[tauri::command]
pub fn perf_log_path() -> String {
    log_path().to_string_lossy().into_owned()
}

/// Append one sample; rotate to `.1` when the file gets big. Best-effort —
/// monitoring must never take the app down.
fn append_sample(stats: &PerfStats) {
    let path = log_path();
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_MAX_BYTES {
            let _ = std::fs::rename(&path, path.with_extension("jsonl.1"));
        }
    }
    let Ok(line) = serde_json::to_string(stats) else { return };
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{line}");
    }
}

/// Start the once-per-minute sampler. Called from setup(); the thread runs for
/// the app's lifetime (it dies with the process — nothing to join).
pub fn start_sampler() {
    std::thread::Builder::new()
        .name("perf-sampler".into())
        .spawn(|| loop {
            if let Some(stats) = collect() {
                append_sample(&stats);
            }
            std::thread::sleep(SAMPLE_EVERY);
        })
        .ok();
}
