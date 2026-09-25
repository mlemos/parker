// The AI Agents section of Settings: put the Parker skill where an agent will
// find it. The skill ships inside the app, compiled in from the same
// skills/parker/SKILL.md the repository publishes, so the app, the site and the
// file an agent reads are one text.
//
// Claude Code reads skills from ~/.claude/skills/<name>/SKILL.md, so that one
// Parker can install and check. The Claude app (desktop, Cowork, claude.ai)
// keeps skills in the account: Parker saves a .zip for the user to upload
// there. Everything here is local file work — no network.
use std::fs;
use std::path::{Path, PathBuf};

/// The skill, as this build of Parker ships it.
pub const SKILL: &str = include_str!("../../skills/parker/SKILL.md");

/// Where Claude Code looks for the Parker skill.
fn claude_code_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("skills")
        .join("parker")
}

#[derive(serde::Serialize)]
pub struct AgentsInfo {
    /// "missing", "current" (the skill this build ships) or "different".
    claude_code: &'static str,
    /// The folder, with the home directory as ~, for display.
    claude_code_dir: String,
    /// The notes folder has a README.md at its root.
    readme: bool,
}

/// What an installed skill file says about the one this build ships.
pub fn status_of(installed: Option<&str>) -> &'static str {
    match installed {
        None => "missing",
        Some(s) if s == SKILL => "current",
        Some(_) => "different",
    }
}

/// The starter README the skill offers, cut out of the skill itself: the
/// ```markdown block under "## Starter README".
pub fn starter_readme(skill: &str) -> Option<&str> {
    let section = &skill[skill.find("## Starter README")?..];
    let open = "```markdown\n";
    let start = section.find(open)? + open.len();
    let end = section[start..].find("\n```")?;
    Some(&section[start..start + end + 1])
}

/// Whether a file name is a README of any spelling: README.md, readme.txt,
/// Readme, README.markdown…
pub fn is_readme(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "readme" || lower.starts_with("readme.")
}

/// The notes folder already has a README of some kind at its root.
fn has_readme(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .any(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false) && is_readme(&e.file_name().to_string_lossy()))
        })
        .unwrap_or(false)
}

fn tilde(p: &Path) -> String {
    let home = dirs::home_dir().unwrap_or_default();
    match p.strip_prefix(&home) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => p.display().to_string(),
    }
}

/// The skill's status in a Claude Code skill folder.
fn status_in(dir: &Path) -> &'static str {
    status_of(fs::read_to_string(dir.join("SKILL.md")).ok().as_deref())
}

#[tauri::command]
pub fn agents_info() -> AgentsInfo {
    let dir = claude_code_dir();
    AgentsInfo {
        claude_code: status_in(&dir),
        claude_code_dir: tilde(&dir),
        readme: has_readme(&crate::notes_dir()),
    }
}

/// Write the skill where Claude Code reads it. A different SKILL.md already
/// there — an older Parker's, or one the user edited — is kept beside it as
/// SKILL.md.previous rather than lost.
#[tauri::command]
pub fn install_claude_code_skill() -> Result<(), String> {
    install_into(&claude_code_dir())
}

fn install_into(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Couldn't create {}: {e}", tilde(dir)))?;
    let file = dir.join("SKILL.md");
    if let Ok(old) = fs::read_to_string(&file) {
        if old == SKILL {
            return Ok(());
        }
        fs::write(dir.join("SKILL.md.previous"), old).map_err(|e| e.to_string())?;
    }
    fs::write(&file, SKILL).map_err(|e| format!("Couldn't write {}: {e}", tilde(&file)))
}

#[tauri::command]
pub fn reveal_claude_code_skill() -> Result<(), String> {
    let file = claude_code_dir().join("SKILL.md");
    if !file.is_file() {
        return Err("The skill isn't installed.".into());
    }
    std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&file)
        .status()
        .map_err(|e| e.to_string())
        .map(|_| ())
}

/// Ask where to save, then write parker-skill.zip: a `parker/` folder holding
/// SKILL.md, the layout the Claude app expects. Resolves false on cancel.
#[tauri::command]
pub async fn save_skill_zip(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        let Some(dest) = app
            .dialog()
            .file()
            .set_file_name("parker-skill.zip")
            .add_filter("Zip archive", &["zip"])
            .blocking_save_file()
            .and_then(|p| p.into_path().ok())
        else {
            return Ok(false);
        };
        write_skill_zip(&dest)?;
        Ok(true)
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(false)
    }
}

/// Write `dest` as a zip holding parker/SKILL.md.
fn write_skill_zip(dest: &Path) -> Result<(), String> {
    let tmp = std::env::temp_dir().join(format!(
        "parker-skill-{}-{}",
        std::process::id(),
        dest.file_name().and_then(|n| n.to_str()).unwrap_or("zip")
    ));
    let folder = tmp.join("parker");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    fs::write(folder.join("SKILL.md"), SKILL).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(dest);
    // ditto ships with macOS and writes the zip Finder would.
    let ok = std::process::Command::new("/usr/bin/ditto")
        .args(["-c", "-k", "--keepParent"])
        .arg(&folder)
        .arg(dest)
        .status()
        .map_err(|e| e.to_string())?
        .success();
    let _ = fs::remove_dir_all(&tmp);
    if ok {
        Ok(())
    } else {
        Err("Couldn't write the zip.".into())
    }
}

/// Create the skill's starter README at the root of the notes folder. Never
/// touches a README that is there, whatever its spelling, and the write
/// itself refuses to replace a file (create_new), so one that appears between
/// the check and the write is safe too.
#[tauri::command]
pub fn create_starter_readme() -> Result<(), String> {
    create_starter_readme_in(&crate::notes_dir())
}

fn create_starter_readme_in(dir: &Path) -> Result<(), String> {
    use std::io::Write;
    if has_readme(dir) {
        return Err("Your notes folder already has a README.".into());
    }
    let text = starter_readme(SKILL).ok_or("The skill has no starter README.")?;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join("README.md"))
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => "Your notes folder already has a README.".to_string(),
            _ => e.to_string(),
        })?;
    f.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_compares_with_the_shipped_skill() {
        assert_eq!(status_of(None), "missing");
        assert_eq!(status_of(Some(SKILL)), "current");
        assert_eq!(status_of(Some("an older skill")), "different");
    }

    #[test]
    fn the_starter_readme_comes_out_of_the_skill() {
        let r = starter_readme(SKILL).expect("the skill carries a starter README");
        assert!(r.starts_with("# "), "starts with a title: {r:?}");
        assert!(r.contains("## For agents"));
        assert!(!r.contains("```"), "no fence left over");
        assert!(r.ends_with('\n'));
    }

    #[test]
    fn any_spelling_of_readme_counts() {
        for n in ["README.md", "readme.md", "Readme.txt", "README", "readme.markdown"] {
            assert!(is_readme(n), "{n}");
        }
        for n in ["readmes.md", "my-readme.md", "notes.md", "README-old"] {
            assert!(!is_readme(n), "{n}");
        }
    }

    #[test]
    fn a_readme_in_the_folder_is_found_and_never_replaced() {
        let dir = std::env::temp_dir().join(format!("parker-readme-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(!has_readme(&dir));
        fs::write(dir.join("Readme.txt"), "mine").unwrap();
        assert!(has_readme(&dir));
        // create_new refuses an existing file even without the check.
        fs::write(dir.join("README.md"), "mine too").unwrap();
        let r = fs::OpenOptions::new().write(true).create_new(true).open(dir.join("README.md"));
        assert_eq!(r.unwrap_err().kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(dir.join("README.md")).unwrap(), "mine too");
        let _ = fs::remove_dir_all(&dir);
    }

    /// A fresh, empty folder under the system temp dir, removed on drop.
    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!("parker-agents-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn install_creates_the_folder_and_reports_current() {
        let t = Tmp::new("install");
        let dir = t.0.join("skills").join("parker");
        assert_eq!(status_in(&dir), "missing");
        install_into(&dir).unwrap();
        assert_eq!(fs::read_to_string(dir.join("SKILL.md")).unwrap(), SKILL);
        assert_eq!(status_in(&dir), "current");
        assert!(!dir.join("SKILL.md.previous").exists(), "nothing to keep on a first install");
    }

    #[test]
    fn install_over_a_different_skill_keeps_it_as_previous() {
        let t = Tmp::new("update");
        fs::write(t.0.join("SKILL.md"), "my own edits").unwrap();
        assert_eq!(status_in(&t.0), "different");
        install_into(&t.0).unwrap();
        assert_eq!(status_in(&t.0), "current");
        assert_eq!(fs::read_to_string(t.0.join("SKILL.md.previous")).unwrap(), "my own edits");
    }

    #[test]
    fn installing_the_same_skill_twice_touches_nothing() {
        let t = Tmp::new("again");
        install_into(&t.0).unwrap();
        install_into(&t.0).unwrap();
        assert!(!t.0.join("SKILL.md.previous").exists(), "the current skill is not a previous one");
    }

    #[test]
    fn the_starter_readme_is_created_once() {
        let t = Tmp::new("readme");
        create_starter_readme_in(&t.0).unwrap();
        let text = fs::read_to_string(t.0.join("README.md")).unwrap();
        assert_eq!(text, starter_readme(SKILL).unwrap());
        let again = create_starter_readme_in(&t.0).unwrap_err();
        assert!(again.contains("already has a README"), "{again}");
        assert_eq!(fs::read_to_string(t.0.join("README.md")).unwrap(), text, "untouched");
    }

    #[test]
    fn a_readme_of_another_spelling_blocks_the_starter() {
        let t = Tmp::new("otherreadme");
        fs::write(t.0.join("readme.txt"), "mine").unwrap();
        assert!(create_starter_readme_in(&t.0).is_err());
        assert!(!t.0.join("README.md").exists());
    }

    /// The zip the Claude app uploads: a `parker/` folder at the root holding
    /// the skill. Needs macOS's ditto and unzip, so it runs on the Mac only.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_zip_holds_parker_skill_md() {
        let t = Tmp::new("zip");
        let zip = t.0.join("parker-skill.zip");
        write_skill_zip(&zip).unwrap();
        let out = std::process::Command::new("/usr/bin/unzip").arg("-Z1").arg(&zip).output().unwrap();
        let names = String::from_utf8_lossy(&out.stdout);
        assert!(names.lines().any(|l| l == "parker/SKILL.md"), "{names}");
        assert!(names.lines().all(|l| l.starts_with("parker/")), "one folder at the root: {names}");
        let body = std::process::Command::new("/usr/bin/unzip").arg("-p").arg(&zip).arg("parker/SKILL.md").output().unwrap();
        assert_eq!(String::from_utf8_lossy(&body.stdout), SKILL);
    }

    /// The Claude app refuses an upload whose description runs past 200
    /// characters or whose folder isn't named after the skill.
    #[test]
    fn the_skill_passes_the_claude_app_limits() {
        let front = SKILL.strip_prefix("---\n").and_then(|r| r.split_once("\n---\n")).map(|(f, _)| f).expect("frontmatter");
        let field = |k: &str| front.lines().find_map(|l| l.strip_prefix(&format!("{k}: "))).unwrap_or_else(|| panic!("no {k}"));
        assert_eq!(field("name"), "parker", "the zip's folder is parker/");
        let d = field("description");
        assert!(d.chars().count() <= 200, "description is {} characters", d.chars().count());
        assert!(field("name").len() <= 64);
    }

    #[test]
    fn a_skill_without_the_section_has_no_starter() {
        assert_eq!(starter_readme("# Just a title\n"), None);
    }
}
