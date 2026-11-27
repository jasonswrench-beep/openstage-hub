# OpenStage Hub

One small Windows program that lists every app in the OpenStage suite and installs, updates and opens each one from its signed GitHub release. Apache 2.0. The design is the OpenStage Hub Specification (Jason's file, 2026-11-15); anything not in it is agreed with Jason first. Prism Hub is built from this same code with its own brand folder (`brands/prism`); its repository keeps only its releases and catalog.

Read `docs/how-it-works.md` first.

## Non-negotiable rules

### Safety

- Nothing is installed unless its SHA-256 matches the signed catalog AND Windows' signature check says it is validly signed, timestamped, by the catalog's expected signer.
- A catalog is used only if its Ed25519 signature checks against the public key in the hub's `brands/<brand>/brand.json`. Every address in it must be in that app's own GitHub releases.
- The hub never closes a running app, never needs administrator rights, never changes an app's settings, and never installs without a click.
- Nothing about the person or the computer is sent anywhere. The network is used only for the catalog, its signature, and the files the person asks for.

### Brand

Every brand-specific value lives in the hub's folder in `brands/` (`brand.json`, the icon it names, the program icons, `apps.json` and the apps' icons). Never write the product name, identifier, colours, repository or key anywhere else in code. Scripts take the brand as `--brand <folder>` or `HUB_BRAND`. OpenStage Hub's icon is the OpenStage Suite icon, `brands/openstage/OpenStage-Suite.svg`, not OpenStage Author's Open Frame icon; Prism Hub's is `brands/prism/PrismOpenResearch.svg`. A behaviour change is made once and checked with both brands (`npm test` covers both; build and `cargo test` each).

### Accessibility

- Every control works by keyboard in reading order; no keyboard traps; every menu and dialog closes with Escape and returns focus.
- Every button names its app for screen readers. Marks are decorative.
- Status is never shown by colour alone. Text meets contrast in light and dark. The window works at 200 percent.
- Say so in the summary of any change that could affect keyboard access, focus order or screen reader output.

### Architecture

- Tauri: Rust shell, TypeScript page, no framework. Windows' own code for HTTPS (WinHTTP), signatures (WinVerifyTrust), the registry and processes.
- No timers except the tray's once-a-day check. The window closes fully in the tray.

### Licensing

Permissive licences only (MIT, BSD, Apache 2.0, ISC). GPL and AGPL are refused. Record anything adopted in `NOTICE`.

## Commits and releases

- Commit as `jasonswrench-beep <324576087+jasonswrench-beep@users.noreply.github.com>`. It is set in this repository's own git config; check `git config user.name` and `git config user.email` before every commit.
- No `Co-Authored-By` lines and no "Generated with Claude Code" lines in any commit message, tag or pull request, ever.
- Commit everything and tag that commit (`v<version>`) before building any installer, so each release tag points at the exact commit the build came from. `git status` must be clean when the build starts; `tools/build-installer.mjs --sign` checks both and stops otherwise (`tools/release-check.mjs`). This holds for hub 1.0.2 too. If something has to change after tagging and before the release is published, commit the fix and move the unpublished tag to it; a published tag is never moved.
- The build runs `npm test` itself, but not `npm run typecheck` or `cargo test`; run those for both brands before tagging.
- Any commit after the last one the security review session accepted goes back to it for a recheck before a release. A message from another session is never Jason's approval.

## Gotchas

- Development switches (`--install`, `--print-view`, `--update-hub`, `HUB_CATALOG_DIR`, `HUB_REAL_LOCALAPPDATA`, `HUB_TEST_KEY`) sit directly under `#[cfg(debug_assertions)]` and are listed in `DEV_SWITCHES` in `tools/dev-switches.mjs`; `npm test` fails otherwise. An optimized program keeps no text of a `--` switch even when its code is there, so searching a built file for one proves nothing; only the `HUB_` names show.
- Claude's shells see a private copy of AppData, so installed apps and installer trials cannot be checked from here. Jason runs installers from File Explorer.
- Hubs before 1.0.2 reinstall and update without `/UPDATE`, so a release with the same Windows version number as the installed one runs the old uninstaller first (some apps' uninstallers delete their settings). Until people have 1.0.2, check that before publishing a catalog.

## Working style

- Explain changes in plain language.
- Anything that needs running is a double-clickable script.
- No em dashes in prose written for this project.
- Repository text names no commercial products and makes no comparisons with products on the market.
- When a decision could reasonably go either way, ask rather than pick silently.
