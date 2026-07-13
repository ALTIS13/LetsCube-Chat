use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const PRODUCTION_ORIGIN: &str = "https://app.letscube.ru";
const PRODUCTION_URL: &str = "https://app.letscube.ru/";
const PRODUCTION_PROFILE: &str = "webview-production-v1";
const DESKTOP_BUILD: &str = env!("LETSCUBE_DESKTOP_BUILD");
static MAIN_READY: AtomicBool = AtomicBool::new(false);

fn is_allowed_navigation(url: &Url) -> bool {
    url.origin().ascii_serialization() == PRODUCTION_ORIGIN
}

fn is_safe_external_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
        && url.username().is_empty()
        && url.password().is_none()
}

fn production_profile_dir<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    if cfg!(debug_assertions) {
        if let Some(path) = std::env::var_os("LETSCUBE_WEBVIEW2_DATA_DIR") {
            return Ok(PathBuf::from(path));
        }
    }

    Ok(app.path().app_local_data_dir()?.join(PRODUCTION_PROFILE))
}

#[cfg(debug_assertions)]
fn debug_browser_args() -> Option<String> {
    let port = std::env::var("LETSCUBE_WEBVIEW2_DEBUG_PORT")
        .ok()?
        .parse::<u16>()
        .ok()?;
    if port < 1024 {
        return None;
    }

    Some(format!(
        "--remote-debugging-port={port} --remote-allow-origins=http://127.0.0.1:{port}"
    ))
}

#[cfg(not(debug_assertions))]
fn debug_browser_args() -> Option<String> {
    None
}

fn desktop_bridge_script() -> String {
    format!(
        r#"
(() => {{
  if (window.location.origin !== {origin:?}) return;
  const runtimeInfo = Object.freeze({{
    platform: "windows",
    version: {version:?},
    build: {build}
  }});
  window.letscubeDesktop = Object.freeze({{
    platform: "windows",
    version: runtimeInfo.version,
    build: runtimeInfo.build,
    getRuntimeInfo: async () => runtimeInfo
  }});
  Object.defineProperty(window, "letscubeDesktop", {{
    configurable: false,
    enumerable: false,
    writable: false,
    value: window.letscubeDesktop
  }});
}})();
"#,
        origin = PRODUCTION_ORIGIN,
        version = env!("CARGO_PKG_VERSION"),
        build = DESKTOP_BUILD,
    )
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

fn show_splash<R: Runtime>(app: &AppHandle<R>) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.show();
        let _ = splash.set_focus();
    }
}

fn restore_startup_surface<R: Runtime>(app: &AppHandle<R>) {
    if MAIN_READY.load(Ordering::Acquire) {
        show_main(app);
    } else {
        show_splash(app);
    }
}

fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть LETSCUBE", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;

    let mut tray = TrayIconBuilder::with_id("letscube-tray")
        .menu(&menu)
        .tooltip("LETSCUBE")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => restore_startup_surface(app),
            "exit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                restore_startup_surface(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn build_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let production_url = Url::parse(PRODUCTION_URL).expect("production URL is static and valid");
    let profile_dir = production_profile_dir(app)?;
    let navigation_handle = app.clone();
    let new_window_handle = app.clone();

    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(production_url))
        .title("LETSCUBE")
        .inner_size(1360.0, 860.0)
        .min_inner_size(960.0, 640.0)
        .center()
        .visible(false)
        .data_directory(profile_dir)
        .initialization_script(desktop_bridge_script());

    if let Some(args) = debug_browser_args() {
        builder = builder.additional_browser_args(&args);
    }

    builder
        .on_navigation(move |url| {
            if is_allowed_navigation(url) {
                true
            } else {
                if is_safe_external_url(url) {
                    let _ = navigation_handle
                        .opener()
                        .open_url(url.as_str(), None::<&str>);
                }
                false
            }
        })
        .on_new_window(move |url, _features| {
            if is_safe_external_url(&url) {
                let _ = new_window_handle
                    .opener()
                    .open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                MAIN_READY.store(true, Ordering::Release);
                let app = window.app_handle();
                show_main(app);
                if let Some(splash) = app.get_webview_window("splash") {
                    let _ = splash.close();
                }
            }
        })
        .build()?;

    Ok(())
}

#[tauri::command]
fn retry_main(window: WebviewWindow, app: AppHandle) {
    if window.label() != "splash" {
        return;
    }
    MAIN_READY.store(false, Ordering::Release);
    show_splash(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.navigate(Url::parse(PRODUCTION_URL).expect("production URL is valid"));
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_startup_surface(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![retry_main])
        .setup(|app| {
            setup_tray(app.handle())?;
            build_main_window(app.handle())?;

            let splash_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(15));
                let _ = splash_handle.emit("letscube://load-timeout", ());
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running LETSCUBE Windows client");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_is_limited_to_exact_production_origin() {
        assert!(is_allowed_navigation(
            &Url::parse("https://app.letscube.ru/login").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("http://app.letscube.ru/login").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("https://app.letscube.ru.evil.example/").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("https://deploy.letscube.ru/").unwrap()
        ));
    }

    #[test]
    fn bridge_is_origin_guarded_and_contains_no_credentials() {
        let script = desktop_bridge_script();
        assert!(script.contains(PRODUCTION_ORIGIN));
        assert!(script.contains("Object.freeze"));
        assert!(!script.to_ascii_lowercase().contains("service_role"));
        assert!(!script.to_ascii_lowercase().contains("supabase_key"));
    }

    #[test]
    fn external_handoff_allows_only_safe_system_protocols() {
        assert!(is_safe_external_url(
            &Url::parse("https://api.letscube.ru/releases/files/windows/client.exe").unwrap()
        ));
        assert!(is_safe_external_url(
            &Url::parse("mailto:admin@example.com").unwrap()
        ));
        assert!(!is_safe_external_url(
            &Url::parse("file:///C:/Windows/System32/cmd.exe").unwrap()
        ));
        assert!(!is_safe_external_url(
            &Url::parse("javascript:alert(1)").unwrap()
        ));
        assert!(!is_safe_external_url(
            &Url::parse("https://user:password@example.com/").unwrap()
        ));
    }
}
