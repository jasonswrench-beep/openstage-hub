# The catalog

## Updating it

Each hub has its own catalog, made from its own list of apps. After any app release, double-click **Update OpenStage Catalog.bat** (OpenStage Hub) or **Update Prism Catalog.bat** (Prism Hub). It:

1. reads each repository's newest published stable and preview releases (drafts never count);
2. finds each setup file by the app's `setupPattern`, downloads any it has not checked before, computes its SHA-256 and checks its code signature (valid, timestamped, signed by the expected signer);
3. lists every setup file that is missing or not properly signed and stops if there is any, before signing anything;
4. puts each app's icon into the catalog as a picture, prints a table of what changed, asks for that hub key's password, signs the catalog, checks the signature against the key built into the hub, and uploads both files to the release named `catalog` in that hub's repository.

Until it runs, the hub keeps offering the previous version, which is safe.

Options (from a console): `--dry-run` checks everything and shows the table but signs and uploads nothing; `--local` signs but leaves the files in `brands/<brand>/out` instead of uploading.

It needs Node.js and the GitHub command line (`gh`), signed in as the owner. Checked setup files are remembered in `brands/<brand>/work/checked.json` by GitHub's own SHA-256 of each file, so each is downloaded once.

## The source file: `brands/<brand>/apps.json`

`brands/openstage/apps.json` for OpenStage Hub, `brands/prism/apps.json` for Prism Hub. The facts GitHub cannot tell the script:

| Field | Meaning |
| --- | --- |
| `id` | Short name, lower case, used by the hub and the policy file |
| `name` | As shown in the hub |
| `mark` | `letters` (one or two) and `color` (`#RRGGBB`) for the round mark, and `icon`: the app's own icon, an SVG or PNG of at most 32 KB in the brand's folder (`icons/<id>.png` or `.svg`, taken from the app's own icon files). The script puts the picture inside the signed catalog as a `data:` address, so the hub never downloads it and has it offline. An SVG with a script in it is refused. Without an icon the round mark is shown |
| `description` | One line |
| `repository` | `owner/name` on GitHub |
| `installedAs` | The name Windows lists in installed apps (DisplayName) |
| `programFile` | The program's file name inside its install folder |
| `quietSwitch` | The installer's switches for an install with no questions that shows its progress bar |
| `quietUninstallSwitch` | Used only when Windows lists no quiet uninstall command (default `/S`) |
| `expectedSigner` | The name on the code signature |
| `setupPattern` | A regular expression matching exactly one file of a release: its setup |
| `ignoreTags` | Releases never to list (for example, ones published before code signing began) |
| `extras` | Other downloads: `name`, `description` and a `pattern` matching the file |
| `windowsVersion` | Only if Windows lists something other than the release's three numbers |
| `minimumHubVersion` | Only if this entry needs a newer hub |
| `listedBeforeRelease` | For an app about to come out (OpenStage Studio and OpenStage Package Doctor, Jason's choice on 2026-11-17): a Desktop row now, reading "No release yet" with no Install button and no What's new, until its repository is public and has a published release; from then on its release is listed and Install appears, with no change to this file |
| `comingSoonUntilReleased` | For an app still being made: listed under Coming soon, with its mark, until its repository is public and has a published release; from then on it is a Desktop row like the others, with no change to this file |
| `hiddenUntilRepositoryExists` | For a planned app whose repository has not been made yet (OpenStage Rehearse): left out of the catalog altogether until the repository exists (private is enough). Used with `comingSoonUntilReleased`, so it then shows under Coming soon until it is released |

At the top of the file, `alsoPublishIconFiles` (OpenStage only, for now) also publishes each PNG icon as a separate file beside the catalog, named in the app's `icon` entry, the way OpenStage Hub 1.0.1 reads icons; newer hubs ignore it.

`web` lists the Web section (an entry with an empty `url` is left out until it has one), and `comingSoon` the Coming soon section.

### The installers' quiet switches today

| Apps | Installer | Switch | Tried |
| --- | --- | --- | --- |
| Author, Recorder, Assess, Explainer, Guide; PrismQDA, PrismStatistics, Prism Reference Manager | The suite's standard per-user installer (Tauri's NSIS) | `/P`: no questions, its progress bar shown | Not yet (TESTING-TODO.md) |
| PDF Remediator | Its own NSIS script, following Tauri's switches | `/S`: silent, no progress bar (it has no `/P`) | Not yet |
| Capture Express | Inno Setup | `/SILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER` | Not yet |

## The published file

Named in the brand file (`catalog.file`): `openstage-catalog.json` for OpenStage Hub and `prism-catalog.json` for Prism Hub, each signed as `<file>.sig` (the Ed25519 signature of the file's exact bytes, in base64, with that hub's key):

```json
{
  "format": 1,
  "generated": "2026-11-15T18:04:00Z",
  "minimumHubVersion": "1.0.0",
  "hub": { "version": "1.0.0", "windowsVersion": "1.0.0", "url": "...", "sha256": "...", "size": 0, "releasePage": "..." },
  "apps": [
    {
      "id": "openexplainer", "name": "OpenExplainer", "mark": { "letters": "ex", "color": "#6B5BD2", "icon": "data:image/png;base64,..." },
      "description": "...", "repository": "jasonswrench-beep/OpenExplainer",
      "installedAs": "OpenExplainer", "programFile": "openexplainer.exe", "quietSwitch": ["/P"], "expectedSigner": "Jason Wrench",
      "stable": null,
      "preview": {
        "version": "0.2.0-alpha.4", "windowsVersion": "0.2.0",
        "url": "https://github.com/jasonswrench-beep/OpenExplainer/releases/download/v0.2.0-alpha.4/OpenExplainer-0.2.0-alpha.4-Setup.exe",
        "sha256": "...", "size": 15247912,
        "releasePage": "https://github.com/jasonswrench-beep/OpenExplainer/releases/tag/v0.2.0-alpha.4"
      },
      "extras": []
    }
  ],
  "web": [{ "id": "roadmap", "name": "Roadmap and feature requests", "description": "...", "url": "https://..." }],
  "comingSoon": [{ "id": "openstage-studio", "name": "OpenStage Studio", "description": "..." }]
}
```

A new field can be added without breaking older hubs (they ignore what they do not know). OpenStage Hub 1.0.1 reads icons from the separate `apps[].icon` file entry, not `mark.icon`, which is why OpenStage's catalog carries both for now. A change older hubs would misread raises `format` or `minimumHubVersion`, and those hubs then show only their update banner.

## Stable and preview

With **Offer preview versions** on (the default while the suite is in preview), the hub offers the newer of an app's stable and preview releases. With it off, it offers the stable release, or the preview marked Preview when there is no stable one. Turning previews off never pushes anyone backward: they keep their version until a stable one passes it. A policy file can turn previews off entirely (see [policy.md](policy.md)).

A release is a preview when its version has a pre-release part (`0.1.0-beta.2`), and stable when it has none (`0.2.1`). GitHub's pre-release mark is not read, so an app that wants a release shown as a preview gives it a version with a pre-release part.
