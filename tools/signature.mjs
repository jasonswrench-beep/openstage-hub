// SPDX-License-Identifier: Apache-2.0
// Whether a signed file is one the hubs will accept: the same rule as src-tauri/src/trust.rs, with the same values from brand.json. The catalog
// script and the installer build use it, so that a signature the hubs would refuse (a new certificate identity, another issuing authority) stops
// them before anything is published.
import { spawnSync } from "node:child_process";

/** Windows' own signature check of a file, and what its certificate says, through PowerShell. Throws when it could not be asked. */
export function signatureOf(file) {
  const script =
    `$s = Get-AuthenticodeSignature -LiteralPath $env:HUB_FILE; $c = $s.SignerCertificate; ` +
    `$n = ''; $i = ''; $d = ''; $u = @(); ` +
    `if ($c) { $n = $c.GetNameInfo(0, $false); $i = $c.GetNameInfo(0, $true); $d = $c.Subject; ` +
    `foreach ($x in $c.Extensions) { if ($x.Oid.Value -eq '2.5.29.37') { $u = @($x.EnhancedKeyUsages | ForEach-Object { $_.Value }) } } } ` +
    `[pscustomobject]@{ status = "$($s.Status)"; signer = $n; issuer = $i; subject = $d; usages = $u; timestamped = [bool]$s.TimeStamperCertificate } | ConvertTo-Json -Compress`;
  const done = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", env: { ...process.env, HUB_FILE: file } });
  if (done.status !== 0) throw new Error(`the signature of ${file} could not be checked: ${(done.stderr ?? "").trim()}`);
  return JSON.parse(done.stdout);
}

/** Why the hubs would refuse this signature ("is not signed"), or null when they accept it. */
export function signatureProblem(sig, brand) {
  if (sig.status === "NotSigned") return "is not signed";
  if (sig.status !== "Valid") return `is not validly signed (Windows says ${sig.status})`;
  if (!sig.timestamped) return "is signed without a timestamp";
  if (sig.signer.trim().toLowerCase() !== brand.expectedSigner.trim().toLowerCase()) return `is signed by ${sig.signer}, not ${brand.expectedSigner}`;
  const parts = sig.subject.split(",").map((p) => p.trim().toLowerCase());
  const missing = brand.signerSubject.find((p) => !parts.includes(p.toLowerCase()));
  if (missing) return `is signed with a certificate whose subject has no ${missing}`;
  if (!brand.signerIssuers.some((i) => i.trim() && sig.issuer.toLowerCase().startsWith(i.toLowerCase()))) return `is signed with a certificate issued by ${sig.issuer}, which brand.json's signerIssuers does not allow`;
  const usages = [].concat(sig.usages ?? []);
  if (!brand.signerIdentities.some((id) => usages.includes(id))) {
    return `is signed with a certificate that does not carry an identity number in brand.json's signerIdentities (it carries ${usages.join(", ") || "none"}). Hubs already installed would refuse it`;
  }
  return null;
}
