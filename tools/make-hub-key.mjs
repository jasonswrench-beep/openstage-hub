// SPDX-License-Identifier: Apache-2.0
// Makes a hub's key: a new Ed25519 key pair, separate from the apps' update keys, that signs that hub's catalog and its own updates. Each hub has
// its own key.
//   - The private half is saved with your password, OUTSIDE the repository (by default in "<product name> key" in your user folder, for example
//     "OpenStage Hub key"; set HUB_KEY to put it somewhere else). It never goes on GitHub. Keep a backup copy somewhere safe, with the password.
//   - The public half is written into the brand's brand.json (catalogPublicKey), so it is built into every hub from now on.
// It refuses to replace a key that already exists: a new key would mean every hub already installed stops trusting the catalog.
//
//   node tools/make-hub-key.mjs --brand <folder>            make it (with no --brand it asks which hub)
//   node tools/make-hub-key.mjs --brand <folder> --check    ask for the password and say whether it opens the key; change nothing
//   node tools/make-hub-key.mjs --brand <folder> --rewrap   protect the SAME key better (and, if you like, with a new password). Hubs notice
//                                                           nothing; the old file is kept beside it until you delete it
//   node tools/make-hub-key.mjs --brand <folder> --backup   make a second key, to keep offline. Hubs built from then on trust catalogs signed
//                                                           with either, so losing one does not strand them
// --check and --rewrap work on the backup key too, with --backup.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeKey, publicOf, rewrapKey, usesScrypt } from "./catalog-lib.mjs";
import { ask, askSecret } from "./prompt.mjs";
import { brandIds, loadBrand, root } from "./brand.mjs";

/** Where the brand's hub key (or its offline backup key) is kept (HUB_KEY overrides it). */
export const keyFile = (id, backup = false) => {
  const b = loadBrand(id).brand;
  const [folder, name] = backup ? [`${b.productName} backup key`, `${b.programName}-catalog-backup-key.pem`] : [`${b.productName} key`, `${b.programName}-catalog-key.pem`];
  return process.env.HUB_KEY || join(homedir(), folder, name);
};

/** A new password must be at least this long: a stolen key file can be guessed at for as long as the thief likes. */
export const LEAST_PASSWORD = 20;

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

/** Asks for a new password twice, or says why it cannot be used. */
async function newPassword() {
  const one = await askSecret("Password: ");
  if (one.length < LEAST_PASSWORD) {
    console.log(`Please use at least ${LEAST_PASSWORD} characters (a few unrelated words is easy to type). Nothing was made.`);
    return null;
  }
  if (one !== (await askSecret("The same password again: "))) {
    console.log("The two did not match. Nothing was made.");
    return null;
  }
  return one;
}

/** --rewrap: the same key, protected again. The new file is opened and compared before it takes the old one's place, and the old one is kept. */
async function rewrap(file, pinned, shown) {
  if (!existsSync(file)) throw new Error(`there is no hub key at ${file}.`);
  const pem = readFileSync(file, "utf8");
  if (usesScrypt(pem)) console.log("This key is already protected with scrypt. You can still give it a new password.");
  const password = await askSecret("The hub key's password now: ");
  let pub;
  try {
    pub = publicOf(pem, password);
  } catch {
    throw new Error("that password does not open the hub key. Nothing was changed.");
  }
  if (pub !== pinned) throw new Error(`that key is NOT the one in ${shown}. Nothing was changed.`);
  let next = password;
  if (/^y/i.test(await ask("Give it a new password too? (y or n) "))) {
    next = await newPassword();
    if (next === null) {
      process.exitCode = 1;
      return;
    }
  }
  const fresh = `${file}.new`;
  const old = `${file}.old`;
  if (existsSync(old)) throw new Error(`${old} is already there, from an earlier change. Check that your key works, delete that file, and run this again.`);
  writeFileSync(fresh, rewrapKey(pem, password, next), { mode: 0o600 });
  if (publicOf(readFileSync(fresh, "utf8"), next) !== pub || !usesScrypt(readFileSync(fresh, "utf8"))) {
    rmSync(fresh, { force: true });
    throw new Error("the new file did not check out. Nothing was changed.");
  }
  copyFileSync(file, old);
  renameSync(fresh, file);
  console.log(`\nDone. The same key, protected with scrypt: ${file}`);
  console.log(`The file as it was is kept at ${old}. Run this again with --check, make a new backup copy, then delete that file`);
  console.log("and any older copies: they are still protected the old way (and with the old password).");
}

/** --check: asks for the password and says whether it opens the key and whether that key is the one in brand.json. Changes nothing. */
async function check(file, pinned, shown) {
  if (!existsSync(file)) {
    console.log(`There is no hub key at ${file}.`);
    process.exitCode = 1;
    return;
  }
  const password = await askSecret("The hub key's password: ");
  try {
    const pub = publicOf(readFileSync(file, "utf8"), password);
    console.log(pub === pinned
      ? "The password opens the hub key, and it is the key built into the hub."
      : `The password opens the key, but it is NOT the key in ${shown}.`);
    console.log(usesScrypt(readFileSync(file, "utf8")) ? "Its file is protected with scrypt." : "Its file is protected the older way; --rewrap protects the same key better.");
  } catch {
    console.log("That password does not open the hub key.");
    process.exitCode = 1;
  }
}

async function main() {
  const { id, brandFile, brand } = loadBrand(await whichBrand());
  const shown = relative(root, brandFile).replaceAll("\\", "/");
  const backup = process.argv.includes("--backup");
  const field = backup ? "catalogBackupKey" : "catalogPublicKey";
  const file = keyFile(id, backup);
  console.log(`${brand.productName}: its ${backup ? "offline backup key" : "hub key"}.`);
  if (process.argv.includes("--check")) return check(file, brand[field], shown);
  if (process.argv.includes("--rewrap")) return rewrap(file, brand[field], shown);
  if (existsSync(file)) {
    console.log(`A hub key is already at:\n  ${file}\nNothing was changed. (A new key would stop every installed hub from trusting the catalog.)`);
    return;
  }
  if (brand[field]) {
    console.log(`${shown} already names a hub key, but its private half is not at`);
    console.log(`  ${file}`);
    console.log("If you have it elsewhere, set HUB_KEY to its file. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  console.log("Choose a password for the hub key. You will need it each time the catalog is updated. Each character shows as a star.");
  const one = await newPassword();
  if (one === null) {
    process.exitCode = 1;
    return;
  }
  const { privatePem, publicB64 } = makeKey(one);
  if (publicOf(privatePem, one) !== publicB64) throw new Error("The new key did not check out.");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, privatePem, { mode: 0o600 });
  writeFileSync(
    join(dirname(file), "README.txt"),
    `This folder holds the private half of the ${brand.productName} catalog ${backup ? "backup " : ""}key, protected by your password.\r\n` +
      "Keep a backup copy of this folder somewhere safe (not on GitHub). Without it and its password, a new catalog cannot be published\r\n" +
      "for the hubs already installed, and they would need a new hub release with a new key.\r\n",
  );
  // Only this one value is changed, so the rest of the file keeps its layout.
  const text = readFileSync(brandFile, "utf8");
  const written = text.replace(new RegExp(`("${field}":\\s*")[^"]*(")`), `$1${publicB64}$2`);
  if (written === text) throw new Error(`${shown} has no ${field} line to write the public half into. It is ${publicB64}`);
  writeFileSync(brandFile, written);
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
