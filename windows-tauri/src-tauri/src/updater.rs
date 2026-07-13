use semver::Version;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;
use url::Url;

const STABLE_UPDATE_ENDPOINT: &str =
    "https://api.letscube.ru/releases/updater/v1/windows/stable.json";
const TEST_UPDATE_ENDPOINT: &str = "https://api.letscube.ru/releases/updater/v1/windows/test.json";
const MAX_CHANNEL_FILE_BYTES: u64 = 256;
const MAX_BUILD: u64 = u32::MAX as u64;
const MAX_VERSION_BYTES: usize = 128;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Test,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopUpdatePhase {
    Idle,
    Checking,
    Current,
    Available,
    CriticalUpdateRequired,
    Downloading,
    Installing,
    Failed,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateSnapshot {
    pub channel: UpdateChannel,
    pub phase: DesktopUpdatePhase,
    pub installed_version: String,
    pub available_version: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub mandatory: bool,
    pub error_code: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopUpdateTransitionError {
    pub from: DesktopUpdatePhase,
    pub to: DesktopUpdatePhase,
}

#[derive(Clone, Debug)]
pub struct DesktopUpdateState {
    snapshot: DesktopUpdateSnapshot,
}

impl DesktopUpdateState {
    pub fn new(channel: UpdateChannel, installed_version: impl Into<String>) -> Self {
        Self {
            snapshot: DesktopUpdateSnapshot {
                channel,
                phase: DesktopUpdatePhase::Idle,
                installed_version: installed_version.into(),
                available_version: None,
                downloaded_bytes: 0,
                total_bytes: None,
                mandatory: false,
                error_code: None,
            },
        }
    }

    pub fn channel(&self) -> UpdateChannel {
        self.snapshot.channel
    }

    pub fn set_channel(&mut self, channel: UpdateChannel) {
        let installed_version = self.snapshot.installed_version.clone();
        *self = Self::new(channel, installed_version);
    }

    pub fn begin_check(&mut self) -> Result<(), DesktopUpdateTransitionError> {
        if matches!(
            self.snapshot.phase,
            DesktopUpdatePhase::Checking
                | DesktopUpdatePhase::Downloading
                | DesktopUpdatePhase::Installing
        ) {
            return Err(self.transition_error(DesktopUpdatePhase::Checking));
        }

        self.snapshot.phase = DesktopUpdatePhase::Checking;
        self.snapshot.available_version = None;
        self.snapshot.downloaded_bytes = 0;
        self.snapshot.total_bytes = None;
        self.snapshot.mandatory = false;
        self.snapshot.error_code = None;
        Ok(())
    }

    pub fn mark_current(&mut self) -> Result<(), DesktopUpdateTransitionError> {
        self.require_phase(DesktopUpdatePhase::Checking, DesktopUpdatePhase::Current)?;
        self.snapshot.phase = DesktopUpdatePhase::Current;
        Ok(())
    }

    pub fn mark_available(
        &mut self,
        version: impl Into<String>,
        critical: bool,
        total_bytes: Option<u64>,
    ) -> Result<(), DesktopUpdateTransitionError> {
        let next = if critical {
            DesktopUpdatePhase::CriticalUpdateRequired
        } else {
            DesktopUpdatePhase::Available
        };
        self.require_phase(DesktopUpdatePhase::Checking, next)?;
        self.snapshot.phase = next;
        self.snapshot.available_version = Some(version.into());
        self.snapshot.downloaded_bytes = 0;
        self.snapshot.total_bytes = total_bytes;
        self.snapshot.error_code = None;
        Ok(())
    }

    pub fn set_mandatory(&mut self, mandatory: bool) {
        self.snapshot.mandatory = mandatory;
    }

    pub fn begin_download(&mut self) -> Result<(), DesktopUpdateTransitionError> {
        if !matches!(
            self.snapshot.phase,
            DesktopUpdatePhase::Available | DesktopUpdatePhase::CriticalUpdateRequired
        ) {
            return Err(self.transition_error(DesktopUpdatePhase::Downloading));
        }
        self.snapshot.phase = DesktopUpdatePhase::Downloading;
        self.snapshot.downloaded_bytes = 0;
        self.snapshot.error_code = None;
        Ok(())
    }

    pub fn record_download_progress(&mut self, chunk_bytes: u64, total_bytes: Option<u64>) {
        if self.snapshot.phase != DesktopUpdatePhase::Downloading {
            return;
        }

        if let Some(total) = total_bytes {
            self.snapshot.total_bytes = Some(total);
        }
        self.snapshot.downloaded_bytes = self.snapshot.downloaded_bytes.saturating_add(chunk_bytes);
        if let Some(total) = self.snapshot.total_bytes {
            self.snapshot.downloaded_bytes = self.snapshot.downloaded_bytes.min(total);
        }
    }

    pub fn finish_verified_download(&mut self) -> Result<(), DesktopUpdateTransitionError> {
        self.require_phase(
            DesktopUpdatePhase::Downloading,
            DesktopUpdatePhase::Installing,
        )?;
        self.snapshot.phase = DesktopUpdatePhase::Installing;
        Ok(())
    }

    pub fn fail(&mut self, code: &'static str) {
        self.snapshot.phase = DesktopUpdatePhase::Failed;
        self.snapshot.error_code = Some(code.to_owned());
    }

    pub fn snapshot(&self) -> DesktopUpdateSnapshot {
        self.snapshot.clone()
    }

    fn require_phase(
        &self,
        expected: DesktopUpdatePhase,
        next: DesktopUpdatePhase,
    ) -> Result<(), DesktopUpdateTransitionError> {
        if self.snapshot.phase == expected {
            Ok(())
        } else {
            Err(self.transition_error(next))
        }
    }

    fn transition_error(&self, to: DesktopUpdatePhase) -> DesktopUpdateTransitionError {
        DesktopUpdateTransitionError {
            from: self.snapshot.phase,
            to,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BoundedUpdateMetadata {
    pub build: Option<u64>,
    pub mandatory: bool,
    pub minimum_supported_version: Option<String>,
    pub critical: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ChannelPreference {
    channel: UpdateChannel,
}

pub fn load_update_channel(path: &Path) -> UpdateChannel {
    let Ok(mut file) = File::open(path) else {
        return UpdateChannel::default();
    };
    let Ok(metadata) = file.metadata() else {
        return UpdateChannel::default();
    };
    if !metadata.is_file() || metadata.len() > MAX_CHANNEL_FILE_BYTES {
        return UpdateChannel::default();
    }

    read_update_channel(&mut file)
}

fn read_update_channel(reader: &mut impl Read) -> UpdateChannel {
    let mut bytes = Vec::with_capacity(MAX_CHANNEL_FILE_BYTES as usize + 1);
    if reader
        .take(MAX_CHANNEL_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_CHANNEL_FILE_BYTES
    {
        return UpdateChannel::default();
    }

    serde_json::from_slice::<ChannelPreference>(&bytes)
        .ok()
        .map(|preference| preference.channel)
        .unwrap_or_default()
}

pub fn store_update_channel(path: &Path, channel: UpdateChannel) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temporary = path.with_extension(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| format!("{extension}.tmp"))
            .unwrap_or_else(|| "tmp".to_owned()),
    );
    let _ = fs::remove_file(&temporary);
    let payload = serde_json::to_vec(&ChannelPreference { channel })?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(&payload)?;
    file.sync_all()?;
    drop(file);

    if let Err(error) = replace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn parse_update_metadata(
    raw_json: &serde_json::Value,
    channel: UpdateChannel,
    installed_version: &str,
) -> BoundedUpdateMetadata {
    let build = raw_json
        .get("build")
        .and_then(serde_json::Value::as_u64)
        .filter(|build| *build <= MAX_BUILD);
    let mandatory = raw_json
        .get("mandatory")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let minimum_supported_version = raw_json
        .get("minimumSupportedVersion")
        .and_then(serde_json::Value::as_str)
        .filter(|version| version.len() <= MAX_VERSION_BYTES)
        .and_then(|version| Version::parse(version).ok())
        .map(|version| version.to_string());
    let below_minimum = minimum_supported_version
        .as_deref()
        .and_then(|minimum| Version::parse(minimum).ok())
        .zip(Version::parse(installed_version).ok())
        .is_some_and(|(minimum, installed)| installed < minimum);

    BoundedUpdateMetadata {
        build,
        mandatory,
        minimum_supported_version,
        critical: is_critical_stable(channel, mandatory, below_minimum),
    }
}

pub fn is_critical_stable(channel: UpdateChannel, mandatory: bool, critical: bool) -> bool {
    channel == UpdateChannel::Stable && mandatory && critical
}

pub fn update_endpoint(channel: UpdateChannel) -> Url {
    let endpoint = match channel {
        UpdateChannel::Stable => STABLE_UPDATE_ENDPOINT,
        UpdateChannel::Test => TEST_UPDATE_ENDPOINT,
    };

    Url::parse(endpoint).expect("static update endpoint is valid")
}

pub fn parse_update_channel_input(value: &str) -> Option<UpdateChannel> {
    match value {
        "stable" => Some(UpdateChannel::Stable),
        "test" => Some(UpdateChannel::Test),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn isolated_channel_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "letscube-updater-{name}-{}-{nonce}.json",
            std::process::id()
        ))
    }

    #[test]
    fn stable_is_default_and_endpoints_are_not_user_supplied() {
        assert_eq!(UpdateChannel::default(), UpdateChannel::Stable);
        assert_eq!(
            update_endpoint(UpdateChannel::Stable).as_str(),
            "https://api.letscube.ru/releases/updater/v1/windows/stable.json"
        );
        assert_eq!(
            update_endpoint(UpdateChannel::Test).as_str(),
            "https://api.letscube.ru/releases/updater/v1/windows/test.json"
        );
        assert_eq!(
            parse_update_channel_input("stable"),
            Some(UpdateChannel::Stable)
        );
        assert_eq!(
            parse_update_channel_input("test"),
            Some(UpdateChannel::Test)
        );
        assert_eq!(parse_update_channel_input("preview"), None);
        assert_eq!(
            parse_update_channel_input("https://evil.example/update.json"),
            None
        );
    }

    #[test]
    fn only_stable_can_force_a_critical_gate() {
        assert!(is_critical_stable(UpdateChannel::Stable, true, true));
        assert!(!is_critical_stable(UpdateChannel::Test, true, true));
        assert!(!is_critical_stable(UpdateChannel::Stable, false, true));
    }

    #[test]
    fn install_requires_an_available_or_critical_update() {
        let mut state = DesktopUpdateState::new(UpdateChannel::Stable, "0.2.0");
        assert!(state.begin_download().is_err());

        state.begin_check().unwrap();
        state.mark_available("0.2.1", false, Some(128)).unwrap();
        state.begin_download().unwrap();
        state.record_download_progress(64, Some(128));
        assert_eq!(state.snapshot().phase, DesktopUpdatePhase::Downloading);
        state.finish_verified_download().unwrap();

        assert!(state.begin_download().is_err());
        assert_eq!(state.snapshot().phase, DesktopUpdatePhase::Installing);
    }

    #[test]
    fn concurrent_update_checks_are_rejected() {
        let mut state = DesktopUpdateState::new(UpdateChannel::Stable, "0.2.0");
        state.begin_check().unwrap();

        assert!(state.begin_check().is_err());
        assert_eq!(state.snapshot().phase, DesktopUpdatePhase::Checking);
    }

    #[test]
    fn download_progress_is_bounded_and_installing_waits_for_verified_completion() {
        let mut state = DesktopUpdateState::new(UpdateChannel::Stable, "0.2.0");
        state.begin_check().unwrap();
        state.mark_available("0.2.1", false, Some(100)).unwrap();
        state.begin_download().unwrap();
        state.record_download_progress(60, Some(100));
        state.record_download_progress(60, Some(100));

        let downloading = state.snapshot();
        assert_eq!(downloading.phase, DesktopUpdatePhase::Downloading);
        assert_eq!(downloading.downloaded_bytes, 100);
        assert_eq!(downloading.total_bytes, Some(100));

        state.finish_verified_download().unwrap();
        assert_eq!(state.snapshot().phase, DesktopUpdatePhase::Installing);
    }

    #[test]
    fn channel_persistence_is_strict_atomic_and_defaults_to_stable() {
        let path = isolated_channel_path("strict");
        assert_eq!(load_update_channel(&path), UpdateChannel::Stable);

        store_update_channel(&path, UpdateChannel::Test).unwrap();
        assert_eq!(load_update_channel(&path), UpdateChannel::Test);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&path).unwrap()).unwrap(),
            serde_json::json!({ "channel": "test" })
        );
        assert!(!path.with_extension("json.tmp").exists());

        fs::write(&path, br#"{"channel":"preview"}"#).unwrap();
        assert_eq!(load_update_channel(&path), UpdateChannel::Stable);
        fs::write(
            &path,
            br#"{"channel":"test","endpoint":"https://evil.example"}"#,
        )
        .unwrap();
        assert_eq!(load_update_channel(&path), UpdateChannel::Stable);
        fs::write(&path, b"not-json").unwrap();
        assert_eq!(load_update_channel(&path), UpdateChannel::Stable);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn bounded_channel_reader_stops_after_max_plus_one_bytes() {
        let mut payload = br#"{"channel":"test"}"#.to_vec();
        payload.resize(MAX_CHANNEL_FILE_BYTES as usize + 1, b' ');
        let mut reader = Cursor::new(payload);

        assert_eq!(read_update_channel(&mut reader), UpdateChannel::Stable);
        assert_eq!(reader.position(), MAX_CHANNEL_FILE_BYTES + 1);
    }

    #[test]
    fn metadata_reads_only_bounded_fields_and_test_never_becomes_critical() {
        let raw = serde_json::json!({
            "build": 5,
            "mandatory": true,
            "minimumSupportedVersion": "0.3.0",
            "endpoint": "https://evil.example/update.json",
            "token": "must-not-be-read"
        });

        let stable = parse_update_metadata(&raw, UpdateChannel::Stable, "0.2.0");
        assert_eq!(stable.build, Some(5));
        assert!(stable.mandatory);
        assert_eq!(stable.minimum_supported_version.as_deref(), Some("0.3.0"));
        assert!(stable.critical);

        let test = parse_update_metadata(&raw, UpdateChannel::Test, "0.2.0");
        assert!(!test.critical);

        let oversized = serde_json::json!({
            "build": u64::MAX,
            "mandatory": "yes",
            "minimumSupportedVersion": "1".repeat(129)
        });
        let bounded = parse_update_metadata(&oversized, UpdateChannel::Stable, "0.2.0");
        assert_eq!(bounded.build, None);
        assert!(!bounded.mandatory);
        assert_eq!(bounded.minimum_supported_version, None);
        assert!(!bounded.critical);
    }

    #[test]
    fn snapshots_use_camel_case_fields() {
        let snapshot = DesktopUpdateState::new(UpdateChannel::Stable, "0.2.0").snapshot();

        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({
                "channel": "stable",
                "phase": "idle",
                "installedVersion": "0.2.0",
                "availableVersion": null,
                "downloadedBytes": 0,
                "totalBytes": null,
                "mandatory": false,
                "errorCode": null,
            })
        );
    }
}
