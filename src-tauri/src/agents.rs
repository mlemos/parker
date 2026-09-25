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

#[tauri::command]
pub fn agents_info() -> AgentsInfo {
    let dir = claude_code_dir();
    let installed = fs::read_to_string(dir.join("SKILL.md")).ok();
    AgentsInfo {
        claude_code: status_of(installed.as_deref()),
        claude_code_dir: tilde(&dir),
        readme: has_readme(&crate::notes_dir()),
    }
}

/// Write the skill where Claude Code reads it. A different SKILL.md already
/// there — an older Parker's, or one the user edited — is kept beside it as
/// SKILL.md.previous rather than lost.
#[tauri::command]
pub fn install_claude_code_skill() -> Result<(), String> {
    let dir = claude_code_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", tilde(&dir)))?;
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
        let tmp = std::env::temp_dir().join(format!("parker-skill-{}", std::process::id()));
        let folder = tmp.join("parker");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        fs::write(folder.join("SKILL.md"), SKILL).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&dest);
        // ditto ships with macOS and writes the zip Finder would.
        let ok = std::process::Command::new("/usr/bin/ditto")
            .args(["-c", "-k", "--keepParent"])
            .arg(&folder)
            .arg(&dest)
            .status()
            .map_err(|e| e.to_string())?
            .success();
        let _ = fs::remove_dir_all(&tmp);
        if !ok {
            return Err("Couldn't write the zip.".into());
        }
        Ok(true)
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(false)
    }
}

/// Create the skill's starter README at the root of the notes folder. Never
/// touches a README that is there, whatever its spelling, and the write
/// itself refuses to replace a file (create_new), so one that appears between
/// the check and the write is safe too.
#[tauri::command]
pub fn create_starter_readme() -> Result<(), String> {
    use std::io::Write;
    let dir = crate::notes_dir();
    if has_readme(&dir) {
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

    #[test]
    fn a_skill_without_the_section_has_no_starter() {
        assert_eq!(starter_readme("# Just a title\n"), None);
    }
}
