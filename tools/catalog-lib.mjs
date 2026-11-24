// SPDX-License-Identifier: Apache-2.0
// The parts of the catalog script that need no network: choosing releases, building the catalog, comparing it with the published one, and
// signing and checking it with the hub key. tests/catalog-lib.test.mjs tries each.
import { createCipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, scryptSync, sign, verify } from "node:crypto";

/** A version as it sorts, as in the hub (src-tauri/src/version.rs): [a, b, c, stage, n], stage 0 alpha, 1 beta, 2 rc, 3 final. Or null. */
export function versionKey(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(String(text).trim());
  if (!m) return null;
  const stage = m[4] ? { alpha: 0, beta: 1, rc: 2 }[m[4]] : 3;
  return [Number(m[1]), Number(m[2]), Number(m[3]), stage, m[5] ? Number(m[5]) : 0];
}

export function compareVersions(a, b) {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < 5; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export const isPreview = (v) => versionKey(v)[3] < 3;
export const plainVersion = (v) => String(v).replace(/^v/, "");
export const baseVersion = (v) => plainVersion(v).split("-")[0];

/**
 * The newest published stable release and the newest published preview (only when it is newer than the stable one), from GitHub's list of
 * releases. Drafts never count, and neither does a tag that is not a version (such as the catalog's own release).
 */
export function pickReleases(list) {
  const published = list.filter((r) => !r.draft && versionKey(r.tag_name));
  const newest = (rs) => rs.sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] ?? null;
  const stable = newest(published.filter((r) => !isPreview(r.tag_name)));
  let preview = newest(published.filter((r) => isPreview(r.tag_name)));
  if (stable && preview && compareVersions(preview.tag_name, stable.tag_name) < 0) preview = null;
  return { stable, preview };
}

/**
 * A note when GitHub's pre-release mark and the version disagree: the hub decides by the version alone (a pre-release part means a
 * preview), so a release marked pre-release on GitHub with a plain version would be offered as stable. Null when they agree.
 */
export function previewMismatch(release) {
  if (!release || !versionKey(release.tag_name)) return null;
  const byVersion = isPreview(release.tag_name);
  if (Boolean(release.prerelease) === byVersion) return null;
  return byVersion
    ? `${release.tag_name} has a pre-release version but is not marked pre-release on GitHub; the hub shows it as a preview.`
    : `${release.tag_name} is marked pre-release on GitHub but its version has no pre-release part; the hub shows it as stable.`;
}

/** The one asset whose name matches `pattern`, or an error in words. */
export function findAsset(release, pattern, what) {
  const re = new RegExp(pattern);
  const found = release.assets.filter((a) => re.test(a.name));
  if (found.length === 0) return { error: `${what} ${release.tag_name}: no setup file matches ${pattern} (files: ${release.assets.map((a) => a.name).join(", ") || "none"})` };
  if (found.length > 1) return { error: `${what} ${release.tag_name}: more than one file matches ${pattern}: ${found.map((a) => a.name).join(", ")}` };
  return { asset: found[0] };
}

/** The address the hub downloads from: always github.com/<repository>/releases/download/<tag>/<file>. */
export function downloadUrl(repository, tag, name) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

/**
 * The version Windows lists once a release is installed: the release's three numbers (most installers), its whole version when the app's
 * entry sets windowsListsFullVersion (an installer built with the pre-release part in its own version), or a fixed windowsVersion.
 */
export function windowsVersionFor(source, tag) {
  if (source.windowsListsFullVersion) return plainVersion(tag);
  return source.windowsVersion ?? baseVersion(tag);
}

/** A catalog release entry from a GitHub release and its checked setup file. */
export function releaseEntry(repository, release, asset, sha256, windowsVersion) {
  return {
    version: plainVersion(release.tag_name),
    windowsVersion: windowsVersion ?? baseVersion(release.tag_name),
    url: downloadUrl(repository, release.tag_name, asset.name),
    sha256,
    size: asset.size,
    releasePage: `https://github.com/${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`,
  };
}

/** The most one app's icon may be (the hub refuses larger: src-tauri/src/catalog.rs, MOST_ICON_BYTES). */
export const MOST_ICON_BYTES = 32 * 1024;

/**
 * An app's mark for the catalog. When the brand's apps.json names an icon file (mark.icon, an .svg or .png in the brand's folder), the picture
 * is put into the signed catalog as a data: address, so the hub never downloads it separately and has it offline. readFile(path) returns its
 * bytes.
 */
export function markOf(mark, readFile) {
  const out = { letters: mark.letters, color: mark.color };
  if (!mark.icon) return out;
  const kind = /\.svg$/i.test(mark.icon) ? "image/svg+xml" : /\.png$/i.test(mark.icon) ? "image/png" : null;
  if (!kind) throw new Error(`the icon ${mark.icon} is not an .svg or .png file`);
  const bytes = readFile(mark.icon);
  if (bytes.length === 0 || bytes.length > MOST_ICON_BYTES) throw new Error(`the icon ${mark.icon} is ${bytes.length} bytes; it must be between 1 and ${MOST_ICON_BYTES}`);
  if (kind === "image/png" && !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error(`the icon ${mark.icon} is not a PNG picture`);
  if (kind === "image/svg+xml" && /<script|<foreignObject|\son[a-z]+\s*=/i.test(bytes.toString("utf8"))) throw new Error(`the icon ${mark.icon} holds a script; use a plain picture`);
  return { ...out, icon: `data:${kind};base64,${bytes.toString("base64")}` };
}

/** "2026-11-15T18:04:00Z": the date format the hub reads (twenty characters, no fractions of a second). */
export function stamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The catalog's apps entry, from the source facts in the brand's apps.json and the releases found. */
export function appEntry(source, stable, preview, extras) {
  const entry = {
    id: source.id,
    name: source.name,
    mark: source.mark,
    description: source.description ?? "",
    repository: source.repository,
    installedAs: source.installedAs,
    programFile: source.programFile,
    quietSwitch: source.quietSwitch,
    expectedSigner: source.expectedSigner,
    stable,
    preview,
    extras,
  };
  if (source.quietUninstallSwitch) entry.quietUninstallSwitch = source.quietUninstallSwitch;
  if (source.minimumHubVersion) entry.minimumHubVersion = source.minimumHubVersion;
  return entry;
}

/** The lines of the "what changed" table: one per app (and the hub), with the release before and now. */
export function changes(before, after) {
  const rows = [];
  const say = (r) => (r ? r.version : "none");
  const index = (c) => new Map((c?.apps ?? []).map((a) => [a.id, a]));
  const old = index(before);
  for (const app of after.apps) {
    const was = old.get(app.id);
    for (const channel of ["stable", "preview"]) {
      const b = was?.[channel] ?? null;
      const a = app[channel] ?? null;
      const changed = say(b) !== say(a) || b?.sha256 !== a?.sha256;
      rows.push({ name: `${app.name} (${channel})`, before: say(b), now: say(a), changed });
    }
    // Anything else in the entry (the version Windows lists, the program file, the switches, the extras) changing is worth publishing too.
    const rest = (e) => JSON.stringify({ ...e, mark: undefined });
    if (was && rest(was) !== rest(app) && !rows.slice(-2).some((r) => r.changed)) {
      rows.push({ name: `${app.name} (other details)`, before: "as published", now: "changed", changed: true });
    }
    old.delete(app.id);
  }
  for (const gone of old.values()) rows.push({ name: `${gone.name}`, before: "listed", now: "removed", changed: true });
  rows.push({ name: "The hub itself", before: say(before?.hub), now: say(after.hub), changed: say(before?.hub) !== say(after.hub) || before?.hub?.sha256 !== after.hub?.sha256 });
  // An app's icon or round mark changing is a change worth publishing too (OpenStage Hub 1.0.1's catalogs named icons as separate files).
  const marks = (c) => JSON.stringify((c?.apps ?? []).map((a) => [a.id, a.mark]));
  if (marks(before) !== marks(after)) {
    const count = (c) => `${(c?.apps ?? []).filter((a) => a.mark?.icon).length} icons`;
    rows.push({ name: "Icons and marks", before: count(before), now: count(after), changed: true });
  }
  const webBefore = JSON.stringify(before?.web ?? []);
  const webAfter = JSON.stringify(after.web);
  if (webBefore !== webAfter) rows.push({ name: "Web links", before: `${(before?.web ?? []).length}`, now: `${after.web.length}`, changed: true });
  if (JSON.stringify(before?.comingSoon ?? []) !== JSON.stringify(after.comingSoon)) {
    rows.push({ name: "Coming soon", before: `${(before?.comingSoon ?? []).length}`, now: `${after.comingSoon.length}`, changed: true });
  }
  return rows;
}

export function table(rows) {
  const w = [Math.max(4, ...rows.map((r) => r.name.length)), Math.max(6, ...rows.map((r) => r.before.length)), Math.max(3, ...rows.map((r) => r.now.length))];
  const line = (a, b, c, mark = " ") => `${mark} ${a.padEnd(w[0])}  ${b.padEnd(w[1])}  ${c}`;
  return [line("App", "Before", "Now"), ...rows.map((r) => line(r.name, r.before, r.now, r.changed ? "*" : " "))].join("\n");
}

// ---- The hub key -----------------------------------------------------------------------------------------------------------------------

/** One value in DER: its tag, its length, its contents. */
function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  const size = body.length < 0x80 ? [body.length] : body.length < 0x100 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 0xff];
  return Buffer.concat([Buffer.from([tag, ...size]), body]);
}
const derInteger = (n) => {
  const hex = n.toString(16);
  const bytes = Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex");
  return der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
};
const oid = (hex) => der(0x06, Buffer.from(hex, "hex"));

/** How much work each guess at the password costs: 16 MB and eight passes (the most OpenSSL opens without its own limit being raised). */
const SCRYPT = { N: 16384, r: 8, p: 8 };

/**
 * A private key as a password-protected PEM file. The password is stretched with scrypt, which makes guessing it from a stolen file far slower
 * than the 2048 rounds of PBKDF2 that Node uses by itself. The form is standard (PKCS#8, PBES2, scrypt, AES-256-CBC), so Node and OpenSSL open it.
 */
export function protectKey(privateKey, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const key = scryptSync(password, salt, 32, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const secret = privateKey.export({ type: "pkcs8", format: "der" });
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  const scrypt = der(0x30, oid("2b06010401da47040b"), der(0x30, der(0x04, salt), derInteger(SCRYPT.N), derInteger(SCRYPT.r), derInteger(SCRYPT.p), derInteger(32)));
  const aes = der(0x30, oid("60864801650304012a"), der(0x04, iv));
  const pbes2 = der(0x30, oid("2a864886f70d01050d"), der(0x30, scrypt, aes));
  const file = der(0x30, pbes2, der(0x04, body));
  secret.fill(0);
  return `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${file.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ENCRYPTED PRIVATE KEY-----\n`;
}

/** The same key protected again, with scrypt and (if given) a new password. Throws when the old password does not open it. */
export function rewrapKey(privatePem, password, newPassword = password) {
  return protectKey(createPrivateKey({ key: privatePem, passphrase: password }), newPassword);
}

/** Whether a key file's password is stretched with scrypt (looking only at the file's own header, not at the key). */
export const usesScrypt = (privatePem) => {
  const base64 = privatePem.replace(/-----[^-]+-----|\s/g, "");
  return Buffer.from(base64, "base64").includes(Buffer.from("2b06010401da47040b", "hex"));
};

/** A new Ed25519 key pair: the private half as a password-protected PEM, and the public half as the 32 raw bytes in base64 (for brand.json). */
export function makeKey(password) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  return { privatePem: protectKey(privateKey, password), publicB64: spki.subarray(spki.length - 32).toString("base64") };
}

/** The public half (base64 of the 32 raw bytes) of a private key, so the script can check it is the key built into the hub. */
export function publicOf(privatePem, password) {
  const der = createPublicKey(createPrivateKey({ key: privatePem, passphrase: password })).export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("base64");
}

/** The signature file's text: the Ed25519 signature of the exact bytes, in base64. */
export function signBytes(bytes, privatePem, password) {
  return sign(null, bytes, { key: privatePem, passphrase: password }).toString("base64");
}

export function checkSignature(bytes, signatureText, publicB64) {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicB64, "base64")]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return verify(null, bytes, key, Buffer.from(signatureText.trim(), "base64"));
}
