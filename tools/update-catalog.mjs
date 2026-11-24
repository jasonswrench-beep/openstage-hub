// SPDX-License-Identifier: Apache-2.0
// Update <short name> Catalog.bat (Update OpenStage Catalog.bat, Update Prism Catalog.bat) runs this for its brand. It:
//   1. reads each repository's newest stable and preview releases on GitHub (drafts never count) and finds each setup file;
//   2. downloads each setup file it has not checked before, computes its SHA-256 and checks its code signature (valid, timestamped, signed by
//      the expected signer); it STOPS if any setup file is missing or unsigned;
//   3. writes the catalog, with each app's icon inside it as a picture, prints a short table of what changed, asks for the hub key's password
//      and signs it;
//   4. checks the signature with the public key built into the hub (the brand's brand.json), and uploads the catalog and its signature to the
//      release named "catalog" in the hub's repository.
// Until it runs after an app release, the hub keeps offering the previous version, which is safe.
//
//   node tools/update-catalog.mjs --brand <folder>            all of the above
//   node tools/update-catalog.mjs --brand <folder> --local    sign, but do not upload: the files are left in brands/<folder>/out (to try
//                                                              with a development hub)
//   node tools/update-catalog.mjs --brand <folder> --dry-run  find and check everything and show the table; sign and upload nothing
//
// It uses the GitHub command line (gh), signed in as the owner, for reading releases and uploading. Checked setup files are remembered in
// brands/<folder>/work/checked.json by GitHub's own SHA-256 of each file, so a setup file is downloaded once, not on every run.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { appEntry, changes, checkSignature, downloadUrl, findAsset, markOf, pickReleases, previewMismatch, publicOf, releaseEntry, signBytes, stamp, table, windowsVersionFor } from "./catalog-lib.mjs";
import { trustedKeys } from "./catalog-floor.mjs";
import { keyFile } from "./make-hub-key.mjs";
import { askSecret } from "./prompt.mjs";
import { loadBrand, root } from "./brand.mjs";

let chosen;
try {
  chosen = loadBrand();
} catch (e) {
  console.error(`STOPPED: ${e.message}`);
  process.exit(1);
}
const { brand, apps: sources, dir: brandDir } = chosen;
const work = join(brandDir, "work");
const out = join(brandDir, "out");
/** A file's place in the repository, for messages. */
const shown = (file) => relative(root, file).replaceAll("\\", "/");
const checkedFile = join(work, "checked.json");
/** Every setup file that is missing or not properly signed. All are listed together, and then the script stops before signing anything. */
const problems = [];

const say = (w) => console.log(w);
class Stop extends Error {}
const stop = (w) => {
  throw new Stop(w);
};

function gh(args, { json = true, allowFail = false } = {}) {
  const done = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (done.status !== 0) {
    if (allowFail) return null;
    stop(`gh ${args.join(" ")} failed: ${(done.stderr || done.stdout).trim().slice(0, 500)}`);
  }
  return json ? JSON.parse(done.stdout) : done.stdout;
}

function releasesOf(repository) {
  return gh(["api", `repos/${repository}/releases?per_page=100`]);
}

async function download(url, file) {
  const answer = await fetch(url, { redirect: "follow" });
  if (!answer.ok) stop(`downloading ${url} failed (${answer.status}).`);
  await pipeline(Readable.fromWeb(answer.body), createWriteStream(file));
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Windows' own signature check, through PowerShell's Get-AuthenticodeSignature. */
function signatureOf(file) {
  const script =
    `$s = Get-AuthenticodeSignature -LiteralPath $env:HUB_FILE; ` +
    `$n = if ($s.SignerCertificate) { $s.SignerCertificate.GetNameInfo(0, $false) } else { '' }; ` +
    `[pscustomobject]@{ status = "$($s.Status)"; signer = $n; timestamped = [bool]$s.TimeStamperCertificate } | ConvertTo-Json -Compress`;
  const done = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", env: { ...process.env, HUB_FILE: file } });
  if (done.status !== 0) stop(`the signature of ${file} could not be checked: ${done.stderr.trim()}`);
  return JSON.parse(done.stdout);
}

/** Downloads (once) and checks one setup file. Returns its SHA-256. */
async function checked(asset, url, expectedSigner, what, memory) {
  const githubSum = (asset.digest ?? "").replace(/^sha256:/, "");
  const known = githubSum && memory[githubSum];
  if (known && known.size === asset.size && known.signer === expectedSigner) {
    say(`  ${what}: ${asset.name} (checked before)`);
    return githubSum;
  }
  say(`  ${what}: downloading ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB) to check it`);
  const file = join(work, "download.part");
  try {
    await download(url, file);
    const sum = sha256(file);
    if (githubSum && sum !== githubSum) stop(`${what}: the downloaded ${asset.name} does not match GitHub's own SHA-256 of it.`);
    const sig = signatureOf(file);
    const problem =
      sig.status === "NotSigned" ? "is not signed"
      : sig.status !== "Valid" ? `is not validly signed (Windows says ${sig.status})`
      : !sig.timestamped ? "is signed without a timestamp"
      : sig.signer.toLowerCase() !== expectedSigner.toLowerCase() ? `is signed by ${sig.signer}, not ${expectedSigner}`
      : null;
    if (problem) {
      problems.push(`${what}: ${asset.name} ${problem}. If this release came before signing began, add its tag to "ignoreTags" in ${shown(chosen.appsFile)}.`);
      return null;
    }
    memory[sum] = { name: asset.name, size: asset.size, signer: expectedSigner, checked: stamp() };
    writeFileSync(checkedFile, JSON.stringify(memory, null, 1) + "\n");
    return sum;
  } finally {
    rmSync(file, { force: true });
  }
}

/** An app's mark with its icon file (if apps.json names one, in the brand's folder) read into it. */
const markFor = (mark) => markOf(mark, (path) => readFileSync(join(brandDir, path)));

/**
 * Icons as separate files, for hubs older than the one that reads them inside the catalog (OpenStage Hub 1.0.1). Only when apps.json asks for
 * it (alsoPublishIconFiles) and only for PNG icons: each is published beside the catalog as icon-<id>.png and named, with its SHA-256, in the
 * app's `icon` entry, which newer hubs ignore. Returns that entry, or undefined.
 */
const iconFiles = [];
function iconFileEntry(source) {
  if (!sources.alsoPublishIconFiles || !/\.png$/i.test(source.mark?.icon ?? "")) return undefined;
  const file = join(brandDir, source.mark.icon);
  const bytes = readFileSync(file);
  const name = `icon-${source.id}.png`;
  iconFiles.push({ name, file });
  return { url: downloadUrl(brand.repository, brand.catalog.tag, name), sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

/** Whether a repository exists (private counts). Only "not found" means no; any other trouble stops the script. */
function repositoryExists(repository) {
  const done = spawnSync("gh", ["api", `repos/${repository}`, "--silent"], { encoding: "utf8" });
  if (done.status === 0) return true;
  if (/404|Not Found/i.test(done.stderr || done.stdout)) return false;
  stop(`gh could not look up ${repository}: ${(done.stderr || done.stdout).trim().slice(0, 300)}`);
}

async function buildCatalog(memory) {
  // Hubs refuse a catalog that names another owner or another signer (brand.json has the only ones they accept), so such a catalog is never made.
  for (const source of sources.apps) {
    if (source.repository.split("/")[0].toLowerCase() !== brand.allowedOwner.toLowerCase()) problems.push(`${source.name}: ${source.repository} is not ${brand.allowedOwner}'s, so every hub would refuse the catalog.`);
    if (source.expectedSigner.trim().toLowerCase() !== brand.expectedSigner.trim().toLowerCase()) problems.push(`${source.name}: its expectedSigner is not ${brand.expectedSigner}, so every hub would refuse the catalog.`);
  }
  const apps = [];
  const comingSoon = sources.comingSoon.map((c) => (c.mark ? { ...c, mark: markFor(c.mark) } : c));
  for (const source of sources.apps) {
    say(`${source.name} (${source.repository})`);
    // A planned app is left out altogether until its repository has been made.
    if (source.hiddenUntilRepositoryExists && !repositoryExists(source.repository)) {
      say("  (left out until its repository exists)");
      continue;
    }
    const ignored = new Set(source.ignoreTags ?? []);
    const { stable, preview } = pickReleases(releasesOf(source.repository).filter((r) => !ignored.has(r.tag_name)));
    for (const r of [stable, preview]) {
      const note = previewMismatch(r);
      if (note) say(`  NOTE: ${note}`);
    }
    // An app still being made is listed under Coming soon until people can actually download it: a public repository with a release.
    if (source.comingSoonUntilReleased) {
      const visibility = gh(["repo", "view", source.repository, "--json", "visibility"]).visibility;
      if ((!stable && !preview) || visibility !== "PUBLIC") {
        say(`  Coming soon (${visibility !== "PUBLIC" ? `its repository is ${visibility.toLowerCase()}` : "no published release yet"})`);
        comingSoon.push({ id: source.id, name: source.name, description: source.description ?? "", mark: markFor(source.mark), icon: iconFileEntry(source) });
        continue;
      }
    }
    // An app listed before its release (Jason's choice for apps about to come out) is a Desktop row with no release, reading "No release
    // yet", until its repository is public and has one. A release in a private repository is not listed: hubs could not download it.
    if (source.listedBeforeRelease) {
      const visibility = gh(["repo", "view", source.repository, "--json", "visibility"]).visibility;
      if ((!stable && !preview) || visibility !== "PUBLIC") {
        say(`  Listed with no release yet (${visibility !== "PUBLIC" ? `its repository is ${visibility.toLowerCase()}` : "no published release yet"})`);
        const built = appEntry({ ...source, mark: markFor(source.mark) }, null, null, []);
        built.icon = iconFileEntry(source);
        apps.push(built);
        continue;
      }
    }
    if (!stable && !preview) problems.push(`${source.name} has no published release.`);
    const entry = async (release) => {
      if (!release) return null;
      const found = findAsset(release, source.setupPattern, source.name);
      if (found.error) {
        problems.push(found.error);
        return null;
      }
      const url = downloadUrl(source.repository, release.tag_name, found.asset.name);
      const sum = await checked(found.asset, url, source.expectedSigner, `${source.name} ${release.tag_name}`, memory);
      return sum && releaseEntry(source.repository, release, found.asset, sum, windowsVersionFor(source, release.tag_name));
    };
    const stableEntry = await entry(stable);
    const previewEntry = await entry(preview);
    // Extras (a portable copy, an add-on) come from the newest release that carries them; their SHA-256 is GitHub's own, checked by download.
    const extras = [];
    for (const x of source.extras ?? []) {
      const release = [preview, stable].find((r) => r && r.assets.some((a) => new RegExp(x.pattern).test(a.name)));
      if (!release) continue;
      const asset = release.assets.find((a) => new RegExp(x.pattern).test(a.name));
      const file = join(work, "download.part");
      say(`  ${release.tag_name}: downloading ${asset.name} to compute its SHA-256`);
      await download(downloadUrl(source.repository, release.tag_name, asset.name), file);
      extras.push({ name: x.name, description: x.description ?? "", fileName: asset.name, url: downloadUrl(source.repository, release.tag_name, asset.name), sha256: sha256(file), size: asset.size });
      rmSync(file, { force: true });
    }
    const built = appEntry({ ...source, mark: markFor(source.mark) }, stableEntry, previewEntry, extras);
    built.icon = iconFileEntry(source);
    apps.push(built);
  }

  // The hub's own newest release (its catalog release is not a version, so it never counts).
  let hub = null;
  const hubReleases = pickReleases(releasesOf(sources.hub.repository));
  const hubRelease = hubReleases.stable ?? hubReleases.preview;
  if (hubRelease) {
    say(`${brand.productName} (${sources.hub.repository})`);
    const found = findAsset(hubRelease, sources.hub.setupPattern, brand.productName);
    if (found.error) problems.push(found.error);
    else {
      const url = downloadUrl(sources.hub.repository, hubRelease.tag_name, found.asset.name);
      const sum = await checked(found.asset, url, brand.expectedSigner, `${brand.productName} ${hubRelease.tag_name}`, memory);
      hub = sum && releaseEntry(sources.hub.repository, hubRelease, found.asset, sum);
    }
  }
  if (problems.length > 0) stop(`these setup files are missing or not properly signed, so no catalog was made:\n  - ${problems.join("\n  - ")}`);

  const web = sources.web.filter((w) => {
    if (w.url) return true;
    say(`  (left out until it has an address: ${w.name})`);
    return false;
  });
  return { format: 1, generated: stamp(), minimumHubVersion: sources.minimumHubVersion, hub, apps, web, comingSoon };
}

function published() {
  const dir = join(work, "published");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const got = gh(["release", "download", brand.catalog.tag, "--repo", brand.repository, "--pattern", brand.catalog.file, "--dir", dir], { json: false, allowFail: true });
  const file = join(dir, brand.catalog.file);
  return got !== null && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

async function main(argv) {
  const dry = argv.includes("--dry-run");
  const local = argv.includes("--local");
  mkdirSync(work, { recursive: true });
  if (spawnSync("gh", ["auth", "status"], { encoding: "utf8" }).status !== 0) stop("the GitHub command line (gh) is not signed in. Run: gh auth login");
  if (!dry && !brand.catalogPublicKey) stop("there is no hub key yet. Run Make Hub Key.bat first.");
  const visibility = gh(["repo", "view", brand.repository, "--json", "visibility"]).visibility;
  if (visibility !== "PUBLIC") say(`NOTE: ${brand.repository} is ${visibility.toLowerCase()}. Hubs can download the catalog only once the repository is public.\n`);

  const memory = existsSync(checkedFile) ? JSON.parse(readFileSync(checkedFile, "utf8")) : {};
  const catalog = await buildCatalog(memory);
  const before = published();
  const rows = changes(before, catalog);
  say(`\nWhat changed (* marks a change):\n${table(rows)}\n`);
  const bytes = Buffer.from(JSON.stringify(catalog, null, 2) + "\n", "utf8");
  mkdirSync(out, { recursive: true });
  if (dry) {
    writeFileSync(join(out, `${brand.catalog.file}.unsigned`), bytes);
    say(`Dry run: nothing was signed or uploaded. The catalog it would publish is in ${shown(join(out, brand.catalog.file))}.unsigned`);
    return;
  }
  if (before && !rows.some((r) => r.changed)) {
    say("Nothing changed since the published catalog, so nothing was published.");
    return;
  }

  const file = keyFile(chosen.id);
  if (!existsSync(file)) stop(`the hub key's private half is not at ${file}. Set HUB_KEY to where it is.`);
  const pem = readFileSync(file, "utf8");
  const password = await askSecret("The hub key's password: ");
  if (!password) stop("no password was typed. Nothing was signed.");
  let signature;
  let publicKey;
  try {
    publicKey = publicOf(pem, password);
    if (!trustedKeys(brand).includes(publicKey)) stop(`this key is not one built into the hub (${shown(chosen.brandFile)}). Nothing was signed.`);
    signature = signBytes(bytes, pem, password) + "\n";
  } catch (e) {
    if (e instanceof Stop) throw e;
    stop(`the password did not open the hub key. Nothing was signed. To try the password on its own: node tools\\make-hub-key.mjs --brand ${chosen.id} --check`);
  }
  if (!checkSignature(bytes, signature, publicKey)) stop("the new signature did not check out. Nothing was uploaded.");
  const catalogFile = join(out, brand.catalog.file);
  const signatureFile = join(out, brand.catalog.signature);
  writeFileSync(catalogFile, bytes);
  writeFileSync(signatureFile, signature);
  const iconCopies = iconFiles.map((i) => {
    const target = join(out, i.name);
    copyFileSync(i.file, target);
    return target;
  });
  say(`Signed: ${shown(catalogFile)} and its signature${iconCopies.length ? `, with ${iconCopies.length} icon files for older hubs` : ""}.`);
  if (local) {
    say("--local: not uploaded. A development hub reads this folder when HUB_CATALOG_DIR names it.");
    return;
  }

  const exists = gh(["release", "view", brand.catalog.tag, "--repo", brand.repository, "--json", "tagName"], { allowFail: true });
  if (!exists) {
    say(`Making the release "${brand.catalog.tag}" in ${brand.repository}.`);
    gh(
      ["release", "create", brand.catalog.tag, "--repo", brand.repository, "--prerelease", "--title", `${brand.shortName} catalog`, "--notes",
        `The signed list of ${brand.shortName} apps that ${brand.productName} reads. Updated by Update ${brand.shortName} Catalog.bat; not a program release.`],
      { json: false },
    );
  }
  // Both in one upload. A hub that fetches between the two files sees a mismatch and keeps its last good catalog until its next check.
  // The icon files first, so a hub that reads the new catalog finds every one it names.
  if (iconCopies.length) gh(["release", "upload", brand.catalog.tag, ...iconCopies, "--repo", brand.repository, "--clobber"], { json: false });
  gh(["release", "upload", brand.catalog.tag, signatureFile, catalogFile, "--repo", brand.repository, "--clobber"], { json: false });
  say(`Published to https://github.com/${brand.repository}/releases/tag/${brand.catalog.tag}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`\nSTOPPED: ${e.message}`);
    process.exitCode = 1;
  });
}
