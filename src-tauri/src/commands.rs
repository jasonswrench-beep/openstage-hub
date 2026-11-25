// SPDX-License-Identifier: Apache-2.0
//! The commands the window uses. The window never reaches the network or the file system itself; everything goes through these, and each one
//! acts only on what the signed catalog names.

use crate::brand::brand;
use crate::hub::{Hub, View};
use crate::jobs::{self, JobEvent};
use crate::{system, tray};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

type HubState<'a> = State<'a, Arc<Hub>>;

/// Sends the newest view to the window (if it is open) and brings the tray up to date.
pub fn publish(app: &AppHandle) {
    let hub = app.state::<Arc<Hub>>().inner().clone();
    let view = hub.view();
    let _ = app.emit("view", &view);
    tray::refresh(app, &view);
}

#[tauri::command]
pub async fn get_view(hub: HubState<'_>) -> Result<View, String> {
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || hub.view()).await.map_err(|e| e.to_string())
}

/// Fetches the catalog (when the window opens, and on Check for updates) and gives the new view. New versions seen here are counted as
/// announced, so the tray does not notify about something the person has already seen.
#[tauri::command]
pub async fn refresh(app: AppHandle, hub: HubState<'_>) -> Result<View, String> {
    let hub = hub.inner().clone();
    let view = tauri::async_runtime::spawn_blocking(move || {
        hub.refresh();
        let view = hub.view();
        tray::mark_announced(&hub, &view);
        view
    })
    .await
    .map_err(|e| e.to_string())?;
    tray::refresh(&app, &view);
    Ok(view)
}

/// The work of one job: what it says when it is done, or why it failed.
type Work = Box<dyn FnOnce(&Hub, &AtomicBool, &dyn Fn(JobEvent)) -> Result<String, String> + Send>;

/// The id the hub's own update runs under.
const HUB: &str = "hub";

/// Whether a job may start while these run. The hub's own update closes the hub, so it starts only when nothing else is running (apart from the
/// batch it ends, when it is that batch that starts it), and nothing starts once it has.
fn may_start(running: &HashMap<String, Arc<AtomicBool>>, closing: bool, id: &str, from_batch: bool) -> Result<(), String> {
    if running.contains_key(id) {
        return Err("That is already under way.".into());
    }
    if closing || running.contains_key(HUB) {
        return Err("The hub is updating itself and will restart. Try again after that.".into());
    }
    if id == HUB && running.keys().any(|k| k != BATCH || !from_batch) {
        return Err("Something else is still being downloaded, installed or removed. Update the hub when it has finished.".into());
    }
    Ok(())
}

/// Marks `id` as having a job running and gives its Cancel flag, or says why it may not start. Looking and marking are one step.
fn claim_as(hub: &Hub, id: &str, from_batch: bool) -> Result<Arc<AtomicBool>, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    let mut running = hub.jobs.lock().unwrap();
    may_start(&running, hub.closing.load(Ordering::Relaxed), id, from_batch)?;
    running.insert(id.to_string(), cancel.clone());
    Ok(cancel)
}

fn claim(hub: &Hub, id: &str) -> Result<Arc<AtomicBool>, String> {
    claim_as(hub, id, false)
}

fn end_event(id: &str, stage: &str, message: String) -> JobEvent {
    JobEvent { id: id.into(), stage: stage.into(), received: 0, total: 0, message }
}

/// Runs a claimed job here and now: its progress goes to the window as "job" events, and the view is sent again when it ends. Whether it
/// worked is given back.
fn run_claimed(app: &AppHandle, hub: &Hub, id: &str, cancel: &AtomicBool, work: Work) -> bool {
    let report = |e: JobEvent| {
        let _ = app.emit("job", &e);
    };
    let outcome = work(hub, cancel, &report);
    hub.jobs.lock().unwrap().remove(id);
    let worked = outcome.is_ok();
    let end = match outcome {
        Ok(message) => end_event(id, "done", message),
        Err(_) if cancel.load(Ordering::Relaxed) => end_event(id, "cancelled", "Cancelled.".into()),
        Err(message) => end_event(id, "failed", message),
    };
    let _ = app.emit("job", &end);
    publish(app);
    worked
}

/// Runs a job on its own thread.
fn spawn_job(app: AppHandle, id: String, work: Work) -> Result<(), String> {
    let hub = app.state::<Arc<Hub>>().inner().clone();
    let cancel = claim(&hub, &id)?;
    std::thread::spawn(move || {
        run_claimed(&app, &hub, &id, &cancel, work);
    });
    Ok(())
}

fn blocked_by_catalog(hub: &Hub) -> Option<String> {
    let view_needs = hub.catalog.lock().unwrap().as_ref().is_some_and(|c| crate::catalog::needs_newer_hub(c, crate::brand::HUB_VERSION));
    view_needs.then(|| "This hub needs updating before it can install apps from the new catalog.".to_string())
}

/// The work of Install, Update and Reinstall: the six steps, with the release the hub offers now.
fn install_work(hub: &Hub, id: &str) -> Result<Work, String> {
    let entry = hub.app(id).ok_or("That app is not in the catalog.")?;
    if entry.minimum_hub_version.as_deref().is_some_and(|m| crate::version::newer(m, crate::brand::HUB_VERSION)) {
        return Err("This app needs a newer hub. Update the hub first.".into());
    }
    let release = hub.offer_for(&entry).ok_or("No release of this app can be installed from the hub on this computer.")?;
    Ok(Box::new(move |hub: &Hub, cancel: &AtomicBool, report: &dyn Fn(JobEvent)| {
        jobs::install(hub, &entry, &release, cancel, report)?;
        Ok(format!("{} {} is installed.", entry.name, crate::version::spoken(&release.version)))
    }))
}

/// Install, Update and Reinstall of one app.
#[tauri::command]
pub fn start_job(app: AppHandle, hub: HubState<'_>, id: String) -> Result<(), String> {
    if let Some(why) = blocked_by_catalog(&hub) {
        return Err(why);
    }
    not_queued(&hub, &id)?;
    let work = install_work(&hub, &id)?;
    spawn_job(app, id, work)
}

/// Refuses an app that is waiting its turn in a batch: the batch will do it, and one the person is removing must not be put back by it.
fn not_queued(hub: &Hub, id: &str) -> Result<(), String> {
    if hub.batch.lock().unwrap().as_ref().is_some_and(|b| b.queued.iter().any(|q| q == id)) {
        return Err("This app is waiting its turn in Update all or Install all. Press Stop first.".into());
    }
    Ok(())
}

/// The id Update all and Install all run under: its Cancel (the Stop button) stops the whole batch.
pub const BATCH: &str = "all";

/// What the batch says when it ends, in one or two sentences.
/// `worked` is how many apps were done; `not_done` names those tried that did not work (apps never reached after Stop are in neither).
pub fn batch_summary(kind: &str, total: usize, worked: usize, not_done: &[String], stopped: bool, hub_waiting: bool) -> String {
    let what = if kind == "update" { "updated" } else { "installed" };
    let apps = |n: usize| if n == 1 { "app" } else { "apps" };
    let mut words = if total == 0 {
        String::new()
    } else if stopped {
        format!("Stopped. {worked} of {total} {} {what}.", apps(total))
    } else if not_done.is_empty() {
        match total {
            1 => format!("1 app {what}."),
            2 => format!("Both apps {what}."),
            _ => format!("All {total} apps {what}."),
        }
    } else {
        format!("{worked} of {total} {} {what}. Not {what}: {}. Each one's row says why.", apps(total), not_done.join(", "))
    };
    if hub_waiting {
        words.push_str(" The hub was not updated, so you can see what happened first. Its Update button is at the top.");
    }
    words.trim().to_string()
}

/// Update all ("update") or Install all ("install"): the apps one after another, never two installers at once, with the apps open now last.
/// Update all then updates the hub itself, last because that closes and restarts it, and only when every app's update worked (otherwise the
/// person sees what went wrong first, and the hub's own Update button stays). Each app's row shows its progress as before, waits for the app
/// to be closed, and can be cancelled on its own; Stop cancels the app being done (if its installer is not already running) and the rest.
#[tauri::command]
pub fn start_all(app: AppHandle, hub: HubState<'_>, kind: String) -> Result<(), String> {
    if kind != "update" && kind != "install" {
        return Err("Unknown choice.".into());
    }
    if let Some(why) = blocked_by_catalog(&hub) {
        return Err(why);
    }
    let view = hub.view();
    let order = crate::hub::batch_order(&view.apps, &kind);
    let hub_last = kind == "update" && newer_hub_release(&hub).is_some();
    if order.is_empty() && !hub_last {
        return Err(if kind == "update" { "Everything is up to date." } else { "Every app is installed." }.into());
    }
    let stop = claim(&hub, BATCH)?;
    *hub.batch.lock().unwrap() = Some(crate::hub::BatchView {
        kind: kind.clone(),
        total: order.len() + usize::from(hub_last),
        done: 0,
        current: None,
        current_id: None,
        queued: order.clone(),
        not_done: Vec::new(),
        hub_last,
    });
    publish(&app);
    let hub = hub.inner().clone();
    std::thread::spawn(move || {
        let set = |change: &dyn Fn(&mut crate::hub::BatchView)| {
            if let Some(b) = hub.batch.lock().unwrap().as_mut() {
                change(b);
            }
            publish(&app);
        };
        let mut not_done: Vec<String> = Vec::new();
        let mut worked_count = 0;
        for id in &order {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let name = hub.app(id).map(|a| a.name).unwrap_or_else(|| id.clone());
            set(&|b| {
                b.queued.retain(|q| q != id);
                b.current = Some(name.clone());
            });
            let Some(worked) = batch_step(&app, &hub, id, &kind, &stop, &set) else { break };
            if worked {
                worked_count += 1;
            } else {
                not_done.push(name.clone());
            }
            set(&|b| {
                b.done += 1;
                b.current = None;
                b.current_id = None;
                b.not_done = not_done.clone();
            });
        }
        let stopped = stop.load(Ordering::Relaxed);
        let hub_now = hub_last && !stopped && not_done.is_empty();
        let mut message = batch_summary(&kind, order.len(), worked_count, &not_done, stopped, hub_last && !hub_now && !stopped);
        if hub_now {
            set(&|b| b.current = Some(brand().product_name.clone()));
            match newer_hub_release(&hub).ok_or("No newer hub is in the catalog.".to_string()).and_then(|r| claim_as(&hub, HUB, true).map(|c| (r, c))) {
                Ok((release, cancel)) => {
                    run_claimed(&app, &hub, HUB, &cancel, hub_update_work(app.clone(), release));
                }
                Err(why) => message.push_str(&format!(" The hub was not updated. {why}")),
            }
        }
        hub.jobs.lock().unwrap().remove(BATCH);
        *hub.batch.lock().unwrap() = None;
        let _ = app.emit("batch-done", message.trim());
        publish(&app);
    });
    Ok(())
}

/// One app of a batch. Whether it worked, or nothing when Stop was pressed first. An app that already has a job of its own (its row's button, a
/// download or an uninstall) is waited for; then what is there decides: it may be done already, still wanted, or gone.
fn batch_step(app: &AppHandle, hub: &Hub, id: &str, kind: &str, stop: &AtomicBool, set: &dyn Fn(&dyn Fn(&mut crate::hub::BatchView))) -> Option<bool> {
    loop {
        if stop.load(Ordering::Relaxed) {
            return None;
        }
        if hub.jobs.lock().unwrap().contains_key(id) {
            std::thread::sleep(Duration::from_millis(400));
            continue;
        }
        let apps = hub.view().apps;
        if !crate::hub::batch_order(&apps, kind).iter().any(|w| w == id) {
            return Some(crate::hub::in_place(&apps, id, kind));
        }
        let work = match install_work(hub, id) {
            Ok(work) => work,
            Err(why) => {
                let _ = app.emit("job", &end_event(id, "failed", why));
                return Some(false);
            }
        };
        // Started on its own just now: wait for that one.
        let Ok(cancel) = claim(hub, id) else {
            std::thread::sleep(Duration::from_millis(400));
            continue;
        };
        // Only a job of the batch's own is cancelled by Stop.
        set(&|b| b.current_id = Some(id.to_string()));
        return Some(run_claimed(app, hub, id, &cancel, work));
    }
}

#[tauri::command]
pub fn download_extra(app: AppHandle, hub: HubState<'_>, id: String, index: usize) -> Result<(), String> {
    let entry = hub.app(&id).ok_or("That app is not in the catalog.")?;
    spawn_job(
        app,
        id,
        Box::new(move |_hub: &Hub, cancel: &AtomicBool, report: &dyn Fn(JobEvent)| {
            let file = jobs::download_extra(&entry, index, cancel, report)?;
            Ok(format!("Saved in your Downloads folder as {}.", file.file_name().unwrap_or_default().to_string_lossy()))
        }),
    )
}

#[tauri::command]
pub fn cancel_job(hub: HubState<'_>, id: String) {
    // Stop (the batch's Cancel) also cancels the app being done now, when it still can be.
    let current = if id == BATCH { hub.batch.lock().unwrap().as_ref().and_then(|b| b.current_id.clone()) } else { None };
    let jobs = hub.jobs.lock().unwrap();
    for one in std::iter::once(&id).chain(current.as_ref()) {
        if let Some(flag) = jobs.get(one) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// Runs the app's own uninstaller. The window has already asked, saying that the app's documents and projects stay where they are.
#[tauri::command]
pub fn uninstall(app: AppHandle, hub: HubState<'_>, id: String) -> Result<(), String> {
    let entry = hub.app(&id).ok_or("That app is not in the catalog.")?;
    not_queued(&hub, &id)?;
    spawn_job(
        app,
        id,
        Box::new(move |hub: &Hub, cancel: &AtomicBool, report: &dyn Fn(JobEvent)| {
            jobs::uninstall(hub, &entry, cancel, report)?;
            Ok(format!("{} was removed. Its documents and projects are where they were.", entry.name))
        }),
    )
}

/// Opens an installed app from the folder Windows recorded. It never waits on the network.
pub fn open_installed(hub: &Hub, id: &str) -> Result<(), String> {
    let entry = hub.app(id).ok_or("That app is not in the catalog.")?;
    let list = system::installed_apps();
    let folder = system::find_installed(&list, &entry.installed_as)
        .and_then(|e| e.folder())
        .ok_or(format!("Windows does not list where {} is installed.", entry.name))?;
    let program = folder.join(&entry.program_file);
    if !program.is_file() {
        return Err(format!("{} is not in its install folder any more. Reinstall it from the menu.", entry.program_file));
    }
    system::launch(&program)
}

#[tauri::command]
pub fn open_app(hub: HubState<'_>, id: String) -> Result<(), String> {
    open_installed(&hub, &id)
}

#[tauri::command]
pub fn open_folder(hub: HubState<'_>, id: String) -> Result<(), String> {
    let entry = hub.app(&id).ok_or("That app is not in the catalog.")?;
    let list = system::installed_apps();
    let folder = system::find_installed(&list, &entry.installed_as).and_then(|e| e.folder()).ok_or("Windows does not list its install folder.")?;
    if !folder.is_dir() {
        return Err("The install folder Windows lists is not there.".into());
    }
    system::shell_open(&folder.to_string_lossy())
}

/// What's new: the page of the release on offer (or the app's list of releases), in the person's own browser.
#[tauri::command]
pub fn open_release_page(hub: HubState<'_>, id: String) -> Result<(), String> {
    let entry = hub.app(&id).ok_or("That app is not in the catalog.")?;
    let page = hub.offer_for(&entry).map(|r| r.release_page).unwrap_or_else(|| format!("https://github.com/{}/releases", entry.repository));
    system::shell_open(&page)
}

#[tauri::command]
pub fn open_web(hub: HubState<'_>, id: String) -> Result<(), String> {
    let url = hub
        .catalog
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|c| c.web.iter().find(|w| w.id == id).map(|w| w.url.clone()))
        .ok_or("That link is not in the catalog.")?;
    system::shell_open(&url)
}

/// The hub's own links: its repository (About) and the other hub's download page (the footer).
#[tauri::command]
pub fn open_link(which: String) -> Result<(), String> {
    let b = brand();
    match which.as_str() {
        "repository" => system::shell_open(&b.repository_url()),
        "sibling" => system::shell_open(&b.sibling.url),
        "releases" => system::shell_open(&format!("{}/releases", b.repository_url())),
        _ => Err("Unknown link.".into()),
    }
}

/// Changes one setting. Start with Windows also turns on Keep running in the tray; each can then be changed on its own.
#[tauri::command]
pub fn set_setting(app: AppHandle, hub: HubState<'_>, name: String, value: bool) -> Result<View, String> {
    let product = brand().product_name.clone();
    {
        let mut saved = hub.saved.lock().unwrap();
        match name.as_str() {
            "offerPreviews" => saved.settings.offer_previews = value,
            "keepInTray" => saved.settings.keep_in_tray = value,
            "dailyCheck" => saved.settings.daily_check = value,
            "startWithWindows" => {
                if value && !hub.policy.start_allowed() {
                    return Err("Start with Windows is turned off on this computer by whoever looks after it.".into());
                }
                system::set_start_with_windows(&product, value)?;
                if value {
                    saved.settings.keep_in_tray = true;
                }
            }
            _ => return Err("Unknown setting.".into()),
        }
        saved.save()?;
    }
    if hub.settings().keep_in_tray {
        tray::create(&app);
    } else {
        tray::remove(&app);
    }
    let view = hub.view();
    tray::refresh(&app, &view);
    Ok(view)
}

/// The first-run question about Start with Windows, asked once ("Not now" is the first choice).
#[tauri::command]
pub fn answer_first_run(app: AppHandle, hub: HubState<'_>, start: bool) -> Result<View, String> {
    {
        let mut saved = hub.saved.lock().unwrap();
        saved.settings.asked_start_with_windows = true;
        saved.save()?;
    }
    if start {
        return set_setting(app, hub, "startWithWindows".into(), true);
    }
    Ok(hub.view())
}

/// The newer hub the catalog offers, if there is one.
fn newer_hub_release(hub: &Hub) -> Option<crate::catalog::Release> {
    hub.catalog.lock().unwrap().as_ref().and_then(|c| c.hub.clone()).filter(|h| crate::version::newer(&h.version, crate::brand::HUB_VERSION))
}

/// The work of the hub's own update: the same checks, then the new installer runs once this hub closes, and the new hub starts.
fn hub_update_work(handle: AppHandle, release: crate::catalog::Release) -> Work {
    Box::new(move |hub: &Hub, cancel: &AtomicBool, report: &dyn Fn(JobEvent)| {
        jobs::update_hub(&release, cancel, report)?;
        // From here until the hub has gone, no job may start (this one is about to be taken off the list of those running).
        hub.closing.store(true, Ordering::Relaxed);
        // The installer waits for nothing but this program to end; give the window a moment to say so first.
        let quit = handle.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            quit.exit(0);
        });
        Ok("Updating the hub. It restarts by itself.".into())
    })
}

/// The hub's own update on its own (the banner's Update when only the hub has one).
#[tauri::command]
pub fn update_hub(app: AppHandle, hub: HubState<'_>) -> Result<(), String> {
    if hub.batch.lock().unwrap().is_some() {
        return Err("Update all is still running. The hub updates itself when it ends.".into());
    }
    let release = newer_hub_release(&hub).ok_or("No newer hub is in the catalog.")?;
    let work = hub_update_work(app.clone(), release);
    spawn_job(app, HUB.into(), work)
}

/// Whether Settings was chosen in the tray before this window had loaded (then the window opens Settings as it starts).
#[tauri::command]
pub fn take_pending_settings() -> bool {
    std::mem::take(&mut *tray::PENDING_SETTINGS.lock().unwrap())
}

#[tauri::command]
pub fn quit_hub(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hub_updates_itself_only_when_nothing_else_runs_and_nothing_starts_once_it_has() {
        let running = |ids: &[&str]| ids.iter().map(|i| (i.to_string(), Arc::new(AtomicBool::new(false)))).collect::<HashMap<_, _>>();
        // Apps beside each other, each once.
        assert!(may_start(&running(&["openassess", BATCH]), false, "openstage-guide", false).is_ok());
        assert!(may_start(&running(&["openassess"]), false, "openassess", false).unwrap_err().contains("under way"));
        // The hub's own update: alone, or as the end of the batch, and never while an app is being installed, downloaded or removed.
        assert!(may_start(&running(&[]), false, HUB, false).is_ok());
        assert!(may_start(&running(&[BATCH]), false, HUB, true).is_ok());
        assert!(may_start(&running(&[BATCH]), false, HUB, false).is_err(), "the banner's Update, while a batch runs");
        assert!(may_start(&running(&["openassess"]), false, HUB, false).unwrap_err().contains("still being"));
        assert!(may_start(&running(&[BATCH, "openassess"]), false, HUB, true).unwrap_err().contains("still being"), "a row's own job");
        // Once it has started, and after it has ended while the hub closes, nothing starts.
        for id in ["openassess", BATCH, HUB] {
            assert!(may_start(&running(&[HUB]), false, id, true).is_err(), "{id}");
            assert!(may_start(&running(&[]), true, id, true).unwrap_err().contains("restart"), "{id}");
        }
    }

    #[test]
    fn the_batch_says_plainly_how_it_went() {
        let none: Vec<String> = Vec::new();
        assert_eq!(batch_summary("install", 2, 2, &none, false, false), "Both apps installed.");
        assert_eq!(batch_summary("update", 3, 3, &none, false, false), "All 3 apps updated.");
        assert_eq!(batch_summary("install", 1, 1, &none, false, false), "1 app installed.");
        assert_eq!(
            batch_summary("update", 3, 2, &["OpenAssess".into()], false, true),
            "2 of 3 apps updated. Not updated: OpenAssess. Each one's row says why. The hub was not updated, so you can see what happened first. Its Update button is at the top."
        );
        assert_eq!(batch_summary("install", 4, 1, &["A".into()], true, false), "Stopped. 1 of 4 apps installed.");
        assert_eq!(batch_summary("update", 0, 0, &none, false, false), "", "only the hub: its own update says what happens");
    }
}
