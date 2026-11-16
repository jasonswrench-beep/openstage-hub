// SPDX-License-Identifier: Apache-2.0
// Sets the build up for one hub: writes src-tauri/tauri.conf.json from src-tauri/tauri.base.json (the settings both hubs share) and the brand's
// values (product name, program name, identifier, publisher, Start menu folder, and the program icons in brands/<brand>/app-icons).
// tauri.conf.json is never edited by hand and is not in the repository. The Rust code and the window read the brand's own brand.json.
//
//   node tools/apply-brand.mjs --brand <folder>           write it
//   node tools/apply-brand.mjs --brand <folder> --check   only say whether it already matches
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBrand, root, tauriConfFile } from "./brand.mjs";

const baseFile = join(root, "src-tauri", "tauri.base.json");

/** The Tauri settings for one brand. `folder` is the brand's folder name, for the icon paths (relative to src-tauri). */
export function branded(base, brand, folder) {
  const next = structuredClone(base);
  const icon = (name) => `../brands/${folder}/app-icons/${name}`;
  next.productName = brand.productName;
  next.mainBinaryName = brand.programName;
  next.identifier = brand.identifier;
  next.bundle.publisher = brand.publisher;
  next.bundle.icon = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico"].map(icon);
  next.bundle.windows.nsis.startMenuFolder = brand.startMenuFolder;
  next.bundle.windows.nsis.installerIcon = icon("icon.ico");
  return next;
}

export function applyBrand({ id, check = false } = {}) {
  const { brand, id: folder } = loadBrand(id);
  const base = JSON.parse(readFileSync(baseFile, "utf8"));
  const text = JSON.stringify(branded(base, brand, folder), null, 2) + "\n";
  const same = existsSync(tauriConfFile) && readFileSync(tauriConfFile, "utf8") === text;
  if (!check && !same) writeFileSync(tauriConfFile, text);
  return { same, brand };
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  try {
    const check = process.argv.includes("--check");
    const { same, brand } = applyBrand({ check });
    console.log(same ? `tauri.conf.json is set up for ${brand.productName}.` : check ? `tauri.conf.json is not set up for ${brand.productName}.` : `tauri.conf.json is now set up for ${brand.productName}.`);
    if (check && !same) process.exitCode = 1;
  } catch (e) {
    console.error(`STOPPED: ${e.message}`);
    process.exitCode = 1;
  }
}
