# The policy file, for college IT staff

Place a file named `policy.json` beside the hub's program file (by default `%LOCALAPPDATA%\OpenStage Hub\openstage-hub.exe`, so `%LOCALAPPDATA%\OpenStage Hub\policy.json`; for Prism Hub, `%LOCALAPPDATA%\Prism Hub\policy.json` beside `prism-hub.exe`). The hub reads it each time it starts. Anything it does not set is left to the person.

```json
{
  "updateChecks": false,
  "startWithWindows": false,
  "hideApps": ["openassess"],
  "previews": false
}
```

| Setting | Effect |
| --- | --- |
| `"updateChecks": false` | The hub never fetches the catalog. It lists the apps from the last catalog it fetched (if any), and Open works; Install and Update are greyed out. |
| `"startWithWindows": false` | Start with Windows is off and cannot be turned on. (An existing start-up entry is not removed by the policy; remove it with the setting, or delete the `OpenStage Hub` or `Prism Hub` value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.) |
| `"hideApps": [ids]` | Those apps are not listed. The ids are in `brands/<brand>/apps.json`. OpenStage Hub: `openstage-author`, `openstage-recorder`, `openassess`, `openexplainer`, `openstage-capture-express`, `openstage-guide`, `pdf-remediator`, `openstage-studio`, `openstage-package-doctor`, `openstage-rehearse`. Prism Hub: `prismqda`, `prismstatistics`, `prism-reference-manager`. |
| `"previews": false` | Only stable releases are offered. An app that has only preview releases cannot be installed from the hub. |

Settings the policy has turned off are shown greyed out in the hub's Settings, with a line saying whoever looks after the computer set this.

A file that cannot be read as JSON is ignored, as if it were not there.
