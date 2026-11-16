// SPDX-License-Identifier: Apache-2.0
// Which hub a script works on. Both hubs are built from this one copy of the code; each has a folder in brands/ holding everything that makes
// it that hub (brand.json, its icon and the program icons made from it, its list of apps and their icons). A script is told the brand by
// --brand <folder> or the HUB_BRAND setting (the .bat files pass it); with neither, it uses the brand the last build was set up for
// (src-tauri/tauri.conf.json, written by tools/apply-brand.mjs). It never guesses beyond that.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const brandsDir = join(root, "brands");
export const tauriConfFile = join(root, "src-tauri", "tauri.conf.json");

/** The brand folders: every folder in brands/ with a brand.json. */
export function brandIds() {
  return readdirSync(brandsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(brandsDir, d.name, "brand.json")))
    .map((d) => d.name)
    .sort();
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** The brand whose identifier the generated tauri.conf.json carries, or null. */
export function builtBrand() {
  if (!existsSync(tauriConfFile)) return null;
  const identifier = readJson(tauriConfFile).identifier;
  return brandIds().find((id) => readJson(join(brandsDir, id, "brand.json")).identifier === identifier) ?? null;
}

/** The brand folder name chosen by --brand, HUB_BRAND, or the last build; otherwise an error that lists the brands. */
export function chosenBrand(argv = process.argv, env = process.env) {
  const at = argv.indexOf("--brand");
  const named = at >= 0 ? argv[at + 1] : env.HUB_BRAND || builtBrand();
  const ids = brandIds();
  if (!named) throw new Error(`say which hub: --brand ${ids.join(" or --brand ")} (or set HUB_BRAND).`);
  if (!ids.includes(named)) throw new Error(`there is no brand "${named}" in brands/. The brands are: ${ids.join(", ")}.`);
  return named;
}

/** Everything about one brand: its folder, brand.json, and apps.json (the catalog script's list of apps). */
export function loadBrand(id = chosenBrand()) {
  const dir = join(brandsDir, id);
  return {
    id,
    dir,
    brandFile: join(dir, "brand.json"),
    brand: readJson(join(dir, "brand.json")),
    appsFile: join(dir, "apps.json"),
    apps: readJson(join(dir, "apps.json")),
  };
}

/** The arguments with --brand <id> taken out, for scripts that pass the rest on. */
export function withoutBrand(argv) {
  const at = argv.indexOf("--brand");
  return at < 0 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];
}
