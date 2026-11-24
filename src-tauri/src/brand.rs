// SPDX-License-Identifier: Apache-2.0
//! The brand: every value that makes this program one hub rather than the other (OpenStage Hub or Prism Hub), read from brands/<brand>/brand.json (HUB_BRAND_DIR, set by build.rs) when the program is built.
//! Nothing brand-specific is written anywhere else in the Rust code.

use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Brand {
    pub product_name: String,
    pub short_name: String,
    pub identifier: String,
    pub repository: String,
    pub catalog: CatalogPlace,
    /// The public half of the hub key (32 bytes of Ed25519, in base64). Empty until Make Hub Key.bat has been run.
    pub catalog_public_key: String,
    /// The public half of a second key, kept offline, whose signature on a catalog is accepted too, so losing the first does not strand
    /// installed hubs. Empty until the owner has made one.
    #[serde(default)]
    pub catalog_backup_key: String,
    /// The date of the newest catalog published when this hub was built: an older catalog is refused, even on a first run.
    #[serde(default)]
    pub minimum_catalog_date: String,
    /// The only GitHub owner an app may come from, whatever a catalog says.
    pub allowed_owner: String,
    /// The only signer an installer or uninstaller may have, whatever a catalog says.
    pub expected_signer: String,
    /// Parts the signing certificate's full subject must contain ("O=Jason Wrench").
    pub signer_subject: Vec<String>,
    /// What the name of the authority that issued the signing certificate must start with.
    pub signer_issuers: Vec<String>,
    pub sibling: Sibling,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogPlace {
    pub tag: String,
    pub file: String,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Sibling {
    pub label: String,
    pub url: String,
}

pub const BRAND_JSON: &str = include_str!(concat!(env!("HUB_BRAND_DIR"), "/brand.json"));

pub fn brand() -> &'static Brand {
    static BRAND: OnceLock<Brand> = OnceLock::new();
    BRAND.get_or_init(|| serde_json::from_str(BRAND_JSON).expect("the brand file is read when the program is built"))
}

impl Brand {
    /// Where the catalog is published: an asset on the fixed release named by catalog.tag in the hub's repository.
    pub fn catalog_url(&self) -> String {
        format!("https://github.com/{}/releases/download/{}/{}", self.repository, self.catalog.tag, self.catalog.file)
    }

    pub fn signature_url(&self) -> String {
        format!("https://github.com/{}/releases/download/{}/{}", self.repository, self.catalog.tag, self.catalog.signature)
    }

    pub fn repository_url(&self) -> String {
        format!("https://github.com/{}", self.repository)
    }

    /// Whether a repository (owner/name) belongs to the one owner this hub takes apps from.
    pub fn owns(&self, repository: &str) -> bool {
        repository.split_once('/').is_some_and(|(owner, _)| !owner.is_empty() && owner.eq_ignore_ascii_case(&self.allowed_owner))
    }
}

/// This hub's own version (from Cargo.toml, which tools/build-installer.mjs keeps equal to the release).
pub const HUB_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_brand_file_reads_and_points_at_the_hub_repository() {
        let b = brand();
        assert!(!b.product_name.is_empty());
        assert!(b.catalog_url().starts_with("https://github.com/"));
        assert!(b.catalog_url().ends_with(&b.catalog.file));
        assert!(b.sibling.url.starts_with("https://"));
    }

    #[test]
    fn the_trust_anchors_are_in_the_brand_file_and_the_hub_is_in_its_own_owners_repository() {
        let b = brand();
        assert!(!b.allowed_owner.is_empty() && !b.expected_signer.is_empty());
        assert!(!b.signer_issuers.is_empty() && b.signer_issuers.iter().all(|i| i.len() > 5), "an empty prefix would allow any issuer");
        assert!(b.signer_subject.iter().all(|p| p.contains('=')));
        assert!(b.owns(&b.repository));
        assert!(b.owns(&format!("{}/x", b.allowed_owner.to_uppercase())), "capitals do not matter, as on GitHub");
        assert!(!b.owns("someone/x") && !b.owns("") && !b.owns("/x") && !b.owns(&b.allowed_owner));
        assert!(!b.owns(&format!("{}x/y", b.allowed_owner)));
    }
}
