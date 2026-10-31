use std::{env, fs, path::PathBuf};

use sha2::{Digest, Sha256};

fn main() {
    println!("cargo:rerun-if-changed=../bundled-tools.lock.json");
    println!("cargo:rerun-if-changed=resources/speech");
    let target = env::var("TARGET").unwrap_or_default();
    let manifest = PathBuf::from("resources")
        .join("tools")
        .join(&target)
        .join("integrity.json");
    println!("cargo:rerun-if-changed={}", manifest.display());
    if let Ok(bytes) = fs::read(&manifest) {
        println!("cargo:rustc-env=DENOTE_BUNDLED_TOOLS_TARGET={target}");
        println!(
            "cargo:rustc-env=DENOTE_BUNDLED_TOOLS_INTEGRITY_SHA256={}",
            hex::encode(Sha256::digest(bytes))
        );
    } else {
        println!("cargo:rustc-env=DENOTE_BUNDLED_TOOLS_TARGET=");
        println!("cargo:rustc-env=DENOTE_BUNDLED_TOOLS_INTEGRITY_SHA256=");
    }
    if target.ends_with("windows-msvc") {
        let application_manifest = PathBuf::from(
            env::var_os("CARGO_MANIFEST_DIR").expect("Cargo must provide its manifest directory"),
        )
        .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", application_manifest.display());
        // Tauri's bins-only resource linking omits the library's unit-test executable.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTUAC:NO");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
            application_manifest.display()
        );
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("Failed to build Tauri resources");
    } else {
        tauri_build::build();
    }
}
