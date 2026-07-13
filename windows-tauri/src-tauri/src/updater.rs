use serde::{Deserialize, Serialize};
use url::Url;

const STABLE_UPDATE_ENDPOINT: &str =
    "https://api.letscube.ru/releases/updater/v1/windows/stable.json";
const TEST_UPDATE_ENDPOINT: &str = "https://api.letscube.ru/releases/updater/v1/windows/test.json";

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
    Downloading,
    Installing,
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

    pub fn start_downloading(&mut self) -> Result<(), DesktopUpdateTransitionError> {
        self.transition(DesktopUpdatePhase::Downloading)
    }

    pub fn begin_installing(&mut self) -> Result<(), DesktopUpdateTransitionError> {
        self.transition(DesktopUpdatePhase::Installing)
    }

    pub fn snapshot(&self) -> DesktopUpdateSnapshot {
        self.snapshot.clone()
    }

    fn transition(&mut self, next: DesktopUpdatePhase) -> Result<(), DesktopUpdateTransitionError> {
        if !matches!(
            (self.snapshot.phase, next),
            (DesktopUpdatePhase::Idle, DesktopUpdatePhase::Downloading)
                | (
                    DesktopUpdatePhase::Downloading,
                    DesktopUpdatePhase::Installing
                )
        ) {
            return Err(DesktopUpdateTransitionError {
                from: self.snapshot.phase,
                to: next,
            });
        }

        self.snapshot.phase = next;
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

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
    }

    #[test]
    fn only_stable_can_force_a_critical_gate() {
        assert!(is_critical_stable(UpdateChannel::Stable, true, true));
        assert!(!is_critical_stable(UpdateChannel::Test, true, true));
        assert!(!is_critical_stable(UpdateChannel::Stable, false, true));
    }

    #[test]
    fn installing_cannot_move_back_to_downloading() {
        let mut state = DesktopUpdateState::new(UpdateChannel::Stable, "0.2.0");
        state.start_downloading().unwrap();
        state.begin_installing().unwrap();

        assert!(state.start_downloading().is_err());
        assert_eq!(state.snapshot().phase, DesktopUpdatePhase::Installing);
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
