<p align="center"><img src="brand/OpenStage-Suite.svg" width="96" alt="The OpenStage Suite icon: a stage with rainbow curtains and four people in the audience, on a navy tile"></p>

# OpenStage Hub

[Roadmap & Feature Requests](https://app.productbridge.io/widget/784db895-cb64-45f4-9bde-4645df4aa083?tab=roadmap)

One small Windows program that lists every app in the OpenStage suite and installs, updates and opens each one from its signed GitHub release.

- **No account.** Nothing to sign in to, and nothing about you or your computer is ever sent anywhere.
- **Stays out of the way.** It does not start with Windows unless you ask it to, and it never installs anything without your click.
- **Never installs anything unchecked.** Every installer must match its SHA-256 in the signed catalog and carry a valid, timestamped code signature from Jason Wrench, checked by Windows itself. Anything else is deleted before it runs.
- **Per user.** The hub and every OpenStage app install for one person, with no administrator rights.

Apache 2.0.

## Using it

Download `OpenStage-Hub-<version>-Setup.exe` from [Releases](https://github.com/jasonswrench-beep/openstage-hub/releases) and run it. The first copy is installed by hand; after that the hub updates itself.

Each app has one button: **Install**, **Open**, **Update**, **Cancel** while it works, or **Retry** with a plain sentence about what went wrong. The three-dot menu beside it holds Open, What's new, Open install folder, Reinstall, Uninstall, and Other downloads when an app has them. Apps you installed before the hub show as installed straight away.

Offline, the hub still lists every app from the last catalog it fetched, and Open still works.

Settings: Offer preview versions, Start with Windows, Keep running in the tray, Check once a day while in the tray, and About.

## For college IT staff

A `policy.json` file beside `openstage-hub.exe` can turn off update checks, turn off Start with Windows, hide apps or turn off previews. See [docs/policy.md](docs/policy.md).

## How it works

- [docs/how-it-works.md](docs/how-it-works.md): the catalog, the six install steps, what is kept on disk, and what is sent over the network.
- [docs/catalog.md](docs/catalog.md): the catalog's format and how to update it (`Update OpenStage Catalog.bat`).
- [docs/releasing.md](docs/releasing.md): making the hub key, building and signing the hub, and publishing a release.
- [TESTING-TODO.md](TESTING-TODO.md): the checks only a person can do.

## Building

Double-click `Run OpenStage Hub.bat` to run a development copy, or `Build OpenStage Hub.bat` to make an installer. Both need Node.js and Rust.

Every brand-specific value (name, identifier, Start menu folder, icon, accent colours, catalog address, the catalog's public key) is in [brand/brand.json](brand/brand.json), so Prism Hub can share this code with its own brand file.
