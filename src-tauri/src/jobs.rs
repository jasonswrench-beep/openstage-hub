// SPDX-License-Identifier: Apache-2.0
//! Install and update use the same six steps (the spec's "Installing, updating and opening"):
//! 1. download the installer named in the catalog into the hub's own download folder (GitHub addresses only);
//! 2. check its SHA-256 against the catalog; a mismatch deletes the file and stops. From here until step 5 has started it, the file is held
//!    open, so nothing can change or replace it after the check;
//! 3. check its code signature with Windows' own check: valid, timestamped, and the brand's own certificate; anything else deletes it and stops;
//! 4. if the app is running, ask the person to close it and wait (the hub never closes an app itself: that could lose unsaved work);
//! 5. run the installer with its quiet switch (it shows its own progress bar, not its pages; installs are per user, so no administrator);
//! 6. read the installed version back from Windows' installed apps list and confirm it, then delete the download.

use crate::catalog::{App, Release};
use crate::hub::Hub;
use crate::state::{self, Record};
use crate::system;
use crate::trust;
use serde::Serialize;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    /// The app's id, or "hub" for the hub's own update.
    pub id: String,
    /// downloading, checking, waiting, installing, removing, done, failed or cancelled.
    pub stage: String,
    pub received: u64,
    pub total: u64,
    /// One plain sentence: what is happening, or what failed.
    pub message: String,
}

pub type Report<'a> = &'a dyn Fn(JobEvent);

fn event(id: &str, stage: &str, message: impl Into<String>) -> JobEvent {
    JobEvent { id: id.into(), stage: stage.into(), received: 0, total: 0, message: message.into() }
}

/// A file name for the download that cannot step out of the download folder.
fn download_path(id: &str, version: &str, ext: &str) -> PathBuf {
    let clean = |s: &str| s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect::<String>();
    state::downloads_dir().join(format!("{}-{}-setup.{ext}", clean(id), clean(version)))
}

/// An installer that passed its checks, held open so it stays the file that was checked.
pub struct Checked {
    pub path: PathBuf,
    held: File,
}

/// Steps 1 to 3: the installer downloaded and checked, or why not. A file that fails a check is deleted.
pub fn fetch_and_check(id: &str, release: &Release, cancel: &AtomicBool, report: Report) -> Result<Checked, String> {
    std::fs::create_dir_all(state::downloads_dir()).map_err(|_| "The hub's download folder could not be made.".to_string())?;
    let file = download_path(id, &release.version, "exe");
    let mut last = Instant::now() - Duration::from_secs(1);
    let mut progress = |received: u64, _total: u64| {
        if last.elapsed() >= Duration::from_millis(200) || received == release.size {
            last = Instant::now();
            report(JobEvent { id: id.into(), stage: "downloading".into(), received, total: release.size, message: "Downloading".into() });
        }
    };
    report(JobEvent { id: id.into(), stage: "downloading".into(), received: 0, total: release.size, message: "Downloading".into() });
    crate::net::download(&release.url, &file, release.size, cancel, &mut progress).map_err(|e| e.words("installer"))?;

    report(event(id, "checking", "Checking"));
    match check_held(&file, &release.sha256, cancel) {
        Ok(held) => Ok(Checked { path: file, held }),
        Err(why) => {
            let _ = std::fs::remove_file(&file);
            Err(why)
        }
    }
}

/// Steps 2 and 3 on a downloaded file, which is held open from before its checksum is computed.
fn check_held(file: &Path, sha256: &str, cancel: &AtomicBool) -> Result<File, String> {
    let unreadable = |_| "The download could not be read back to check it, so nothing was installed.".to_string();
    let mut held = trust::hold(file).map_err(unreadable)?;
    if !trust::sha256_of(&mut held).map_err(unreadable)?.eq_ignore_ascii_case(sha256) {
        return Err("The download did not match its checksum, so nothing was installed.".into());
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Cancelled. Nothing was installed.".into());
    }
    trust::check_installer(file).map_err(|why| format!("{why} Nothing was installed."))?;
    Ok(held)
}

/// Step 4: waits while the app is open. Returns false when the person cancelled.
fn wait_until_closed(app: &App, folder: Option<&Path>, cancel: &AtomicBool, report: Report) -> bool {
    let Some(folder) = folder else { return true };
    let mut said = false;
    while system::is_running(folder, &app.program_file) {
        if !said {
            report(event(&app.id, "waiting", format!("Close {} to continue. The hub waits; it never closes an app itself.", app.name)));
            said = true;
        }
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(800));
    }
    true
}

/// Starts a held program, then lets it go: once it has started, Windows itself keeps the running file from being changed.
fn start_held(program: &Path, args: &[String], held: File) -> Result<std::process::Child, String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    if let Some(folder) = program.parent() {
        command.current_dir(folder);
    }
    let started = command.spawn();
    drop(held);
    match started {
        Ok(child) => Ok(child),
        // ERROR_ELEVATION_REQUIRED
        Err(e) if e.raw_os_error() == Some(740) => {
            Err(format!("The installer asked for administrator rights. {} apps install for one person and never need them, so it was not run.", crate::brand::brand().short_name))
        }
        Err(_) => Err("Windows could not start the installer.".into()),
    }
}

/// Runs a held program and waits for it. Its exit code, or why it could not start.
fn run_and_wait(program: &Path, args: &[String], held: File) -> Result<i32, String> {
    let mut child = start_held(program, args, held)?;
    Ok(child.wait().ok().and_then(|s| s.code()).unwrap_or(-1))
}

/// The whole install or update of an app.
pub fn install(hub: &Hub, app: &App, release: &Release, cancel: &AtomicBool, report: Report) -> Result<(), String> {
    let Checked { path: file, held } = fetch_and_check(&app.id, release, cancel, report)?;
    let result = (|| {
        let before = system::installed_apps();
        let folder = system::find_installed(&before, &app.installed_as).and_then(|e| e.folder());
        if !wait_until_closed(app, folder.as_deref(), cancel, report) {
            return Err("Cancelled. Nothing was installed.".to_string());
        }
        report(event(&app.id, "installing", "Installing"));
        let code = run_and_wait(&file, &app.quiet_switch, held)?;
        if code != 0 {
            return Err(format!("The installer stopped with an error (code {code}), so {} may not have been installed.", app.name));
        }
        let after = system::installed_apps();
        let listed = system::find_installed(&after, &app.installed_as).map(|e| e.display_version.trim().to_string());
        match listed {
            Some(v) if v == release.windows_version.trim() => {
                let mut saved = hub.saved.lock().unwrap();
                saved.installed.insert(app.id.clone(), Record { version: release.version.clone(), windows_version: v });
                let _ = saved.save();
                Ok(())
            }
            Some(v) => Err(format!("The installer finished, but Windows lists {} as version {v}, not {}.", app.name, release.windows_version)),
            None => Err(format!("The installer finished, but Windows does not list {} as installed.", app.name)),
        }
    })();
    let _ = std::fs::remove_file(&file);
    result
}

/// Other downloads (a portable copy or an add-on): downloaded, its SHA-256 checked, and put in the person's Downloads folder, shown in File
/// Explorer. Nothing is run.
pub fn download_extra(app: &App, index: usize, cancel: &AtomicBool, report: Report) -> Result<PathBuf, String> {
    let extra = app.extras.get(index).ok_or("That download is not in the catalog.")?;
    std::fs::create_dir_all(state::downloads_dir()).map_err(|_| "The hub's download folder could not be made.".to_string())?;
    let file = download_path(&app.id, &format!("extra-{index}"), "part");
    report(JobEvent { id: app.id.clone(), stage: "downloading".into(), received: 0, total: extra.size, message: "Downloading".into() });
    let mut progress = |received: u64, _| {
        report(JobEvent { id: app.id.clone(), stage: "downloading".into(), received, total: extra.size, message: "Downloading".into() })
    };
    crate::net::download(&extra.url, &file, extra.size, cancel, &mut progress).map_err(|e| e.words("download"))?;
    report(event(&app.id, "checking", "Checking"));
    if !trust::sha256_file(&file).is_ok_and(|s| s.eq_ignore_ascii_case(&extra.sha256)) {
        let _ = std::fs::remove_file(&file);
        return Err("The download did not match its checksum, so it was deleted.".into());
    }
    let downloads = std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Downloads")).ok_or("Your Downloads folder could not be found.")?;
    let mut target = downloads.join(&extra.file_name);
    let mut n = 1;
    while target.exists() {
        let stem = Path::new(&extra.file_name).file_stem().unwrap_or_default().to_string_lossy().to_string();
        let ext = Path::new(&extra.file_name).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        target = downloads.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    if std::fs::rename(&file, &target).is_err() {
        std::fs::copy(&file, &target).map_err(|_| "The download could not be put in your Downloads folder.".to_string())?;
        let _ = std::fs::remove_file(&file);
    }
    let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", target.display())).spawn();
    Ok(target)
}

/// Runs the app's own uninstaller (the one Windows lists) without its questions, and waits until Windows no longer lists the app.
pub fn uninstall(hub: &Hub, app: &App, cancel: &AtomicBool, report: Report) -> Result<(), String> {
    let list = system::installed_apps();
    let entry = system::find_installed(&list, &app.installed_as).ok_or(format!("Windows does not list {} as installed.", app.name))?;
    if !wait_until_closed(app, entry.folder().as_deref(), cancel, report) {
        return Err("Cancelled. Nothing was removed.".into());
    }
    let (program, args) = if !entry.quiet_uninstall_string.trim().is_empty() {
        system::split_command(&entry.quiet_uninstall_string).ok_or("The uninstaller Windows lists could not be read.")?
    } else {
        let (p, mut a) = system::split_command(&entry.uninstall_string).ok_or("The uninstaller Windows lists could not be read.")?;
        a.extend(app.quiet_uninstall_switch.iter().cloned());
        (p, a)
    };
    if !program.is_file() {
        return Err("The uninstaller Windows lists is not there any more.".into());
    }
    let held = match trusted_uninstaller(&program) {
        Ok(held) => held,
        Err(why) => {
            // Windows' own list can be changed by any program the person runs, so a program it names is not simply run. The person can still
            // remove the app from its folder or from Windows' Settings.
            let opened = entry.folder().filter(|f| f.is_dir()).is_some_and(|f| system::shell_open(&f.to_string_lossy()).is_ok());
            let next = if opened { " Its folder has been opened." } else { "" };
            return Err(format!("{why} It was not run, and nothing was removed. You can remove {} in Windows' Settings.{next}", app.name));
        }
    };
    report(event(&app.id, "removing", "Removing"));
    let code = run_and_wait(&program, &args, held)?;
    if code != 0 {
        return Err(format!("The uninstaller stopped with an error (code {code})."));
    }
    // Most uninstallers copy themselves elsewhere and carry on after the first one ends, so the hub watches Windows' list for up to two minutes.
    let until = Instant::now() + Duration::from_secs(120);
    while Instant::now() < until {
        if system::find_installed(&system::installed_apps(), &app.installed_as).is_none() {
            let mut saved = hub.saved.lock().unwrap();
            saved.installed.remove(&app.id);
            let _ = saved.save();
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(700));
    }
    Err(format!("The uninstaller finished, but Windows still lists {}.", app.name))
}

/// An app's uninstaller, held open once its signature has been checked, or why it is not trusted.
fn trusted_uninstaller(program: &Path) -> Result<File, String> {
    let held = trust::hold(program).map_err(|_| "The uninstaller Windows lists could not be read to check it.".to_string())?;
    trust::check_uninstaller(program)?;
    Ok(held)
}

/// The hub's own update: the same checks on its own installer, which is started directly (no command line is built from its path) and then runs
/// while this hub closes. /P shows its progress bar only, and /R starts the new hub when it is done.
pub fn update_hub(release: &Release, cancel: &AtomicBool, report: Report) -> Result<(), String> {
    let Checked { path, held } = fetch_and_check("hub", release, cancel, report)?;
    report(event("hub", "installing", "Installing"));
    start_held(&path, &hub_setup_switches(), held).map(|_| ()).map_err(|_| "Windows could not start the hub's installer.".to_string())
}

fn hub_setup_switches() -> [String; 2] {
    ["/P".into(), "/R".into()]
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("{name} {}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_file_changed_after_the_download_is_refused_and_one_that_is_checked_is_held() {
        let dir = folder("hub-check");
        let file = dir.join("setup.exe");
        std::fs::write(&file, b"MZ not a real setup").unwrap();
        let sum = trust::sha256_file(&file).unwrap();
        let cancel = AtomicBool::new(false);
        // Changed between the download and the check.
        std::fs::write(&file, b"MZ something else").unwrap();
        assert!(check_held(&file, &sum, &cancel).unwrap_err().contains("did not match its checksum"));
        // The right bytes, but not signed: refused all the same, and let go of.
        std::fs::write(&file, b"MZ not a real setup").unwrap();
        assert!(check_held(&file, &sum, &cancel).is_err());
        std::fs::remove_file(&file).expect("a refused file is let go, so it can be deleted");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unsigned_stand_in_uninstaller_is_refused_and_let_go() {
        let dir = folder("hub-uninstaller");
        let file = dir.join("uninstall.exe");
        std::fs::write(&file, b"MZ not a real uninstaller").unwrap();
        let why = trusted_uninstaller(&file).unwrap_err();
        assert!(why.contains("uninstaller"), "{why}");
        std::fs::remove_file(&file).expect("a refused file is let go");
        assert!(trusted_uninstaller(&file).is_err(), "one that is not there");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The setup is started by its path, with no command line built from it, so a profile folder with % or & or spaces in its name is only a
    /// name. A copy of a Windows program stands in for the setup.
    #[test]
    fn a_held_program_starts_from_any_folder_name_and_is_then_let_go() {
        for name in ["hub 100%PATH% & co", "hub %TEMP%^^"] {
            let dir = folder(name);
            let program = dir.join("stand in.exe");
            std::fs::copy(r"C:\Windows\System32\whoami.exe", &program).unwrap();
            let held = trust::hold(&program).unwrap();
            assert!(std::fs::write(&program, b"swapped").is_err(), "held until it has started");
            let code = run_and_wait(&program, &["/upn".into()], held);
            assert!(code.is_ok(), "{name}: {code:?}");
            std::fs::remove_dir_all(&dir).expect("let go once it has ended");
        }
        assert_eq!(hub_setup_switches(), ["/P", "/R"], "quiet, and start the hub again");
    }
}
