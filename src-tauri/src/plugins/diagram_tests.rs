use flate2::{Compression, write::GzEncoder};
use serde_json::json;
use sha2::{Digest, Sha256};
use tar::Builder;
use tempfile::TempDir;

use super::{
    PluginCatalogEntry, PluginManager, catalog::validate_catalog, commands::validate_export_svg,
    tests::manager,
};

const PLUGIN_ID: &str = "denote.synthetic-diagram";

fn catalog() -> PluginCatalogEntry {
    serde_json::from_value(json!({
        "manifest": {
            "schemaVersion": 1,
            "id": PLUGIN_ID,
            "name": "Synthetic diagram renderer",
            "version": "1.0.0",
            "description": "Synthetic local diagram renderer",
            "publisher": { "name": "Denote" },
            "license": "MIT",
            "repository": "https://github.com/mbianchidev/denote",
            "icon": "icon.svg",
            "category": "diagrams-visualization",
            "compatibility": { "apiVersion": 1, "minimumDenoteVersion": "0.3.0" },
            "permissions": [{ "capability": "diagram-renderer" }],
            "entrypoint": "dist/index.js",
            "diagramRenderer": { "entrypoint": "dist/renderer.js" },
            "documentation": "guide.md"
        },
        "artifact": {
            "url": format!("https://github.com/mbianchidev/denote/releases/download/v1.0.0/{PLUGIN_ID}-1.0.0.tgz"),
            "sha256": "a".repeat(64),
            "sizeBytes": 1
        },
        "provenance": {
            "publisherId": "denote",
            "sourceCommit": "b".repeat(40),
            "trusted": true
        },
        "guide": "# Synthetic diagram renderer"
    }))
    .expect("synthetic catalog")
}

fn append(builder: &mut Builder<GzEncoder<Vec<u8>>>, path: &str, content: &[u8]) {
    let mut header = tar::Header::new_gnu();
    header.set_size(content.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, path, content)
        .expect("append");
}

fn package_bytes(catalog: &PluginCatalogEntry) -> Vec<u8> {
    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut builder = Builder::new(encoder);
    append(
        &mut builder,
        "plugin.json",
        &serde_json::to_vec(&catalog.manifest).expect("manifest"),
    );
    append(
        &mut builder,
        &catalog.manifest.entrypoint,
        b"export default {};",
    );
    append(
        &mut builder,
        &catalog
            .manifest
            .diagram_renderer
            .as_ref()
            .expect("renderer")
            .entrypoint,
        b"export async function renderDiagram() { return {}; }",
    );
    append(
        &mut builder,
        &catalog.manifest.documentation,
        b"# Synthetic diagram renderer",
    );
    append(&mut builder, &catalog.manifest.icon, b"<svg></svg>");
    append(&mut builder, "package.json", br#"{"private":true}"#);
    builder
        .into_inner()
        .expect("archive")
        .finish()
        .expect("gzip")
}

fn fixture(mut catalog: PluginCatalogEntry) -> (TempDir, TempDir, PluginManager) {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let bytes = package_bytes(&catalog);
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
    let manager = manager(catalog, &data, &cache);
    (data, cache, manager)
}

#[test]
fn diagram_renderer_is_additive_bounded_and_integrity_checked() {
    let catalog = catalog();
    validate_catalog(std::slice::from_ref(&catalog)).expect("valid catalog");
    let (data, _cache, manager) = fixture(catalog.clone());
    let archive = data.path().join("synthetic-diagram.tgz");
    std::fs::write(&archive, package_bytes(&catalog)).expect("archive");
    manager
        .load_development_archive(&archive)
        .expect("development archive");
    let permission_payload = manager
        .list()
        .expect("plugins")
        .remove(0)
        .catalog
        .manifest
        .permissions;

    let installed = manager
        .prepare(PLUGIN_ID, permission_payload)
        .expect("prepare");
    assert_eq!(
        manager
            .read_diagram_renderer(PLUGIN_ID)
            .expect("prepared renderer"),
        "export async function renderDiagram() { return {}; }"
    );
    manager
        .commit_enable(&installed.transaction_id)
        .expect("commit");

    std::fs::write(
        manager.install_dir(&catalog).join("dist/renderer.js"),
        "tampered",
    )
    .expect("tamper");
    let error = manager
        .read_diagram_renderer(PLUGIN_ID)
        .expect_err("integrity failure");
    assert!(error.to_string().contains("integrity check failed"));

    manager.disable(PLUGIN_ID, false, false).expect("disable");
    assert!(!manager.plugin_root(PLUGIN_ID).exists());
    assert!(manager.read_diagram_renderer(PLUGIN_ID).is_err());
}

#[test]
fn diagram_renderer_requires_exact_permission_and_manifest_pairing() {
    let mut missing_entrypoint = catalog();
    missing_entrypoint.manifest.diagram_renderer = None;
    assert!(validate_catalog(&[missing_entrypoint]).is_err());

    let mut missing_permission = catalog();
    missing_permission.manifest.permissions.clear();
    assert!(validate_catalog(&[missing_permission]).is_err());

    let (_data, _cache, manager) = fixture(catalog());
    assert!(
        manager
            .prepare(PLUGIN_ID, Vec::new())
            .expect_err("approval mismatch")
            .to_string()
            .contains("Approved permissions do not match")
    );
}

#[test]
fn diagram_svg_export_revalidates_structure_and_references() {
    validate_export_svg(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><marker id="arrow"><path d="M0 0"/></marker></defs><path d="M0 0h10" marker-end="url(#arrow)"/></svg>"##,
    )
    .expect("safe SVG");

    for unsafe_svg in [
        r#"<svg><style>rect { fill: red; }</style><rect width="1" height="1"/></svg>"#,
        r#"<svg style = "background:url(//example.test)"><rect width="1" height="1"/></svg>"#,
        r#"<svg><a href = "https://example.test"><text>Link</text></a></svg>"#,
        r#"<svg><path d="M0 0" marker-end="url(https://example.test/a.svg)"/></svg>"#,
        r#"<svg><rect fill="\75 rl(\68 ttps://example.test/a.svg)"/></svg>"#,
    ] {
        assert!(validate_export_svg(unsafe_svg).is_err());
    }
}
