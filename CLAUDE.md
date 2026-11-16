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

## Working style

- Explain changes in plain language.
- Anything that needs running is a double-clickable script.
- No em dashes in prose written for this project.
- Repository text names no commercial products and makes no comparisons with products on the market.
- When a decision could reasonably go either way, ask rather than pick silently.
