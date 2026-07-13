pub mod startup;
pub mod updater;

use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use startup::{StartupErrorCode, StartupSnapshot, StartupStage, StartupState};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, Url, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use updater::{
    load_update_channel, parse_update_metadata, store_update_channel, update_endpoint,
    DesktopUpdatePhase, DesktopUpdateSnapshot, DesktopUpdateState, UpdateChannel,
};

const PRODUCTION_ORIGIN: &str = "https://app.letscube.ru";
const PRODUCTION_URL: &str = "https://app.letscube.ru/";
const BUNDLED_STARTUP_URL: &str = "http://tauri.localhost/startup.html";
const PRODUCTION_PROFILE: &str = "webview-production-v1";
const UPDATE_CHANNEL_FILE: &str = "updater-channel.json";
const STARTUP_EVENT: &str = "letscube://startup-state";
const DESKTOP_BUILD: &str = env!("LETSCUBE_DESKTOP_BUILD");
static MAIN_READY: AtomicBool = AtomicBool::new(false);
static PREFLIGHT_RUNNING: AtomicBool = AtomicBool::new(false);

struct StartupController(Mutex<StartupState>);

struct NativeUpdateState {
    state: DesktopUpdateState,
    pending: Option<Update>,
}

struct UpdateController {
    inner: Mutex<NativeUpdateState>,
    channel_path: PathBuf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PreflightEntry {
    RunHttps,
    Reject,
}

fn is_allowed_navigation(url: &Url) -> bool {
    url.scheme() == "https" && url.origin().ascii_serialization() == PRODUCTION_ORIGIN
}

fn is_local_startup_url(url: &Url) -> bool {
    url.as_str() == BUNDLED_STARTUP_URL
}

fn require_production_main(window: &WebviewWindow) -> Result<(), &'static str> {
    if window.label() != "main"
        || window
            .url()
            .map(|url| !is_allowed_navigation(&url))
            .unwrap_or(true)
    {
        return Err("unauthorized");
    }
    Ok(())
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

#[cfg(debug_assertions)]
fn qa_holds_preflight() -> bool {
    std::env::var("LETSCUBE_TAURI_QA_HOLD_PREFLIGHT").as_deref() == Ok("1")
}

#[cfg(not(debug_assertions))]
fn qa_holds_preflight() -> bool {
    false
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
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  const call = (command, args) => typeof invoke === "function"
    ? invoke(command, args)
    : Promise.reject("desktop_runtime_unavailable");
  window.letscubeDesktop = Object.freeze({{
    platform: "windows",
    version: runtimeInfo.version,
    build: runtimeInfo.build,
    getRuntimeInfo: async () => runtimeInfo,
    getUpdateState: async () => call("desktop_get_update_state"),
    getUpdateChannel: async () => call("desktop_get_update_channel"),
    setUpdateChannel: async (channel) => call("desktop_set_update_channel", {{ channel }}),
    checkUpdate: async () => call("desktop_check_update"),
    installUpdate: async () => call("desktop_install_update")
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

fn production_overlay_script() -> String {
    include_str!("../../ui/startup-overlay.js")
        .replace(
            "__LETSCUBE_PRODUCTION_ORIGIN__",
            &serde_json::to_string(PRODUCTION_ORIGIN).expect("production origin serializes"),
        )
        .replace(
            "__LETSCUBE_STARTUP_EVENT__",
            &serde_json::to_string(STARTUP_EVENT).expect("startup event serializes"),
        )
        .replace(
            "__LETSCUBE_OVERLAY_CSS__",
            &serde_json::to_string(include_str!("../../ui/startup-overlay.css"))
                .expect("overlay CSS serializes"),
        )
        .replace(
            "__LETSCUBE_OVERLAY_HTML__",
            &serde_json::to_string(include_str!("../../ui/startup-overlay.html"))
                .expect("overlay HTML serializes"),
        )
}

fn initialization_script() -> String {
    format!(
        "{}\n{}",
        desktop_bridge_script(),
        production_overlay_script()
    )
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

fn restore_startup_surface<R: Runtime>(app: &AppHandle<R>) {
    show_main(app);
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

fn current_snapshot<R: Runtime>(app: &AppHandle<R>) -> Option<StartupSnapshot> {
    app.state::<StartupController>()
        .0
        .lock()
        .ok()
        .map(|state| state.snapshot())
}

fn emit_startup_snapshot<R: Runtime>(app: &AppHandle<R>) {
    let Some(snapshot) = current_snapshot(app) else {
        return;
    };
    let _ = app.emit_to("main", STARTUP_EVENT, &snapshot);
    if let (Some(main), Ok(payload)) = (
        app.get_webview_window("main"),
        serde_json::to_string(&snapshot),
    ) {
        let _ = main.eval(format!(
            "window.dispatchEvent(new CustomEvent({STARTUP_EVENT:?}, {{ detail: {payload} }}));"
        ));
    }
}

fn transition_startup<R: Runtime>(app: &AppHandle<R>, next: StartupStage) -> bool {
    let transitioned = app
        .state::<StartupController>()
        .0
        .lock()
        .ok()
        .is_some_and(|mut state| state.transition(next).is_ok());
    if transitioned {
        emit_startup_snapshot(app);
    }
    transitioned
}

fn enter_preflight(state: &mut StartupState) -> PreflightEntry {
    match state.snapshot().stage {
        StartupStage::Boot => match state.transition(StartupStage::NetworkCheck) {
            Ok(()) => PreflightEntry::RunHttps,
            Err(_) => PreflightEntry::Reject,
        },
        StartupStage::NetworkCheck => PreflightEntry::RunHttps,
        _ => PreflightEntry::Reject,
    }
}

fn prepare_preflight<R: Runtime>(app: &AppHandle<R>) -> PreflightEntry {
    let entry = app
        .state::<StartupController>()
        .0
        .lock()
        .ok()
        .map_or(PreflightEntry::Reject, |mut state| {
            enter_preflight(&mut state)
        });
    if entry == PreflightEntry::RunHttps {
        emit_startup_snapshot(app);
    }
    entry
}

async fn launch_https_path<T, F, Fut>(entry: PreflightEntry, request: F) -> Option<T>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = T>,
{
    if entry != PreflightEntry::RunHttps {
        return None;
    }
    Some(request().await)
}

fn fail_startup<R: Runtime>(app: &AppHandle<R>, error: StartupErrorCode) {
    if let Ok(mut state) = app.state::<StartupController>().0.lock() {
        let _ = state.fail(error);
    }
    PREFLIGHT_RUNNING.store(false, Ordering::Release);
    emit_startup_snapshot(app);
}

fn classify_request_error(error: &reqwest::Error) -> StartupErrorCode {
    let detail = error.to_string().to_ascii_lowercase();
    if detail.contains("certificate")
        || detail.contains("tls")
        || detail.contains("ssl")
        || detail.contains("unknown issuer")
    {
        StartupErrorCode::TlsOrigin
    } else {
        StartupErrorCode::Network
    }
}

async fn run_preflight<R: Runtime>(app: AppHandle<R>) {
    if PREFLIGHT_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    let entry = prepare_preflight(&app);
    if entry != PreflightEntry::RunHttps {
        PREFLIGHT_RUNNING.store(false, Ordering::Release);
        return;
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if is_allowed_navigation(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            fail_startup(&app, StartupErrorCode::Network);
            return;
        }
    };

    if !transition_startup(&app, StartupStage::TlsOriginCheck) {
        PREFLIGHT_RUNNING.store(false, Ordering::Release);
        return;
    }

    let response = match launch_https_path(entry, || client.get(PRODUCTION_URL).send()).await {
        Some(Ok(response)) => response,
        Some(Err(error)) => {
            fail_startup(&app, classify_request_error(&error));
            return;
        }
        None => return,
    };
    if !response.status().is_success()
        || response.status().is_redirection()
        || !is_allowed_navigation(response.url())
    {
        fail_startup(&app, StartupErrorCode::TlsOrigin);
        return;
    }

    if !transition_startup(&app, StartupStage::UpdateCheck) {
        PREFLIGHT_RUNNING.store(false, Ordering::Release);
        return;
    }

    // Catalog availability is informative for Task 2 and must not block the installed client.
    let _ = client
        .get(update_endpoint(UpdateChannel::default()))
        .timeout(Duration::from_secs(8))
        .send()
        .await;

    if !transition_startup(&app, StartupStage::ProductionNavigation) {
        PREFLIGHT_RUNNING.store(false, Ordering::Release);
        return;
    }
    let Some(main) = app.get_webview_window("main") else {
        fail_startup(&app, StartupErrorCode::Network);
        return;
    };
    if main
        .navigate(Url::parse(PRODUCTION_URL).expect("production URL is valid"))
        .is_err()
    {
        fail_startup(&app, StartupErrorCode::Network);
    }
}

fn build_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .expect("tauri.conf.json must define the main window")
        .clone();
    let profile_dir = production_profile_dir(app)?;
    let navigation_handle = app.clone();
    let new_window_handle = app.clone();

    let mut builder = WebviewWindowBuilder::from_config(app, &config)?
        .data_directory(profile_dir)
        .initialization_script(initialization_script());

    if let Some(args) = debug_browser_args() {
        builder = builder.additional_browser_args(&args);
    }

    builder
        .on_navigation(move |url| {
            if is_local_startup_url(url) || is_allowed_navigation(url) {
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
            let app = window.app_handle();
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            if is_local_startup_url(payload.url()) {
                emit_startup_snapshot(app);
                return;
            }
            if !is_allowed_navigation(payload.url()) {
                return;
            }
            if transition_startup(app, StartupStage::WorkspaceReady)
                && transition_startup(app, StartupStage::Complete)
            {
                MAIN_READY.store(true, Ordering::Release);
                PREFLIGHT_RUNNING.store(false, Ordering::Release);
            }
        })
        .build()?;

    Ok(())
}

fn setup_update_controller<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let channel_path = app.path().app_local_data_dir()?.join(UPDATE_CHANNEL_FILE);
    let channel = load_update_channel(&channel_path);
    app.manage(UpdateController {
        inner: Mutex::new(NativeUpdateState {
            state: DesktopUpdateState::new(channel, app.package_info().version.to_string()),
            pending: None,
        }),
        channel_path,
    });
    Ok(())
}

fn update_command_error(code: &'static str) -> String {
    code.to_owned()
}

fn update_snapshot(controller: &UpdateController) -> Result<DesktopUpdateSnapshot, &'static str> {
    controller
        .inner
        .lock()
        .map(|native| native.state.snapshot())
        .map_err(|_| "update_state_unavailable")
}

fn mark_update_failed(controller: &UpdateController, code: &'static str) {
    if let Ok(mut native) = controller.inner.lock() {
        native.state.fail(code);
    }
}

#[tauri::command]
fn desktop_get_update_state(
    window: WebviewWindow,
    controller: State<'_, UpdateController>,
) -> Result<DesktopUpdateSnapshot, String> {
    require_production_main(&window).map_err(update_command_error)?;
    update_snapshot(&controller).map_err(update_command_error)
}

#[tauri::command]
fn desktop_get_update_channel(
    window: WebviewWindow,
    controller: State<'_, UpdateController>,
) -> Result<UpdateChannel, String> {
    require_production_main(&window).map_err(update_command_error)?;
    controller
        .inner
        .lock()
        .map(|native| native.state.channel())
        .map_err(|_| update_command_error("update_state_unavailable"))
}

#[tauri::command]
fn desktop_set_update_channel(
    window: WebviewWindow,
    controller: State<'_, UpdateController>,
    channel: String,
) -> Result<DesktopUpdateSnapshot, String> {
    require_production_main(&window).map_err(update_command_error)?;
    let channel = updater::parse_update_channel_input(&channel)
        .ok_or_else(|| update_command_error("invalid_update_channel"))?;
    let mut native = controller
        .inner
        .lock()
        .map_err(|_| update_command_error("update_state_unavailable"))?;
    if matches!(
        native.state.snapshot().phase,
        DesktopUpdatePhase::Checking
            | DesktopUpdatePhase::Downloading
            | DesktopUpdatePhase::Installing
    ) {
        return Err(update_command_error("update_busy"));
    }
    store_update_channel(&controller.channel_path, channel)
        .map_err(|_| update_command_error("update_channel_store_failed"))?;
    native.state.set_channel(channel);
    native.pending = None;
    Ok(native.state.snapshot())
}

#[tauri::command]
async fn desktop_check_update(
    window: WebviewWindow,
    app: AppHandle,
    controller: State<'_, UpdateController>,
) -> Result<DesktopUpdateSnapshot, String> {
    require_production_main(&window).map_err(update_command_error)?;
    let (channel, installed_version) = {
        let mut native = controller
            .inner
            .lock()
            .map_err(|_| update_command_error("update_state_unavailable"))?;
        native
            .state
            .begin_check()
            .map_err(|_| update_command_error("update_busy"))?;
        native.pending = None;
        let snapshot = native.state.snapshot();
        (snapshot.channel, snapshot.installed_version)
    };

    let updater = app
        .updater_builder()
        .endpoints(vec![update_endpoint(channel)])
        .map_err(|_| update_command_error("update_configuration_failed"))?
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| update_command_error("update_configuration_failed"))?;
    let checked = match updater.check().await {
        Ok(checked) => checked,
        Err(_) => {
            mark_update_failed(&controller, "update_check_failed");
            return Err(update_command_error("update_check_failed"));
        }
    };

    let mut native = controller
        .inner
        .lock()
        .map_err(|_| update_command_error("update_state_unavailable"))?;
    match checked {
        Some(update) => {
            let metadata = parse_update_metadata(&update.raw_json, channel, &installed_version);
            native.state.set_mandatory(metadata.mandatory);
            native
                .state
                .mark_available(update.version.clone(), metadata.critical, None)
                .map_err(|_| update_command_error("update_state_unavailable"))?;
            native.pending = Some(update);
        }
        None => {
            native
                .state
                .mark_current()
                .map_err(|_| update_command_error("update_state_unavailable"))?;
        }
    }
    Ok(native.state.snapshot())
}

#[tauri::command]
async fn desktop_install_update(
    window: WebviewWindow,
    controller: State<'_, UpdateController>,
) -> Result<DesktopUpdateSnapshot, String> {
    require_production_main(&window).map_err(update_command_error)?;
    let update = {
        let mut native = controller
            .inner
            .lock()
            .map_err(|_| update_command_error("update_state_unavailable"))?;
        let update = native
            .pending
            .clone()
            .ok_or_else(|| update_command_error("update_not_available"))?;
        native
            .state
            .begin_download()
            .map_err(|_| update_command_error("update_not_available"))?;
        update
    };

    let bytes = match update
        .download(
            |chunk_bytes, total_bytes| {
                if let Ok(mut native) = controller.inner.lock() {
                    native.state.record_download_progress(
                        u64::try_from(chunk_bytes).unwrap_or(u64::MAX),
                        total_bytes,
                    );
                }
            },
            || {},
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(_) => {
            mark_update_failed(&controller, "update_download_failed");
            return Err(update_command_error("update_download_failed"));
        }
    };

    {
        let mut native = controller
            .inner
            .lock()
            .map_err(|_| update_command_error("update_state_unavailable"))?;
        native
            .state
            .finish_verified_download()
            .map_err(|_| update_command_error("update_state_unavailable"))?;
    }
    if update.install(bytes).is_err() {
        mark_update_failed(&controller, "update_install_failed");
        return Err(update_command_error("update_install_failed"));
    }

    update_snapshot(&controller).map_err(update_command_error)
}

#[tauri::command]
fn retry_main(window: WebviewWindow, app: AppHandle) {
    if window.label() != "main"
        || window
            .url()
            .map(|url| !is_local_startup_url(&url))
            .unwrap_or(true)
    {
        return;
    }
    let retried = app
        .state::<StartupController>()
        .0
        .lock()
        .ok()
        .is_some_and(|mut state| state.retry().is_ok());
    if !retried {
        return;
    }
    emit_startup_snapshot(&app);
    tauri::async_runtime::spawn(run_preflight(app));
}

#[tauri::command]
fn begin_startup_qa(window: WebviewWindow, app: AppHandle) {
    if !qa_holds_preflight()
        || window.label() != "main"
        || window
            .url()
            .map(|url| !is_local_startup_url(&url))
            .unwrap_or(true)
    {
        return;
    }
    tauri::async_runtime::spawn(run_preflight(app));
}

pub fn run() {
    tauri::Builder::default()
        .manage(StartupController(Mutex::new(StartupState::new())))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_startup_surface(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            retry_main,
            begin_startup_qa,
            desktop_get_update_state,
            desktop_get_update_channel,
            desktop_set_update_channel,
            desktop_check_update,
            desktop_install_update
        ])
        .setup(|app| {
            setup_update_controller(app.handle())?;
            setup_tray(app.handle())?;
            build_main_window(app.handle())?;
            show_main(app.handle());
            if !qa_holds_preflight() {
                tauri::async_runtime::spawn(run_preflight(app.handle().clone()));
            }
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
    fn only_the_bundled_startup_document_is_allowed_before_production() {
        assert!(is_local_startup_url(
            &Url::parse("http://tauri.localhost/startup.html").unwrap()
        ));
        assert!(!is_local_startup_url(
            &Url::parse("http://localhost:4317/startup.html").unwrap()
        ));
        assert!(!is_local_startup_url(
            &Url::parse("http://tauri.localhost/nested/startup.html").unwrap()
        ));
        assert!(!is_local_startup_url(
            &Url::parse("https://tauri.localhost/startup.html").unwrap()
        ));
        assert!(!is_local_startup_url(
            &Url::parse("http://tauri.localhost/startup.html?retry=1").unwrap()
        ));
    }

    #[test]
    fn retry_entry_continues_into_the_https_preflight_path() {
        use std::sync::atomic::AtomicUsize;

        let mut state = StartupState::new();
        state.transition(StartupStage::NetworkCheck).unwrap();
        state.fail(StartupErrorCode::Network).unwrap();
        state.retry().unwrap();

        let entry = enter_preflight(&mut state);
        assert_eq!(entry, PreflightEntry::RunHttps);
        assert_eq!(state.snapshot().stage, StartupStage::NetworkCheck);

        let launches = AtomicUsize::new(0);
        let result = tauri::async_runtime::block_on(launch_https_path(entry, || async {
            launches.fetch_add(1, Ordering::SeqCst);
            "https-request-started"
        }));
        assert_eq!(result, Some("https-request-started"));
        assert_eq!(launches.load(Ordering::SeqCst), 1);
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
    fn production_overlay_is_origin_guarded_and_records_connected_fade_lifecycle() {
        let script = production_overlay_script();
        let html = include_str!("../../ui/startup-overlay.html");
        let css = include_str!("../../ui/startup-overlay.css");
        assert!(script.contains(PRODUCTION_ORIGIN));
        assert!(script.contains("window.location.origin"));
        assert!(script.contains("production-startup-overlay"));
        assert!(script.contains("letscube://startup-state"));
        assert!(script.contains("__letscubeStartupOverlayHistory"));
        assert!(script.contains("sessionStorage"));
        assert!(script.contains("letscube:startup-overlay-complete"));
        assert!(script.contains("is-connected"));
        assert!(script.contains("320"));
        assert!(html.contains("Подготавливаем рабочее пространство"));
        assert!(!html.contains("Рабочее пространство готово"));
        assert!(script.contains("status.textContent = successText"));
        assert!(script.contains("statusText: status.textContent"));
        assert!(css.contains("prefers-reduced-motion: reduce"));
        assert!(css.contains("transition-duration: 1ms"));
        assert!(script.contains("matchMedia"));
        assert!(script.contains("reducedMotion ? 1 : 320"));
        assert!(script.contains("fadeDuration"));
        assert!(!script.contains("service_role"));
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
