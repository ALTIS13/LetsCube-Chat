use std::fs;

const COMMANDS: &[&str] = &[
    "retry_main",
    "begin_startup_qa",
    "desktop_get_update_state",
    "desktop_get_update_channel",
    "desktop_set_update_channel",
    "desktop_check_update",
    "desktop_install_update",
    "desktop_show_main",
];

fn main() {
    println!("cargo:rerun-if-changed=../package.json");
    let package_json =
        fs::read_to_string("../package.json").expect("windows-tauri/package.json must be readable");
    let package: serde_json::Value =
        serde_json::from_str(&package_json).expect("windows-tauri/package.json must be valid JSON");
    let desktop_build = package
        .get("desktopBuild")
        .and_then(serde_json::Value::as_u64)
        .filter(|build| *build > 0 && *build <= u32::MAX as u64)
        .expect("desktopBuild must be a positive 32-bit integer");
    println!("cargo:rustc-env=LETSCUBE_DESKTOP_BUILD={desktop_build}");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("Tauri build configuration must be valid")
}
