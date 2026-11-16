// SPDX-License-Identifier: Apache-2.0
//! Picks the brand this program is built as: HUB_BRAND (a folder in brands/), or else the brand src-tauri/tauri.conf.json was set up for by
//! tools/apply-brand.mjs. The brand's folder is handed to the code as HUB_BRAND_DIR, so brand.json and the tray icons are read from there.

use std::path::{Path, PathBuf};

fn identifier_of(file: &Path) -> Option<String> {
    let text = std::fs::read_to_string(file).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value.get("identifier")?.as_str().map(str::to_owned)
}

fn main() {
    let here = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let brands = here.parent().unwrap().join("brands");
    let conf = here.join("tauri.conf.json");
    println!("cargo:rerun-if-env-changed=HUB_BRAND");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    let ids: Vec<String> = std::fs::read_dir(&brands)
        .expect("the brands folder")
        .flatten()
        .filter(|e| e.path().join("brand.json").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    let built = identifier_of(&conf);
    let chosen = match std::env::var("HUB_BRAND") {
        Ok(id) if !id.is_empty() => id,
        _ => ids
            .iter()
            .find(|id| identifier_of(&brands.join(id).join("brand.json")) == built)
            .cloned()
            .unwrap_or_else(|| panic!("Say which hub to build: set HUB_BRAND to one of {ids:?}, then run node tools/apply-brand.mjs.")),
    };
    let dir = brands.join(&chosen);
    let brand_file = dir.join("brand.json");
    assert!(brand_file.is_file(), "There is no brand \"{chosen}\" in brands/ (the brands are {ids:?}).");
    // tauri.conf.json must be set up for the same brand, or the program's name and icons would be the other hub's.
    if identifier_of(&brand_file) != built {
        panic!("src-tauri/tauri.conf.json is not set up for the brand \"{chosen}\". Run: node tools/apply-brand.mjs --brand {chosen}");
    }

    // The brand's files are read into the program when it is built; a change to them must rebuild it.
    for name in ["brand.json", "app-icons/tray.png", "app-icons/tray-dot.png"] {
        println!("cargo:rerun-if-changed={}", dir.join(name).display());
    }
    println!("cargo:rustc-env=HUB_BRAND_DIR={}", dir.display().to_string().replace('\\', "/"));
    // The window's built files are packed into the program; a new build of them must rebuild the program too, even with a plain cargo build.
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
