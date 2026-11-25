// SPDX-License-Identifier: Apache-2.0
// node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appEntry, baseVersion, changes, checkSignature, compareVersions, downloadUrl, findAsset, makeKey, markOf, MOST_ICON_BYTES, pickReleases, previewMismatch, protectKey, publicOf, releaseEntry, rewrapKey, signBytes, stamp, usesScrypt,
  windowsVersionFor,
} from "../tools/catalog-lib.mjs";
import { brandIds, loadBrand, root } from "../tools/brand.mjs";
import { branded } from "../tools/apply-brand.mjs";
import { floorProblem, trustedKeys } from "../tools/catalog-floor.mjs";
import { generateKeyPairSync } from "node:crypto";
import { signatureProblem } from "../tools/signature.mjs";

const rel = (tag, draft = false, assets = []) => ({ tag_name: tag, draft, assets });

test("versions sort the way the hub sorts them", () => {
  const order = ["0.1.0-alpha.1", "0.1.0-alpha.10", "0.1.0-beta.1", "0.1.0-rc.1", "0.1.0", "0.2.0-alpha.1", "1.0.0"];
  for (let i = 1; i < order.length; i++) assert.ok(compareVersions(order[i], order[i - 1]) > 0, `${order[i - 1]} < ${order[i]}`);
  assert.equal(baseVersion("v0.2.0-alpha.4"), "0.2.0");
});

test("drafts and non-version tags never count, and an older preview is left out", () => {
  // As GitHub showed OpenStage Recorder on 2026-11-15: v0.1.0 exists only as a draft.
  const recorder = [rel("v0.1.0-alpha.3", true), rel("v0.1.0", true), rel("v0.1.0-alpha.4"), rel("v0.1.0-alpha.3"), rel("catalog")];
  const r = pickReleases(recorder);
  assert.equal(r.stable, null);
  assert.equal(r.preview.tag_name, "v0.1.0-alpha.4");
  const both = pickReleases([rel("v0.1.1"), rel("v0.2.0-alpha.4"), rel("v0.1.0")]);
  assert.equal(both.stable.tag_name, "v0.1.1");
  assert.equal(both.preview.tag_name, "v0.2.0-alpha.4");
  const passed = pickReleases([rel("v0.2.0"), rel("v0.2.0-rc.1")]);
  assert.equal(passed.preview, null, "a preview older than the stable release is not listed");
});

test("a note when GitHub's pre-release mark and the version disagree", () => {
  assert.equal(previewMismatch({ tag_name: "v0.2.1", prerelease: false }), null);
  assert.equal(previewMismatch({ tag_name: "v0.1.0-beta.2", prerelease: true }), null);
  assert.match(previewMismatch({ tag_name: "v0.1.2", prerelease: true }), /shows it as stable/);
  assert.match(previewMismatch({ tag_name: "v0.1.0-alpha.5", prerelease: false }), /shows it as a preview/);
  assert.equal(previewMismatch(null), null);
});

test("exactly one setup file must match", () => {
  const r = rel("v0.1.0-alpha.5", false, [{ name: "OpenStage-Author-0.1.0-alpha.5-Setup.exe", size: 5 }, { name: "OpenStage-Author-0.1.0-alpha.5-Setup.exe.sha256.txt", size: 1 }]);
  assert.equal(findAsset(r, "^OpenStage-Author.*[Ss]etup\\.exe$", "Author").asset.name, "OpenStage-Author-0.1.0-alpha.5-Setup.exe");
  assert.match(findAsset(r, "^Nothing$", "Author").error, /no setup file matches/);
  assert.match(findAsset(r, "^OpenStage", "Author").error, /more than one/);
});

test("every app's setup pattern matches the file names its releases have used, in every brand", () => {
  for (const id of brandIds()) {
    const { dir, apps: sources } = loadBrand(id);
    const names = JSON.parse(readFileSync(join(dir, "setup-names.json"), "utf8"));
    for (const app of sources.apps) {
      const seen = names.setups[app.id];
      assert.ok(seen?.length, `${id}/${app.id}: setup-names.json lists its setup file names`);
      for (const name of seen) assert.match(name, new RegExp(app.setupPattern), `${id}/${app.id}`);
      assert.doesNotMatch(`${seen[0]}.sha256.txt`, new RegExp(app.setupPattern), `${id}/${app.id}: the checksum file must not match`);
      for (const other of names.notSetups) assert.doesNotMatch(other, new RegExp(app.setupPattern), `${id}/${app.id}: ${other} is not a setup`);
    }
  }
});

test("a release entry points at github.com and keeps Windows' version", () => {
  const r = rel("v0.2.0-alpha.4");
  const e = releaseEntry("jasonswrench-beep/OpenExplainer", r, { name: "OpenExplainer-0.2.0-alpha.4-Setup.exe", size: 15247912 }, "ab".repeat(32));
  assert.equal(e.url, "https://github.com/jasonswrench-beep/OpenExplainer/releases/download/v0.2.0-alpha.4/OpenExplainer-0.2.0-alpha.4-Setup.exe");
  assert.equal(e.windowsVersion, "0.2.0");
  assert.equal(e.version, "0.2.0-alpha.4");
  assert.equal(downloadUrl("o/r", "v1", "A B.exe"), "https://github.com/o/r/releases/download/v1/A%20B.exe");
  assert.equal(stamp(new Date("2026-11-15T18:04:00.123Z")), "2026-11-15T18:04:00Z");
  // What Windows lists after the install: the three numbers, the whole version (Prism Transcribe's installer), or a fixed value.
  assert.equal(windowsVersionFor({}, "v0.1.0-alpha.1"), "0.1.0");
  assert.equal(windowsVersionFor({ windowsListsFullVersion: true }, "v0.1.0-alpha.1"), "0.1.0-alpha.1");
  assert.equal(windowsVersionFor({ windowsListsFullVersion: true }, "v0.2.0"), "0.2.0");
  assert.equal(windowsVersionFor({ windowsVersion: "1.2.3.4" }, "v1.2.3"), "1.2.3.4");
});

test("the change table marks what changed", () => {
  const app = (v) => appEntry({ id: "x", name: "X", mark: {}, repository: "o/x", installedAs: "X", programFile: "x.exe", quietSwitch: ["/P"], expectedSigner: "J" }, null, { version: v, sha256: v }, []);
  const before = { apps: [app("0.1.0-alpha.1")], hub: null, web: [], comingSoon: [] };
  const after = { apps: [app("0.1.0-alpha.2")], hub: null, web: [], comingSoon: [] };
  const rows = changes(before, after);
  assert.ok(rows.find((r) => r.name === "X (preview)").changed);
  assert.ok(!rows.find((r) => r.name === "X (stable)").changed);
  assert.ok(!changes(after, after).some((r) => r.changed));
  // The same release with only the version Windows lists corrected (Prism Transcribe, 2026-11-18) is a change too.
  const fixed = { ...after, apps: [{ ...after.apps[0], preview: { ...after.apps[0].preview, windowsVersion: "0.1.0-alpha.2" } }] };
  assert.ok(changes(after, fixed).find((r) => r.name === "X (other details)")?.changed);
  assert.ok(!changes(fixed, fixed).some((r) => r.changed));
});

test("a catalog signed with the hub key checks out, and one changed byte does not", () => {
  const { privatePem, publicB64 } = makeKey("a long test password");
  assert.equal(Buffer.from(publicB64, "base64").length, 32);
  assert.equal(publicOf(privatePem, "a long test password"), publicB64);
  assert.throws(() => publicOf(privatePem, "wrong password"));
  assert.match(privatePem, /ENCRYPTED PRIVATE KEY/, "the private half is kept with its password");
  const bytes = Buffer.from('{"format":1}\n');
  const sig = signBytes(bytes, privatePem, "a long test password");
  assert.ok(checkSignature(bytes, sig, publicB64));
  const changed = Buffer.from(bytes);
  changed[2] ^= 1;
  assert.ok(!checkSignature(changed, sig, publicB64));
});

test("an app's icon file goes into the catalog as a picture, and only a small plain picture", () => {
  for (const id of brandIds()) {
    const { dir, apps: sources } = loadBrand(id);
    const fromBrand = (path) => readFileSync(join(dir, path));
    for (const app of sources.apps) {
      const m = markOf(app.mark, fromBrand);
      assert.equal(m.letters, app.mark.letters);
      if (app.mark.icon) assert.match(m.icon, /^data:image\/(svg\+xml|png);base64,/, `${id}/${app.id}: its icon is carried in the catalog`);
    }
  }
  const fromNowhere = () => assert.fail("no file is read without an icon");
  assert.deepEqual(markOf({ letters: "ab", color: "#123456" }, fromNowhere), { letters: "ab", color: "#123456" }, "no icon: letters and colour only");
  const file = (text) => () => Buffer.from(text);
  assert.throws(() => markOf({ letters: "ab", color: "#123456", icon: "x.svg" }, file('<svg><script>alert(1)</script></svg>')), /script/);
  assert.throws(() => markOf({ letters: "ab", color: "#123456", icon: "x.svg" }, file('<svg onload="alert(1)"></svg>')), /script/);
  assert.throws(() => markOf({ letters: "ab", color: "#123456", icon: "x.gif" }, file("GIF89a")), /not an .svg or .png/);
  assert.throws(() => markOf({ letters: "ab", color: "#123456", icon: "x.png" }, file("<svg></svg>")), /not a PNG/);
  assert.throws(() => markOf({ letters: "ab", color: "#123456", icon: "x.png" }, () => Buffer.alloc(MOST_ICON_BYTES + 1)), /bytes/);
});

test("every brand has what the build and the hub need, and no brand value of one is in the other", () => {
  const ids = brandIds();
  assert.ok(ids.length >= 2, "both hubs are built from this code");
  const all = ids.map((id) => loadBrand(id));
  for (const { id, dir, brand, apps } of all) {
    for (const key of ["productName", "shortName", "identifier", "programName", "startMenuFolder", "publisher", "icon", "repository", "catalogPublicKey", "expectedSigner", "allowedOwner", "minimumCatalogDate"]) {
      assert.ok(typeof brand[key] === "string" && brand[key], `${id}: brand.json has ${key}`);
    }
    // The trust anchors: every app the catalog could list must be one the hub accepts.
    const owner = brand.allowedOwner.toLowerCase();
    for (const repository of [brand.repository, ...apps.apps.map((a) => a.repository)]) {
      assert.equal(repository.split("/")[0].toLowerCase(), owner, `${id}: ${repository} is ${brand.allowedOwner}'s`);
    }
    for (const app of apps.apps) assert.equal(app.expectedSigner, brand.expectedSigner, `${id}/${app.id}: its signer is the brand's`);
    assert.ok(brand.signerIssuers.length && brand.signerIssuers.every((i) => i.trim().length > 5), `${id}: brand.json names who may issue the signing certificate`);
    assert.ok(brand.signerSubject.length && brand.signerSubject.every((p) => /^[A-Z]+=./.test(p)), `${id}: brand.json names parts of the certificate's subject`);
    assert.ok(brand.signerIdentities.length && brand.signerIdentities.every((i) => /^1\.3\.6\.1\.4\.1\.311\.97(\.\d+){4,}$/.test(i)), `${id}: brand.json names the signer's identity number`);
    assert.match(brand.minimumCatalogDate, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, `${id}: minimumCatalogDate is a catalog's date`);
    assert.ok(brand.catalogBackupKey === "" || Buffer.from(brand.catalogBackupKey, "base64").length === 32, `${id}: the backup key's public half, or none yet`);
    assert.notEqual(brand.catalogBackupKey, brand.catalogPublicKey, `${id}: the backup key is another key`);
    assert.ok(existsSync(join(dir, brand.icon)), `${id}: its icon ${brand.icon} is in its folder`);
    for (const name of ["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico", "icon.png", "tray.png", "tray-dot.png"]) {
      assert.ok(existsSync(join(dir, "app-icons", name)), `${id}: app-icons/${name} (tools/make-icons.mjs makes it)`);
    }
    assert.equal(apps.hub.repository, brand.repository, `${id}: the hub's releases are in its own repository`);
    for (const app of apps.apps.filter((a) => a.hiddenUntilRepositoryExists)) {
      assert.ok(app.comingSoonUntilReleased || app.listedBeforeRelease, `${id}/${app.id}: a planned app is listed once its repository exists, until it is released`);
    }
    for (const app of apps.apps) {
      assert.ok(!(app.comingSoonUntilReleased && app.listedBeforeRelease), `${id}/${app.id}: Coming soon or Desktop before release, not both`);
    }
    assert.equal(Buffer.from(brand.catalogPublicKey, "base64").length, 32, `${id}: the hub key's public half`);
  }
  for (const key of ["identifier", "programName", "repository", "catalogPublicKey"]) {
    assert.equal(new Set(all.map((b) => b.brand[key])).size, all.length, `each brand has its own ${key}`);
  }
  const conf = branded(JSON.parse(readFileSync(join(root, "src-tauri", "tauri.base.json"), "utf8")), all[0].brand, all[0].id);
  assert.equal(conf.identifier, all[0].brand.identifier);
  assert.ok(conf.bundle.icon.every((p) => p.startsWith(`../brands/${all[0].id}/app-icons/`)), "the program icons come from the brand's folder");
});

test("the scripts refuse a signature the hubs would refuse", () => {
  for (const id of brandIds()) {
    const { brand } = loadBrand(id);
    const ours = {
      status: "Valid", timestamped: true, signer: brand.expectedSigner, subject: `CN=${brand.expectedSigner}, ${brand.signerSubject.join(", ")}`,
      issuer: `${brand.signerIssuers[0]}AOC CA 04`, usages: ["1.3.6.1.5.5.7.3.3", brand.signerIdentities[0]],
    };
    assert.equal(signatureProblem(ours, brand), null);
    const refused = (change, words) => assert.match(signatureProblem({ ...ours, ...change }, brand) ?? "accepted", words);
    refused({ status: "NotSigned" }, /is not signed/);
    refused({ status: "HashMismatch" }, /HashMismatch/);
    refused({ timestamped: false }, /without a timestamp/);
    refused({ signer: "Someone Else" }, /signed by Someone Else/);
    refused({ subject: "CN=Jason Wrench, O=Other, C=US" }, /subject/);
    refused({ issuer: "Some Other CA" }, /issued by Some Other CA/);
    refused({ usages: ["1.3.6.1.5.5.7.3.3", `${brand.signerIdentities[0]}1`] }, /identity number/);
    refused({ usages: [] }, /identity number/);
    refused({ usages: null }, /identity number/);
    assert.equal(signatureProblem({ ...ours, usages: brand.signerIdentities[0] }, brand), null, "PowerShell writes a list of one as the one");
  }
});

test("a hub key file is protected with scrypt, and rewrapping keeps the same key", () => {
  const password = "four unrelated words here";
  const { privatePem, publicB64 } = makeKey(password);
  assert.ok(usesScrypt(privatePem), "new keys are protected with scrypt");
  assert.match(privatePem, /^-----BEGIN ENCRYPTED PRIVATE KEY-----/);
  assert.equal(publicOf(privatePem, password), publicB64);
  assert.throws(() => publicOf(privatePem, "another password"));

  // A key file made the older way (PBKDF2, as the hub keys were), rewrapped.
  const { privateKey } = generateKeyPairSync("ed25519");
  const oldPem = privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "the old password" });
  assert.ok(!usesScrypt(oldPem));
  const before = publicOf(oldPem, "the old password");
  const same = rewrapKey(oldPem, "the old password");
  assert.ok(usesScrypt(same));
  assert.equal(publicOf(same, "the old password"), before, "the same key");
  const changed = rewrapKey(oldPem, "the old password", password);
  assert.equal(publicOf(changed, password), before, "the same key, with a new password");
  assert.throws(() => publicOf(changed, "the old password"));
  assert.throws(() => rewrapKey(oldPem, "wrong"), "the old password is needed");
  // A catalog signed with the rewrapped key checks against the same public half.
  const bytes = Buffer.from("{}");
  assert.ok(checkSignature(bytes, signBytes(bytes, changed, password), before));
});

test("the oldest catalog a hub accepts is never newer than the published one", () => {
  assert.deepEqual(floorProblem("2026-11-18T04:11:48Z", "2026-11-18T04:11:48Z"), {});
  assert.match(floorProblem("2026-11-18T04:11:49Z", "2026-11-18T04:11:48Z").stop, /would refuse it/);
  assert.match(floorProblem("2026-11-01T00:00:00Z", "2026-11-18T04:11:48Z").note, /safe/);
  assert.match(floorProblem("", "2026-11-18T04:11:48Z").stop, /no minimumCatalogDate/);
  assert.match(floorProblem(undefined, "2026-11-18T04:11:48Z").stop, /no minimumCatalogDate/);
  assert.deepEqual(trustedKeys({ catalogPublicKey: "a", catalogBackupKey: "" }), ["a"]);
  assert.deepEqual(trustedKeys({ catalogPublicKey: "a", catalogBackupKey: "b" }), ["a", "b"]);
});
