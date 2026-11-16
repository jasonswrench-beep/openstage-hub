// SPDX-License-Identifier: Apache-2.0
// Makes a hub's key: a new Ed25519 key pair, separate from the apps' update keys, that signs that hub's catalog and its own updates. Each hub has
// its own key.
//   - The private half is saved with your password, OUTSIDE the repository (by default in "<product name> key" in your user folder, for example
//     "OpenStage Hub key"; set HUB_KEY to put it somewhere else). It never goes on GitHub. Keep a backup copy somewhere safe, with the password.
//   - The public half is written into the brand's brand.json (catalogPublicKey), so it is built into every hub from now on.
// It refuses to replace a key that already exists: a new key would mean every hub already installed stops trusting the catalog.
//
//   node tools/make-hub-key.mjs --brand <folder>           make it (with no --brand it asks which hub)
//   node tools/make-hub-key.mjs --brand <folder> --check   ask for the password and say whether it opens the key; change nothing
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeKey, publicOf } from "./catalog-lib.mjs";
import { ask, askSecret } from "./prompt.mjs";
import { brandIds, loadBrand, root } from "./brand.mjs";

/** Where the brand's hub key is kept (HUB_KEY overrides it). */
export const keyFile = (id) => {
  const b = loadBrand(id).brand;
  return process.env.HUB_KEY || join(homedir(), `${b.productName} key`, `${b.programName}-catalog-key.pem`);
};

/** The brand named by --brand or HUB_BRAND; otherwise the person picks one. A key is never made for a hub guessed from the last build. */
async function whichBrand() {
  const at = process.argv.indexOf("--brand");
  const named = at >= 0 ? process.argv[at + 1] : process.env.HUB_BRAND;
  if (named) return named;
  const ids = brandIds();
  ids.forEach((id, i) => console.log(`  ${i + 1}. ${loadBrand(id).brand.productName}`));
  const answer = Number(await ask("Which hub's key? Type its number: "));
  if (!ids[answer - 1]) throw new Error("no hub was chosen. Nothing was changed.");
  return ids[answer - 1];
}

/** --check: asks for the password and says whether it opens the key and whether that key is the one in brand.json. Changes nothing. */
async function check(file, brand, shown) {
  if (!existsSync(file)) {
    console.log(`There is no hub key at ${file}.`);
    process.exitCode = 1;
    return;
  }
  const password = await askSecret("The hub key's password: ");
  try {
    const pub = publicOf(readFileSync(file, "utf8"), password);
    console.log(pub === brand.catalogPublicKey
      ? "The password opens the hub key, and it is the key built into the hub."
      : `The password opens the key, but it is NOT the key in ${shown}.`);
  } catch {
    console.log(`That password (${password.length} characters) does not open the hub key.`);
    process.exitCode = 1;
  }
}

async function main() {
  const { id, brandFile, brand } = loadBrand(await whichBrand());
  const shown = relative(root, brandFile).replaceAll("\\", "/");
  const file = keyFile(id);
  console.log(`${brand.productName}: its hub key.`);
  if (process.argv.includes("--check")) return check(file, brand, shown);
  if (existsSync(file)) {
    console.log(`A hub key is already at:\n  ${file}\nNothing was changed. (A new key would stop every installed hub from trusting the catalog.)`);
    return;
  }
  if (brand.catalogPublicKey) {
    console.log(`${shown} already names a hub key, but its private half is not at`);
    console.log(`  ${file}`);
    console.log("If you have it elsewhere, set HUB_KEY to its file. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  console.log("Choose a password for the hub key. You will need it each time the catalog is updated. Each character shows as a star.");
  const one = await askSecret("Password: ");
  if (one.length < 10) {
    console.log("Please use at least 10 characters. Nothing was made.");
    process.exitCode = 1;
    return;
  }
  const two = await askSecret("The same password again: ");
  if (one !== two) {
    console.log("The two did not match. Nothing was made.");
    process.exitCode = 1;
    return;
  }
  const { privatePem, publicB64 } = makeKey(one);
  if (publicOf(privatePem, one) !== publicB64) throw new Error("The new key did not check out.");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, privatePem, { mode: 0o600 });
  writeFileSync(
    join(dirname(file), "README.txt"),
    `This folder holds the private half of the ${brand.productName} catalog key, protected by your password.\r\n` +
      "Keep a backup copy of this folder somewhere safe (not on GitHub). Without it and its password, a new catalog cannot be published\r\n" +
      "for the hubs already installed, and they would need a new hub release with a new key.\r\n",
  );
  brand.catalogPublicKey = publicB64;
  writeFileSync(brandFile, JSON.stringify(brand, null, 2) + "\n");
  console.log(`\nDone.\n  Private half (keep it, back it up, never upload it): ${file}`);
  console.log(`  Public half, now in ${shown}: ${publicB64}`);
  console.log(`\nCommit ${shown}. Hubs built from now on trust catalogs signed with this key.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  main().catch((e) => {
    console.error(`STOPPED: ${e.message}`);
    process.exitCode = 1;
  });
}
