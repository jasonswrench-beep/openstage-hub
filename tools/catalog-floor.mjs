// SPDX-License-Identifier: Apache-2.0
// The oldest catalog a hub accepts (minimumCatalogDate in the brand's brand.json), so that an old signed catalog cannot be replayed to a hub
// that has kept none yet. It is set, for each release of the hub, to the date of the newest published catalog:
//
//   node tools/catalog-floor.mjs --brand <folder>           show the published catalog's date and the one in brand.json
//   node tools/catalog-floor.mjs --brand <folder> --write   put the published catalog's date into brand.json (then commit it)
//   node tools/catalog-floor.mjs --brand <folder> --check   stop if hubs built now would refuse the published catalog, or have no date
//                                                            (tools/build-installer.mjs does this before a signed build)
// The published catalog is used only if its signature checks against the brand's own keys.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { checkSignature } from "./catalog-lib.mjs";
import { loadBrand } from "./brand.mjs";

/** The keys whose catalogs this brand's hubs trust. */
export const trustedKeys = (brand) => [brand.catalogPublicKey, brand.catalogBackupKey].filter(Boolean);

/** What is wrong with the date in brand.json, given the published catalog's: `stop` (hubs would refuse the catalog) or `note`. */
export function floorProblem(minimum, published) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(minimum ?? "")) return { stop: `brand.json has no minimumCatalogDate in the form 2026-11-18T04:11:48Z` };
  if (minimum > published) return { stop: `brand.json's minimumCatalogDate (${minimum}) is newer than the published catalog (${published}), so every hub built now would refuse it` };
  if (minimum < published) return { note: `brand.json's minimumCatalogDate (${minimum}) is older than the published catalog (${published}). That is safe; --write brings it up to date.` };
  return {};
}

/** The date of the published catalog, once its signature has been checked. */
export async function publishedDate(brand) {
  const base = `https://github.com/${brand.repository}/releases/download/${brand.catalog.tag}`;
  const get = async (name) => {
    const r = await fetch(`${base}/${name}`);
    if (!r.ok) throw new Error(`${base}/${name} answered ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  const [bytes, sig] = await Promise.all([get(brand.catalog.file), get(brand.catalog.signature)]);
  if (!trustedKeys(brand).some((k) => checkSignature(bytes, sig.toString("utf8"), k))) throw new Error("the published catalog's signature does not check against the keys in brand.json");
  return JSON.parse(bytes.toString("utf8")).generated;
}

async function main(argv) {
  const { brand, brandFile } = loadBrand();
  const published = await publishedDate(brand);
  console.log(`${brand.productName}: the published catalog is dated ${published}; brand.json has ${brand.minimumCatalogDate || "none"}.`);
  if (argv.includes("--write")) {
    const text = readFileSync(brandFile, "utf8");
    const changed = text.replace(/("minimumCatalogDate":\s*")[^"]*(")/, `$1${published}$2`);
    if (!/"minimumCatalogDate"/.test(text)) throw new Error("brand.json has no minimumCatalogDate line to change");
    writeFileSync(brandFile, changed);
    console.log(changed === text ? "It was already that." : "Written. Commit it before building.");
    return;
  }
  const { stop, note } = floorProblem(brand.minimumCatalogDate, published);
  if (note) console.log(`NOTE: ${note}`);
  if (stop && argv.includes("--check")) throw new Error(`${stop}. Run: node tools/catalog-floor.mjs --write --brand <folder>`);
  if (stop) console.log(`PROBLEM: ${stop}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`STOPPED: ${e.message}`);
    process.exitCode = 1;
  });
}
