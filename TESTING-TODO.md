# Testing to do

Checks only a person can do, on a real Windows account. Tick each one off with the date and what you saw.

Already checked by Claude on 2026-11-15 (no need to repeat unless something changes):

- Windows' signature check reads "Jason Wrench" and a timestamp on the installed OpenExplainer, and refuses an unsigned file (`cargo test -- --ignored`).
- The installed apps list finds OpenStage Author, Recorder, OpenAssess, OpenExplainer, Capture Express and Guide on the owner's PC.
- A real release file is downloaded through GitHub's redirect; an address outside GitHub is refused.
- The catalog script (dry run) found every app's newest release and checked every setup file's SHA-256 and signature. It stopped on OpenExplainer v0.1.1, whose setup is not signed; that release (and v0.1.0) is now left out (`ignoreTags`).
- A catalog signed with a test key is read; the same catalog with one changed byte is refused, and the one already on disk is kept; a hub with no key built in trusts nothing.
- The installer is 3.09 MB (target 8 MB). The tray-only hub is ready in 0.35 s and uses 3 MB private memory, 16 MB working set (target 30 MB). With the window open: 104 MB private memory across the web view's processes (target 120 MB).
- In a browser, with a stand-in for the Rust side (`tests/ui-preview.html`): every row state, the menus and Settings by keyboard alone (Escape returns focus to the button that opened them), announcements for each stage and for a failure, light and dark, and text at 200 percent with no sideways scrolling.

## Before the first release

- [ ] Run **Make Hub Key.bat**, back up the `OpenStage Hub key` folder, commit `brand/brand.json`.
- [ ] Make the repository public (catalog and hub downloads need it).
- [ ] Run **Update OpenStage Catalog.bat** and check the release named `catalog` has the two files.
- [ ] The Prism Hub link in the footer goes to `github.com/jasonswrench-beep/prism-hub/releases`, which is private today. Make it public, or tell Claude the address to use.
- [ ] The web links: OpenScroll and Tutorial videos are left out until they have addresses (`catalog/apps.json`). Check that openstageauthor.com shows what you want.

## The window (installed hub, not the development copy)

- [ ] It opens about 470 by 720 with the OpenStage Suite icon, and lists the seven apps, the Web links and OpenStage Studio under Coming soon.
- [ ] First run asks about Start with Windows once, with "Not now" first. It does not ask again.
- [ ] Apps installed before the hub show as installed. Open opens each one.
- [ ] The status line reads "Checked for updates just now"; after 10 minutes and bringing the window back, "10 minutes ago".
- [ ] Ctrl and plus zooms to 200 percent; everything still fits and works.
- [ ] Windows' display scale at 200 percent: the window is sharp and fits.
- [ ] NVDA: every button names its app ("Install OpenStage Guide"); progress stages and failures are read; the menus and dialogs are read as menus and dialogs.
- [ ] Windows' contrast themes: the text and buttons can still be seen.

## Installing, updating, removing (on a clean Windows account)

Each app's quiet switch has not yet been tried. For each app, try Install, then Uninstall, then Install again:

- [ ] OpenStage Author (`/P`): its progress bar shows, no pages; installed; Windows lists 0.1.0.
- [ ] OpenStage Recorder (`/P`)
- [ ] OpenAssess (`/P`)
- [ ] OpenExplainer (`/P`)
- [ ] OpenStage Guide (`/P`)
- [ ] PDF Remediator (`/S`): installs with no window at all (its installer has no progress-bar-only mode). Say if you would rather it showed its pages.
- [ ] OpenStage Capture Express (`/SILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER`): its progress window shows, no questions.
- [ ] Uninstall says the app's documents and projects stay; afterwards they are still there and the app is gone from Windows' list.
- [ ] Update with the app open: the row says "Close ... to continue"; closing it lets the update go on. The hub never closes it.
- [ ] Cancel while downloading: nothing is installed and the download folder (`%LOCALAPPDATA%\org.openstage.hub\downloads`) is empty.
- [ ] Unplug the network part way through a download: a plain sentence and Retry.
- [ ] No step asks for administrator rights.

## Tray and start-up

- [ ] Turn on Start with Windows; sign out and in: the hub is in the tray with no window, within about a second.
- [ ] Left click opens the window; right click lists the installed apps (each opens), Check for updates, Settings, Quit.
- [ ] Closing the window leaves the hub in the tray; Task Manager shows it under 30 MB with the window closed.
- [ ] Turn off Keep running in the tray: closing the window quits the hub.
- [ ] After a catalog update with a newer app release: the tray icon shows its dot, and one Windows notification arrives, not repeated the next day.

## Offline

- [ ] With the network unplugged: every app still listed, installed versions shown, Open works, Install and Update show "Offline", the status says "Offline, showing what is installed".
- [ ] Plug it back in and reopen the window: the catalog is fetched again.

## The hub updating itself

- [ ] Publish a 1.0.1 and update the catalog: the window shows "A new version of the hub is ready"; Update closes the hub, its installer's progress bar shows, the new hub starts and says it was updated.

## IT policy file

- [ ] Each setting in `docs/policy.md`, one at a time, with `policy.json` beside the installed `openstage-hub.exe`.

## Uninstalling the hub

- [ ] Removes the hub, its start-up entry and `%LOCALAPPDATA%\org.openstage.hub`. Every OpenStage app is still installed and opens.
