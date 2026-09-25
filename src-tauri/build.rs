fn main() {
    // Never ship a Windows release that cannot verify future updates.
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("PROFILE").as_deref() == Ok("release")
    {
        let config: serde_json::Value =
            serde_json::from_str(&std::env::var("TAURI_CONFIG").unwrap_or_else(|_| "{}".into()))
                .expect("invalid TAURI_CONFIG");
        let key = config
            .pointer("/plugins/updater/pubkey")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert!(!key.trim().is_empty(), "Windows releases require a signing public key. Run node scripts/updater-config.mjs stable, then tauri build --config src-tauri/updater.generated.json. See docs/updater.md.");
    }
    tauri_build::build()
}
