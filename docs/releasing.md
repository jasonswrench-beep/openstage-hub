# Making a hub release

OpenStage Hub and Prism Hub are built from this one repository and share one version number. A release of the code is normally a release of both: the same steps, once with `--brand openstage` and once with `--brand prism`. Each hub's installer and catalog are published in its own repository (`openstage-hub`, `prism-hub`), because installed hubs look for them there.

## Once per hub: the hub key

Double-click **Make Hub Key.bat** and choose the hub. You choose its password. The private half is saved in `OpenStage Hub key` (or `Prism Hub key`) in your user folder (outside the repository, never on GitHub); keep a backup of that folder with the password. The public half is written into `brands/<brand>/brand.json`; commit it. Every hub built from then on trusts catalogs signed with that key, and only those. Both hubs have their keys already.

The hub key is separate from the apps' own update keys and from the code-signing certificate.

## Once per hub: the repository

The hub's repository must be **public** before any hub can download the catalog or its own updates: release files of a private repository are not downloadable without signing in. Both are public.

## Each release

1. Raise `RELEASE` in `tools/build-installer.mjs`, and the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.base.json`, to the new version (such as `1.0.2`). The build stops if they differ.
2. Run the checks: `npm test`, `npm run typecheck`, and for each brand `node tools/apply-brand.mjs --brand <brand>` then `cargo test` in `src-tauri`.
3. Commit and push.
4. On the owner's computer, signed in to the signing service (`az login`), in a PowerShell window where the four signing settings are set first. They are the same account and profile names every app in both suites is signed with; they are not secret, but they are kept out of this public repository, so take them from your own notes:

   ```powershell
   $env:OPENSTAGE_SIGN_ENDPOINT = "<the account's address>"
   $env:OPENSTAGE_SIGN_ACCOUNT = "<the signing account>"
   $env:OPENSTAGE_SIGN_PROFILE = "<the certificate profile>"
   $env:OPENSTAGE_SIGN_PUBLISHER = "Jason Wrench"
   node tools/build-installer.mjs --brand openstage --sign
   node tools/build-installer.mjs --brand prism --sign
   ```

   Without them the build stops at once with "these are not set". It stops on any problem: a missing hub key, a program that names this computer's user folder, an installer that would download the web view's setup, or a program in the setup that is not signed and timestamped. Each writes `src-tauri/target/release-files/<Product-Name>-<version>-Setup.exe` (`OpenStage-Hub-...`, `Prism-Hub-...`) and its `.sha256.txt`, and says whether the setup is under 8 MB.
5. In each hub's repository, make the release with exactly that hub's two files, tagged `v<version>`, with notes in plain words: what changed, who signed it, the SHA-256, and what has not been tried. The tag in `openstage-hub` is at the pushed commit; `prism-hub` holds only releases and a pointer to this code, so its tag names the same version and its notes name this repository's commit.
6. Run **Update OpenStage Catalog.bat** and **Update Prism Catalog.bat**, so each catalog's hub entry names the new release. Installed hubs then offer the update.

The first release of a hub is installed by hand from GitHub. Updates work from then on.

## Brand values

Every brand-specific value is in `brands/<brand>/brand.json`. The build writes `src-tauri/tauri.conf.json` from it (`node tools/apply-brand.mjs --brand <brand>`); run `node tools/make-icons.mjs --brand <brand>` if a hub's icon changed. [how-it-works.md](how-it-works.md) ("Two hubs, one program") explains the layout.
