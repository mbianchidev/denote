use std::{env, fs, path::PathBuf};

use sha2::{Digest, Sha256};

fn main() {
    println!("cargo:rerun-if-changed=../bundled-tools.lock.json");
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
    tauri_build::build()
}
