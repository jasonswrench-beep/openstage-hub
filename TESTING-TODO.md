# Testing to do

Checks only a person can do, on a real Windows account. Tick each one off with the date and what you saw.

OpenStage Hub and Prism Hub are now one program built from this repository with two brand folders (`brands/openstage`, `brands/prism`), so a behaviour check done on one hub holds for the other. Checks that depend on the brand (the name, the icon, the apps, the installers) are listed for each.

## Checked by Claude

On 2026-11-15 (no need to repeat unless something changes):

- Windows' signature check reads "Jason Wrench" and a timestamp on the installed OpenExplainer, and refuses an unsigned file (`cargo test -- --ignored`).
- The installed apps list finds OpenStage Author, Recorder, OpenAssess, OpenExplainer, Capture Express and Guide on the owner's PC.
- A real release file is downloaded through GitHub's redirect; an address outside GitHub is refused.
- A catalog signed with a test key is read; the same catalog with one changed byte is refused, and the one already on disk is kept; a hub with no key built in trusts nothing.
- The installer is 3.09 MB (target 8 MB). The tray-only hub is ready in 0.35 s and uses 3 MB private memory, 16 MB working set (target 30 MB). With the window open: 104 MB private memory across the web view's processes (target 120 MB).
- In a browser, with a stand-in for the Rust side (`tests/ui-preview.html`): every row state, the menus and Settings by keyboard alone (Escape returns focus to the button that opened them), announcements for each stage and for a failure, light and dark, and text at 200 percent with no sideways scrolling.

On 2026-11-16, after the two hubs became one codebase (version 1.0.2, not released):

- `npm test` (9 tests, covering both brands' app lists, icons and brand files) and `npm run typecheck` pass.
- Built as OpenStage Hub and as Prism Hub, `cargo test` passes 21 tests each. Building one brand with `tauri.conf.json` set up for the other stops with a plain message.
- The window, built for each brand, shows that hub's name, icon and accent colour, and every app's own icon carried in the catalog (Prism Hub's three SVGs, OpenStage Hub's PNGs). Package Doctor and Rehearse show under Coming soon with their round marks. A pretend install that fails shows its sentence and Retry.
- PrismQDA already takes its statistics from the shared core at the tag `prismqda-stats-v1.0.0` and has no copy of its own (nothing to change this round).

On 2026-11-17, Update all and Install all (not released; comes with 1.0.2):

- `npm test` (12 tests) and `npm run typecheck` pass; built as each hub, `cargo test` passes 24 tests (the order Update all takes, which apps Install all takes, and the sentence at the end).
- In a browser with the stand-in, for both hubs: Update all does the closed app first and the open one last, the waiting rows say "waiting its turn", Stop leaves the rest offered, a failure does not stop the others, and the hub goes last when the catalog offers one. Install all asks first, "Not now" has the focus, and Escape returns it to the button. By keyboard alone; the focus moves to Stop, and to the Desktop heading when the notice goes. Light, dark, and half the window's width (200 percent) with nothing scrolling sideways.

## First release (list item 1)

Done for both hubs by 2026-11-15: the hub keys made, both repositories public, both catalogs published, 1.0.0 and 1.0.1 released and signed. The footer links between the two hubs now open (both repositories are public). Still to do:

- [ ] Each app's quiet install switch: below, under "Installing, updating, removing".
- [x] 2026-11-17: the OpenStage catalog is republished (generated 2026-11-17 02:28 UTC). Claude downloaded it from GitHub: its signature checks against the key in `brands/openstage/brand.json`, and it offers OpenStage Author 0.1.0 alpha 5, Recorder 0.1.0 alpha 5, OpenAssess 0.1.0 alpha 29, OpenExplainer 0.2.0 alpha 5, Capture Express 0.1.0 alpha 5, Guide 0.1.0 alpha 10 and PDF Remediator 0.3.0 alpha 10, with the hub entry still 1.0.1. Every app's icon is inside the catalog, and the eight icon files for 1.0.1 hubs on the release match their SHA-256 in it. Prism's catalog was already current.
- [x] 2026-11-18: republished (generated 2026-11-18 00:26 UTC) with OpenStage Studio and OpenStage Package Doctor under Desktop, no release, and Coming soon empty. Claude downloaded it from GitHub: its signature checks against the key in `brands/openstage/brand.json`, every app's version is as before, the eight icon files for 1.0.1 hubs match their SHA-256, and apart from its date it is the catalog the 1.0.0, 1.0.1 and current hub code were shown and accepted.
- [x] 2026-11-18: republished again (generated 01:56 UTC) after Studio's and Package Doctor's repositories were made public. It offers OpenStage Studio 0.1.0 alpha 1 (its setup downloads without signing in, matches the catalog's SHA-256 and is signed by Jason Wrench) and carries Package Doctor's own icon; Package Doctor has no release yet. Signature, versions and the nine icon files for 1.0.1 hubs checked from GitHub.
- [x] 2026-11-18: the Prism catalog is republished (generated 04:00 UTC) with Prism Transcribe and Prism Survey. Claude downloaded it from GitHub's public address: it and its signature match the files the script signed, the signature checks against the key in `brands/prism/brand.json`, and it offers PrismQDA 0.1.0 beta 3, PrismStatistics 0.2.2, Prism Reference Manager 0.1.3, Prism Transcribe 0.1.0 alpha 1 and Prism Survey 0.1.0 beta 1, with the hub entry still 1.0.1. All five icons are inside it; the two new ones match their files in `brands/prism/icons`. Both new setup addresses answer without signing in.
- [x] 2026-11-18: republished again (generated 04:09 UTC) expecting 0.1.0-alpha.1 for Prism Transcribe and 0.1.0-beta.3 for PrismQDA in Windows. Claude checked it from GitHub's public address (signature, the same five versions and icons), and a development Prism Hub with `--print-view` reads it as fresh and shows Prism Transcribe installed at 0.1.0-alpha.1 with no update offered.
- [ ] Install Prism Transcribe and Prism Survey from Prism Hub: each progress bar shows, no pages; Windows lists each at 0.1.0; Open opens each. Every row shows its own icon.
- [ ] Install OpenStage Studio from the hub: its progress bar shows, no pages; Windows lists 0.1.0; Open opens it.
- [ ] In an installed hub, Check for updates offers those versions for the apps you have, and every row still shows its icon.

## Web links and planned apps (list item 2)

- [ ] OpenStage Scroll and Tutorial videos stay hidden until they have addresses. Scroll's will be its address on your server once it is deployed (Scroll's list item 1). Tell Claude each address, or put it in `url` under `web` in `brands/openstage/apps.json`.
- [ ] OpenStage Studio and OpenStage Package Doctor are listed under Desktop now, reading "No release yet" with no Install button (your choice, 2026-11-17: `listedBeforeRelease` in `brands/openstage/apps.json`). When each repository is public with a signed release, the next Update OpenStage Catalog run lists it and Install appears by itself. OpenStage Rehearse stays out of the catalog until `jasonswrench-beep/openstage-rehearse` exists, then shows under Coming soon. If a repository gets a different name, change `repository` there.
- [ ] When each of them makes its first release, check its program file name and quiet switch in `brands/openstage/apps.json` (they are what a Tauri app made like the others would have).
- [ ] Check that openstageauthor.com shows what you want.

## One codebase (list item 3): before releasing 1.0.2

- [ ] Look over the change and commit it (nothing is committed yet).
- [ ] Build both hubs signed (`docs/releasing.md`), release 1.0.2 in each hub's own repository, then run both Update Catalog scripts.
- [ ] OpenStage's catalog carries each icon twice for now: inside the catalog for 1.0.2, and as a separate file for 1.0.1 (`alsoPublishIconFiles` in `brands/openstage/apps.json`), so installed 1.0.1 hubs keep their icons. Some weeks after 1.0.2 is out, remove that setting.
- [ ] An installed Prism Hub 1.0.1 keeps its icons throughout (it already reads them from inside the catalog) and also offers 1.0.2.

## The window (installed hub, not the development copy), for each hub

- [ ] It opens about 470 by 720 with the hub's own icon and name (the OpenStage Suite icon and "OpenStage Hub"; the PrismOpenResearch icon and "Prism Hub").
- [ ] OpenStage Hub lists its seven apps, then OpenStage Studio and OpenStage Package Doctor reading "No release yet", and the Web links. Prism Hub lists its five apps (Prism Transcribe and Prism Survey last). Every app shows its own icon.
- [ ] First run asks about Start with Windows once, with "Not now" first. It does not ask again.
- [ ] Apps installed before the hub show as installed. Open opens each one.
- [ ] The status line reads "Checked for updates just now"; after 10 minutes and bringing the window back, "10 minutes ago".
- [ ] Ctrl and plus zooms to 200 percent; everything still fits and works.
- [ ] Windows' display scale at 200 percent: the window is sharp and fits.
- [ ] NVDA: every button names its app ("Install OpenStage Guide", "Install Prism Reference Manager"); progress stages and failures are read; the menus and dialogs are read as menus and dialogs.
- [ ] NVDA with Update all: the button reads "Update all 3 apps, then the hub"; each app's stages are read as it goes; the closing sentence is read.
- [ ] Windows' contrast themes and dark mode: the text and buttons can still be seen (Prism Hub's navy buttons too).

## Installing, updating, removing (on a clean Windows account)

Each app's quiet switch has not yet been tried. For each app, try Install, then Uninstall, then Install again:

- [ ] OpenStage Author (`/P`): its progress bar shows, no pages; installed; Windows lists 0.1.0.
- [ ] OpenStage Recorder (`/P`)
- [ ] OpenAssess (`/P`)
- [ ] OpenExplainer (`/P`)
- [ ] OpenStage Guide (`/P`)
- [ ] PDF Remediator (`/S`): installs with no window at all (its installer has no progress-bar-only mode). Say if you would rather it showed its pages.
- [ ] OpenStage Capture Express (`/SILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER`): its progress window shows, no questions.
- [ ] PrismQDA (`/P`): its progress bar shows, no pages; Windows lists 0.1.0-beta.3 (its installer is built with the whole version, like Transcribe's; the catalog now expects that). If Windows lists 0.1.0 instead, the hub says so after the install: tell Claude, and `windowsListsFullVersion` comes off PrismQDA in `brands/prism/apps.json`.
- [ ] PrismStatistics (`/P`)
- [ ] Prism Reference Manager (`/P`)
- [ ] Prism Transcribe (`/P`): its progress bar shows, no pages, and Open starts `prism-transcribe.exe`. 2026-11-18, first try: it installed (into `AppData\Local\Prism Transcribe`, with `prism-transcribe.exe`), but the hub said "Windows lists Prism Transcribe as version 0.1.0-alpha.1, not 0.1.0": its installer is built with the whole version. The catalog now expects 0.1.0-alpha.1 (`windowsListsFullVersion`). After the catalog is republished, Check for updates: its row shows installed 0.1.0-alpha.1 with no update offered, and Reinstall from its menu ends without that message.
- [ ] Prism Survey (`/P`): its progress bar shows, no pages; Windows lists "Prism Survey" 0.1.0, and Open starts `prismsurvey-app.exe` (read from its build files, as for Transcribe). Its release was published as `v0.1.0-preview.2`, a version the hub does not read; on 2026-11-18 Claude added the tag `v0.1.0-beta.1` at the same commit (6954716) and moved the release to it, marked pre-release, with the same signed setup. Later Survey releases need alpha, beta or rc in the tag.
- [ ] Uninstall says the app's documents and projects stay; afterwards they are still there and the app is gone from Windows' list.
- [ ] Update with the app open: the row says "Close ... to continue"; closing it lets the update go on. The hub never closes it.
- [ ] Update all with two or more updates and one app open: the closed apps update one after another, then the open one waits with "Close ... to continue". The notice reads "Updating 1 of 3: ..." throughout, and the status line ends with "All 3 apps updated."
- [ ] Update all with a newer hub in the catalog (after 1.0.3 exists): the apps first, then the hub closes, updates and restarts.
- [ ] Install all on a clean account: it asks first (naming the apps and the download size), then installs them one after another. Stop part way: the app being downloaded is cancelled and the rest are left.
- [ ] Close the window to the tray during Update all: it carries on; reopening the window shows how far it has got.
- [ ] Cancel while downloading: nothing is installed and the download folder (`%LOCALAPPDATA%\org.openstage.hub\downloads`, or `org.prismopenresearch.hub` for Prism Hub) is empty.
- [ ] Unplug the network part way through a download: a plain sentence and Retry.
- [ ] No step asks for administrator rights.

## Tray and start-up

- [ ] Turn on Start with Windows; sign out and in: the hub is in the tray with no window, within about a second.
- [ ] Left click opens the window; right click lists the installed apps (each opens), Check for updates, Settings, Quit.
- [ ] Closing the window leaves the hub in the tray; Task Manager shows it under 30 MB with the window closed.
- [ ] Turn off Keep running in the tray: closing the window quits the hub.
- [ ] After a catalog update with a newer app release: the tray icon shows its dot, and one Windows notification arrives, not repeated the next day.
- [ ] With both hubs installed and both set to Start with Windows: each starts in the tray with its own icon, and they do not get in each other's way.

## Offline

- [ ] With the network unplugged: every app still listed with its icon, installed versions shown, Open works, Install and Update show "Offline", the status says "Offline, showing what is installed".
- [ ] Plug it back in and reopen the window: the catalog is fetched again.

## The hub updating itself

- [ ] With 1.0.2 published and both catalogs updated: each installed hub shows "A new version of the hub is ready"; Update closes the hub, its installer's progress bar shows, the new hub starts and says it was updated.

## IT policy file

- [ ] Each setting in `docs/policy.md`, one at a time, with `policy.json` beside the installed `openstage-hub.exe` (and once beside `prism-hub.exe`).

## Uninstalling the hub

- [ ] Removes the hub, its start-up entry and its folder in `%LOCALAPPDATA%`. Every app is still installed and opens. Uninstalling one hub leaves the other hub working.

## A Mac version (list item 4)

Waits until the apps have Mac builds. On 2026-11-16 none of the ten apps' newest releases has one, and the hub's design uses Windows' own code for downloads, signatures, the installed apps list and start-up, so a Mac hub needs its own version of each. Nothing to check yet.
