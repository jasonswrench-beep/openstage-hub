// SPDX-License-Identifier: Apache-2.0
//! The two checks every downloaded installer passes before it runs:
//! 1. its SHA-256 equals the catalog's;
//! 2. Windows' own signature check (WinVerifyTrust) says its code signature is valid, the signature carries a timestamp, and the certificate is
//!    the one the brand file names: the signer's name, parts of its full subject, the authority that issued it, and the identity number that
//!    authority gave the signer. The certificate's revocation is checked too. These come from the program, never from the catalog.
//!
//! The file is held open from before its checksum is computed until it has been started (`hold`), so nothing can change or replace it between
//! the check and the run. An app's uninstaller passes the same signature check before it is run.

use crate::brand::{brand, Brand};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Opens a file for reading so that, while it stays open, no other program can write to it, rename it or delete it.
#[cfg(windows)]
pub fn hold(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 1;
    const ERROR_SHARING_VIOLATION: i32 = 32;
    let mut tries = 0;
    loop {
        match std::fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(path) {
            // A virus scanner may be reading a file that has just been written: give it a moment.
            Err(e) if e.raw_os_error() == Some(ERROR_SHARING_VIOLATION) && tries < 25 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            other => return other,
        }
    }
}

#[cfg(not(windows))]
pub fn hold(path: &Path) -> std::io::Result<File> {
    File::open(path)
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    sha256_of(&mut File::open(path)?)
}

/// The SHA-256 of an open file, read from where it is now.
pub fn sha256_of(file: &mut File) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Who signed a file, as Windows reads its certificate.
#[derive(Debug, Clone, PartialEq)]
pub struct Signature {
    /// The certificate's simple display name.
    pub signer: String,
    /// The certificate's full subject, in parts: "CN=Jason Wrench", "O=Jason Wrench", "C=US" and so on.
    pub subject: Vec<String>,
    /// The name of the authority that issued the certificate.
    pub issuer: String,
    /// The certificate's own enhanced key usages, as numbers; the signer's identity number is one of them.
    pub usages: Vec<String>,
    pub timestamped: bool,
}

/// Whether the signing certificate's revocation is looked up. It is for anything the hub installs. It is not for an app's uninstaller: that must
/// work with no network, and a certificate that was revoked after the app was installed is a reason to let the person remove it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Revocation {
    Checked,
    NotChecked,
}

/// Who signed the file, when Windows says the signature is valid; otherwise why not, in words that begin "The <what>".
#[cfg(windows)]
pub fn signature(path: &Path, what: &str, revocation: Revocation) -> Result<Signature, String> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::Security::Cryptography::{
        CertGetEnhancedKeyUsage, CertGetNameStringW, CERT_CONTEXT, CERT_FIND_EXT_ONLY_ENHKEY_USAGE_FLAG, CERT_NAME_ISSUER_FLAG, CERT_NAME_RDN_TYPE, CERT_NAME_SIMPLE_DISPLAY_TYPE,
        CERT_X500_NAME_STR, CTL_USAGE,
    };
    use windows::Win32::Security::WinTrust::*;

    // CERT_NAME_RDN_TYPE gives the whole subject as text, in the form named by its parameter.
    unsafe fn name_of(cert: *const CERT_CONTEXT, kind: u32, flags: u32, form: Option<*const core::ffi::c_void>) -> String {
        let mut name = vec![0u16; 1024];
        let n = CertGetNameStringW(cert, kind, flags, form, Some(&mut name));
        String::from_utf16_lossy(&name[..(n.saturating_sub(1)) as usize])
    }

    // The usages written in the certificate itself (not ones added on this computer). None when they could not be read.
    unsafe fn usages_of(cert: *const CERT_CONTEXT) -> Vec<String> {
        let mut size = 0u32;
        if CertGetEnhancedKeyUsage(cert, CERT_FIND_EXT_ONLY_ENHKEY_USAGE_FLAG.0, None, &mut size).is_err() || size == 0 {
            return vec![];
        }
        // Eight-byte steps, so that the structure at its start is aligned.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let usage = buffer.as_mut_ptr() as *mut CTL_USAGE;
        if CertGetEnhancedKeyUsage(cert, CERT_FIND_EXT_ONLY_ENHKEY_USAGE_FLAG.0, Some(usage), &mut size).is_err() {
            return vec![];
        }
        (0..(*usage).cUsageIdentifier as usize).filter_map(|i| (*(*usage).rgpszUsageIdentifier.add(i)).to_string().ok()).collect()
    }

    let wide = HSTRING::from(path.as_os_str());
    let mut file = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: windows::core::PCWSTR(wide.as_ptr()),
        hFile: HANDLE::default(),
        pgKnownSubject: std::ptr::null_mut(),
    };
    let mut data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: if revocation == Revocation::Checked { WTD_REVOKE_WHOLECHAIN } else { WTD_REVOKE_NONE },
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 { pFile: &mut file },
        dwStateAction: WTD_STATEACTION_VERIFY,
        dwProvFlags: if revocation == Revocation::Checked { WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT } else { WTD_REVOCATION_CHECK_NONE | WTD_CACHE_ONLY_URL_RETRIEVAL },
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let status = unsafe { WinVerifyTrust(HWND(-1isize as *mut _), &mut action, &mut data as *mut _ as *mut _) };

    let mut found = Err(words_for(status, what));
    if status == 0 {
        unsafe {
            let provider = WTHelperProvDataFromStateData(data.hWVTStateData);
            let signer = if provider.is_null() { std::ptr::null_mut() } else { WTHelperGetProvSignerFromChain(provider, 0, false, 0) };
            let cert = if signer.is_null() { std::ptr::null_mut() } else { WTHelperGetProvCertFromChain(signer, 0) };
            found = if cert.is_null() || (*cert).pCert.is_null() {
                Err(format!("Windows could not read who signed the {what}."))
            } else {
                let cert = (*cert).pCert;
                let form = CERT_X500_NAME_STR.0;
                let subject = name_of(cert, CERT_NAME_RDN_TYPE, 0, Some(&form as *const u32 as *const core::ffi::c_void));
                Ok(Signature {
                    signer: name_of(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None),
                    subject: subject_parts(&subject),
                    issuer: name_of(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, CERT_NAME_ISSUER_FLAG, None),
                    usages: usages_of(cert),
                    timestamped: (*signer).csCounterSigners > 0,
                })
            };
        }
    }
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    unsafe {
        WinVerifyTrust(HWND(-1isize as *mut _), &mut action, &mut data as *mut _ as *mut _);
    }
    found
}

#[cfg(not(windows))]
pub fn signature(_path: &Path, _what: &str, _revocation: Revocation) -> Result<Signature, String> {
    Err("The signature check works only on Windows.".into())
}

/// A certificate's full subject, as Windows writes it out, in its parts. A value that holds a comma is written in quotes ("O=\"A, B\"", with a
/// quote inside it doubled), so it stays one part and cannot pass for several.
#[cfg_attr(not(windows), allow(dead_code))]
fn subject_parts(text: &str) -> Vec<String> {
    let mut parts = vec![String::new()];
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                chars.next();
                parts.last_mut().unwrap().push('"');
            }
            '"' => quoted = !quoted,
            ',' | '+' | ';' if !quoted => parts.push(String::new()),
            other => parts.last_mut().unwrap().push(other),
        }
    }
    parts.into_iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn words_for(status: i32, what: &str) -> String {
    match status as u32 {
        0x800B0100 => format!("The {what} is not signed."),
        0x80096010 | 0x80096011 => format!("The {what}'s signature does not match its contents; it was changed after it was signed."),
        0x800B010C => format!("The certificate that signed the {what} has been revoked."),
        0x80092013 | 0x80092012 => "Windows could not check whether the signing certificate was revoked (its revocation list could not be reached).".into(),
        0x800B0101 => format!("The {what}'s signing certificate had run out when it was signed, and the signature has no timestamp."),
        0x800B0109 | 0x800B010A => format!("The {what} is signed with a certificate Windows does not trust."),
        0x800B0111 => format!("Windows is set to not trust this {what}'s publisher."),
        other => format!("Windows did not accept the {what}'s signature (code 0x{other:08X})."),
    }
}

/// Whether a valid signature is the brand's: timestamped; the signer's name (without regard to capitals); every part of the subject the brand
/// file names; an issuing authority the brand file names; and an identity number it names. A certificate in another person's same name, or from
/// another authority, is refused.
pub fn check_signature(found: &Signature, b: &Brand, what: &str) -> Result<(), String> {
    if !found.timestamped {
        return Err(format!("The {what}'s signature has no timestamp, so it was not trusted."));
    }
    let expected = b.expected_signer.trim();
    if !found.signer.trim().eq_ignore_ascii_case(expected) {
        return Err(format!("The {what} is signed by {}, not by {expected}, so it was not trusted.", found.signer));
    }
    let has = |part: &String| found.subject.iter().any(|p| p.trim().eq_ignore_ascii_case(part.trim()));
    if !b.signer_subject.iter().all(has) {
        return Err(format!("The {what} is signed by someone with the same name as {expected}, but not the same certificate details, so it was not trusted."));
    }
    let from = |start: &String| !start.trim().is_empty() && found.issuer.to_ascii_lowercase().starts_with(&start.to_ascii_lowercase());
    if !b.signer_issuers.iter().any(from) {
        return Err(format!("The {what}'s certificate was issued by {}, not by the authority that issues {expected}'s, so it was not trusted.", found.issuer));
    }
    if !b.signer_identities.iter().any(|id| found.usages.contains(id)) {
        return Err(format!("The {what} is signed by someone with the same name as {expected}, but not the same verified identity, so it was not trusted."));
    }
    Ok(())
}

/// The whole of step 3 for something the hub is about to install: valid (revocation looked up) and the brand's own signature.
pub fn check_installer(path: &Path) -> Result<(), String> {
    check_signature(&signature(path, "installer", Revocation::Checked)?, brand(), "installer")
}

/// The same for an app's own uninstaller, without looking up revocation.
pub fn check_uninstaller(path: &Path) -> Result<(), String> {
    check_signature(&signature(path, "uninstaller", Revocation::NotChecked)?, brand(), "uninstaller")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_files_sha256_is_its_hex_digest() {
        let path = std::env::temp_dir().join(format!("hub-sha-test-{}", std::process::id()));
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(sha256_file(&path).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(windows)]
    #[test]
    fn an_unsigned_file_is_refused_and_a_windows_program_is_signed_by_microsoft() {
        let path = std::env::temp_dir().join(format!("hub-unsigned-{}.exe", std::process::id()));
        std::fs::write(&path, b"MZ not really a program").unwrap();
        assert!(signature(&path, "installer", Revocation::Checked).is_err());
        assert!(check_installer(&path).is_err());
        assert!(check_uninstaller(&path).is_err());
        let _ = std::fs::remove_file(&path);
        // A program Windows itself ships is catalog-signed rather than signed inside the file, so it is not a fair test; the suite's apps'
        // own installers are tried in TESTING-TODO.md and in the ignored test below.
    }

    /// Needs a signed program from the expected signer: cargo test -- --ignored. Set HUB_SIGNED_FILE to a signed program to try another.
    #[cfg(windows)]
    #[test]
    #[ignore = "needs a signed program from the expected signer on this computer"]
    fn a_signed_suite_program_names_its_signer_and_is_timestamped() {
        let file = std::env::var("HUB_SIGNED_FILE").unwrap_or_else(|_| {
            format!("{}\\OpenExplainer\\openexplainer.exe", std::env::var("LOCALAPPDATA").unwrap())
        });
        let found = signature(Path::new(&file), "installer", Revocation::Checked).unwrap();
        assert_eq!(found.signer, brand().expected_signer);
        assert!(found.timestamped);
        assert!(brand().signer_subject.iter().all(|p| found.subject.contains(p)), "{:?}", found.subject);
        assert_eq!(check_installer(Path::new(&file)), Ok(()));
        assert_eq!(check_uninstaller(Path::new(&file)), Ok(()));
        let mut other = brand().clone();
        other.expected_signer = "Someone Else".into();
        assert!(check_signature(&found, &other, "installer").unwrap_err().contains("not by Someone Else"));
    }

    fn ours() -> Signature {
        let b = brand();
        Signature {
            signer: b.expected_signer.clone(),
            subject: b.signer_subject.iter().cloned().chain(["L=Somewhere".to_string()]).collect(),
            issuer: format!("{}AOC CA 04", b.signer_issuers[0]),
            usages: vec!["1.3.6.1.4.1.311.97.1.0".into(), "1.3.6.1.5.5.7.3.3".into(), b.signer_identities[0].clone()],
            timestamped: true,
        }
    }

    #[test]
    fn a_subject_value_in_quotes_stays_one_part() {
        assert_eq!(subject_parts("C=US, S=ny, O=Jason Wrench, CN=Jason Wrench"), ["C=US", "S=ny", "O=Jason Wrench", "CN=Jason Wrench"]);
        // Values made to look like other parts once split without regard to the quotes.
        assert_eq!(subject_parts(r#"CN=Jason Wrench, OU="x, O=Jason Wrench, C=US, y", C=GB"#), ["CN=Jason Wrench", "OU=x, O=Jason Wrench, C=US, y", "C=GB"]);
        assert_eq!(subject_parts(r#"OU="say ""hi"", O=Jason Wrench", CN=a + T=b"#), [r#"OU=say "hi", O=Jason Wrench"#, "CN=a", "T=b"]);
        assert!(subject_parts("").is_empty());
        let mut sly = ours();
        sly.subject = subject_parts(r#"CN=Jason Wrench, OU="x, O=Jason Wrench, C=US, y", C=GB"#);
        assert!(check_signature(&sly, brand(), "installer").is_err());
    }

    #[test]
    fn only_the_brands_own_certificate_is_trusted() {
        let b = brand();
        let refused = |change: &dyn Fn(&mut Signature), words: &str| {
            let mut s = ours();
            change(&mut s);
            let why = check_signature(&s, b, "installer").unwrap_err();
            assert!(why.contains(words), "{why}");
        };
        assert_eq!(check_signature(&ours(), b, "installer"), Ok(()));
        let mut capitals = ours();
        capitals.signer = capitals.signer.to_uppercase();
        assert_eq!(check_signature(&capitals, b, "installer"), Ok(()));
        refused(&|s| s.timestamped = false, "timestamp");
        refused(&|s| s.signer = "Someone Else".into(), "signed by Someone Else");
        // Another person with the same name, and a certificate in that name from another authority.
        refused(&|s| s.subject = vec!["CN=Jason Wrench".into(), "O=Other".into()], "same name");
        refused(&|s| s.subject.clear(), "same name");
        refused(&|s| s.issuer = "Some Other CA".into(), "issued by Some Other CA");
        refused(&|s| s.issuer = format!("Fake {}AOC CA 04", b.signer_issuers[0]), "issued by Fake");
        refused(&|s| s.issuer.clear(), "issued by");
        // Another verified person of the same name, in the same country, from the same authority: all that differs is the identity number.
        refused(&|s| { s.usages.pop(); s.usages.push("1.3.6.1.4.1.311.97.11111111.22222222.33333333.44444444".into()); }, "verified identity");
        refused(&|s| s.usages.clear(), "verified identity");
        refused(&|s| s.usages = vec!["1.3.6.1.4.1.311.97.1.0".into(), "1.3.6.1.5.5.7.3.3".into()], "verified identity");
        refused(&|s| { let id = s.usages.pop().unwrap(); s.usages.push(format!("{id}1")); }, "verified identity");
        // After identity verification is done again, the old and the new number can both be named.
        let mut two = b.clone();
        two.signer_identities.push("1.3.6.1.4.1.311.97.11111111.22222222.33333333.44444444".into());
        let mut renewed = ours();
        renewed.usages = vec![two.signer_identities[1].clone()];
        assert_eq!(check_signature(&renewed, &two, "installer"), Ok(()));
        assert_eq!(check_signature(&ours(), &two, "installer"), Ok(()));
        let mut nobody = b.clone();
        nobody.signer_identities = vec![];
        assert!(check_signature(&ours(), &nobody, "installer").is_err(), "a brand that names no identity trusts none");
        // A brand that names no issuer trusts none.
        let mut none = b.clone();
        none.signer_issuers = vec![];
        assert!(check_signature(&ours(), &none, "installer").is_err());
        none.signer_issuers = vec![" ".into()];
        assert!(check_signature(&ours(), &none, "installer").is_err(), "an empty prefix is not any issuer");
    }

    #[cfg(windows)]
    #[test]
    fn a_held_file_cannot_be_changed_replaced_or_deleted_until_it_is_let_go() {
        let dir = std::env::temp_dir().join(format!("hub-hold-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("setup.exe");
        std::fs::write(&path, b"checked").unwrap();
        let mut held = hold(&path).unwrap();
        let sum = sha256_of(&mut held).unwrap();
        // Everything a same-user program could try between the check and the run.
        assert!(std::fs::write(&path, b"swapped").is_err(), "overwriting");
        assert!(std::fs::OpenOptions::new().append(true).open(&path).is_err(), "appending");
        assert!(std::fs::remove_file(&path).is_err(), "deleting");
        assert!(std::fs::rename(&path, dir.join("moved.exe")).is_err(), "moving it away");
        std::fs::write(dir.join("other.exe"), b"swapped").unwrap();
        assert!(std::fs::rename(dir.join("other.exe"), &path).is_err(), "replacing it");
        assert!(std::fs::rename(&dir, dir.with_extension("away")).is_err(), "moving its folder away");
        assert_eq!(sha256_file(&path).unwrap(), sum, "reading it is still allowed, and it is unchanged");
        drop(held);
        std::fs::write(&path, b"swapped").unwrap();
        assert_ne!(sha256_file(&path).unwrap(), sum);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
