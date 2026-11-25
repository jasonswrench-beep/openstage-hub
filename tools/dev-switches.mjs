// SPDX-License-Identifier: Apache-2.0
// Checks that no program in a release carries the hub's development switches (docs/how-it-works.md, "Development switches"). They let a catalog,
// a key or an install be tried without the published ones, so they are compiled only into development builds; this looks at the programs that
// were really built, in case a build was set up to include them. tools/build-installer.mjs runs it on every build.
import { readFileSync } from "node:fs";

/** Every development switch in src-tauri/src (tests/dev-switches.test.mjs checks that this list is complete). */
export const DEV_SWITCHES = ["--install", "--print-view", "--update-hub", "HUB_CATALOG_DIR", "HUB_REAL_LOCALAPPDATA", "HUB_TEST_KEY"];

/**
 * The development switches named in these bytes, as plain text or as Windows' two-byte text. In an optimized program the optimizer leaves no text
 * of the `--` switches, even when their code is there (tried 2026-11-25: such a program, built with debug assertions on, named all three HUB_ switches
 * and none of the others). So the HUB_ names show that a build was set up to include development code, and tests/dev-switches.test.mjs checks in the
 * code itself that each switch is under #[cfg(debug_assertions)].
 */
export function devSwitchesIn(bytes) {
  return DEV_SWITCHES.filter((name) => bytes.includes(Buffer.from(name, "latin1")) || bytes.includes(Buffer.from(name, "utf16le")));
}

/** The files that name a development switch, as "file (switch, switch)"; an empty list means none does. */
export function namingDevSwitches(files) {
  return files.map((file) => ({ file, found: devSwitchesIn(readFileSync(file)) })).filter((x) => x.found.length > 0);
}
