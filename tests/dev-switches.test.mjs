// SPDX-License-Identifier: Apache-2.0
// node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_SWITCHES, devSwitchesIn, namingDevSwitches } from "../tools/dev-switches.mjs";

const source = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "src");

/** Read by every build (--tray), or only by a test that is never part of the program (HUB_SIGNED_FILE). */
const NOT_DEVELOPMENT = ["--tray", "HUB_SIGNED_FILE"];

test("every development switch in the program's code is searched for", () => {
  const inCode = new Set();
  for (const name of readdirSync(source).filter((n) => n.endsWith(".rs"))) {
    const text = readFileSync(join(source, name), "utf8");
    for (const [, found] of text.matchAll(/\bvar(?:_os)?\(\s*"(HUB_[A-Z0-9_]+)"/g)) inCode.add(found);
    for (const [, found] of text.matchAll(/[=!]=\s*"(--[a-z][a-z-]*)"/g)) inCode.add(found);
  }
  for (const name of NOT_DEVELOPMENT) assert.ok(inCode.delete(name), `${name} is no longer in the code`);
  assert.deepEqual([...inCode].sort(), [...DEV_SWITCHES].sort());
});

test("every development switch is compiled into development builds only", () => {
  const guarded = new Set();
  for (const name of readdirSync(source).filter((n) => n.endsWith(".rs"))) {
    const lines = readFileSync(join(source, name), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const s of DEV_SWITCHES.filter((s) => line.includes(`"${s}"`))) {
        if (lines[i - 1].trim() === "#[cfg(debug_assertions)]") guarded.add(s);
        else assert.equal(s, "HUB_REAL_LOCALAPPDATA", `${name} line ${i + 1}: ${s} is not directly under #[cfg(debug_assertions)]`);
      }
    });
  }
  // Read inside the --update-hub block rather than directly under the line; a program that has it is stopped by the search of the built file.
  assert.deepEqual([...guarded].sort(), DEV_SWITCHES.filter((s) => s !== "HUB_REAL_LOCALAPPDATA").sort());
});

test("a program that carries a development switch is named, and one that does not is not", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "hub-dev-switches-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = (name, ...parts) => {
    const path = join(folder, name);
    writeFileSync(path, Buffer.concat(parts));
    return path;
  };
  const odd = Buffer.from([0x4d]);
  const clean = file("clean.exe", Buffer.from("MZ --tray HUB_SIGNED_FILE HUB_BRAND"));
  const plain = file("plain.exe", odd, Buffer.from("x--update-hubHUB_TEST_KEYx"));
  const wide = file("wide.exe", odd, Buffer.from("HUB_CATALOG_DIR", "utf16le"));
  assert.deepEqual(namingDevSwitches([clean, plain, wide]), [
    { file: plain, found: ["--update-hub", "HUB_TEST_KEY"] },
    { file: wide, found: ["HUB_CATALOG_DIR"] },
  ]);
  assert.deepEqual(namingDevSwitches([clean]), []);
  for (const name of DEV_SWITCHES) assert.deepEqual(devSwitchesIn(Buffer.from(`\0${name}\0`)), [name]);
});
