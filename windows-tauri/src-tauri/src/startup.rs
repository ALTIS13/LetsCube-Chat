use crate::updater::{is_critical_stable, UpdateChannel};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupStage {
    Boot,
    NetworkCheck,
    TlsOriginCheck,
    UpdateCheck,
    ProductionNavigation,
    WorkspaceReady,
    Complete,
    RecoverableError,
    CriticalUpdateRequired,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupErrorCode {
    Network,
    TlsOrigin,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupSnapshot {
    pub stage: StartupStage,
    pub connected: bool,
    pub error_code: Option<StartupErrorCode>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StartupTransitionError {
    pub from: StartupStage,
    pub to: StartupStage,
}

#[derive(Clone, Debug)]
pub struct StartupState {
    stage: StartupStage,
    error_code: Option<StartupErrorCode>,
}

impl StartupState {
    pub fn new() -> Self {
        Self {
            stage: StartupStage::Boot,
            error_code: None,
        }
    }

    pub fn transition(&mut self, next: StartupStage) -> Result<(), StartupTransitionError> {
        if !matches!(
            (self.stage, next),
            (StartupStage::Boot, StartupStage::NetworkCheck)
                | (StartupStage::NetworkCheck, StartupStage::TlsOriginCheck)
                | (StartupStage::TlsOriginCheck, StartupStage::UpdateCheck)
                | (
                    StartupStage::UpdateCheck,
                    StartupStage::ProductionNavigation
                )
                | (
                    StartupStage::ProductionNavigation,
                    StartupStage::WorkspaceReady
                )
                | (StartupStage::WorkspaceReady, StartupStage::Complete)
        ) {
            return Err(StartupTransitionError {
                from: self.stage,
                to: next,
            });
        }

        self.stage = next;
        self.error_code = None;
        Ok(())
    }

    pub fn require_critical_update(
        &mut self,
        channel: UpdateChannel,
        mandatory: bool,
        critical: bool,
    ) -> Result<(), StartupTransitionError> {
        if self.stage != StartupStage::UpdateCheck
            || !is_critical_stable(channel, mandatory, critical)
        {
            return Err(StartupTransitionError {
                from: self.stage,
                to: StartupStage::CriticalUpdateRequired,
            });
        }

        self.stage = StartupStage::CriticalUpdateRequired;
        self.error_code = None;
        Ok(())
    }

    pub fn fail(&mut self, error_code: StartupErrorCode) -> Result<(), StartupTransitionError> {
        if self.stage == StartupStage::CriticalUpdateRequired {
            return Err(StartupTransitionError {
                from: self.stage,
                to: StartupStage::RecoverableError,
            });
        }

        self.stage = StartupStage::RecoverableError;
        self.error_code = Some(error_code);
        Ok(())
    }

    pub fn retry(&mut self) -> Result<(), StartupTransitionError> {
        if self.stage != StartupStage::RecoverableError {
            return Err(StartupTransitionError {
                from: self.stage,
                to: StartupStage::NetworkCheck,
            });
        }

        self.stage = StartupStage::NetworkCheck;
        self.error_code = None;
        Ok(())
    }

    pub fn snapshot(&self) -> StartupSnapshot {
        StartupSnapshot {
            stage: self.stage,
            connected: self.stage == StartupStage::Complete,
            error_code: self.error_code,
        }
    }
}

impl Default for StartupState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updater::UpdateChannel;

    #[test]
    fn startup_only_reaches_connected_after_every_real_stage() {
        let mut state = StartupState::new();
        assert!(state.transition(StartupStage::TlsOriginCheck).is_err());
        state.transition(StartupStage::NetworkCheck).unwrap();
        state.transition(StartupStage::TlsOriginCheck).unwrap();
        state.transition(StartupStage::UpdateCheck).unwrap();
        state
            .transition(StartupStage::ProductionNavigation)
            .unwrap();
        state.transition(StartupStage::WorkspaceReady).unwrap();
        state.transition(StartupStage::Complete).unwrap();
        assert_eq!(state.snapshot().stage, StartupStage::Complete);
        assert!(state.snapshot().connected);
    }

    #[test]
    fn recoverable_error_never_reports_connected() {
        let mut state = StartupState::new();
        state.fail(StartupErrorCode::Network).unwrap();
        assert_eq!(state.snapshot().stage, StartupStage::RecoverableError);
        assert!(!state.snapshot().connected);
    }

    #[test]
    fn tls_origin_failure_is_retryable_without_connecting() {
        let mut state = StartupState::new();
        state.transition(StartupStage::NetworkCheck).unwrap();
        state
            .fail(StartupErrorCode::TlsOrigin)
            .expect("TLS/origin failures must enter the retryable state");
        assert_eq!(state.snapshot().stage, StartupStage::RecoverableError);
        assert_eq!(
            state.snapshot().error_code,
            Some(StartupErrorCode::TlsOrigin)
        );
        assert!(!state.snapshot().connected);

        state.retry().unwrap();
        assert_eq!(state.snapshot().stage, StartupStage::NetworkCheck);
    }

    #[test]
    fn public_transition_cannot_enter_critical_update_required() {
        let mut state = StartupState::new();
        state.transition(StartupStage::NetworkCheck).unwrap();
        state.transition(StartupStage::TlsOriginCheck).unwrap();
        state.transition(StartupStage::UpdateCheck).unwrap();

        assert!(state
            .transition(StartupStage::CriticalUpdateRequired)
            .is_err());
    }

    #[test]
    fn critical_update_gate_requires_a_stable_typed_decision() {
        let mut test_channel_state = state_at_update_check();
        assert!(test_channel_state
            .require_critical_update(UpdateChannel::Test, true, true)
            .is_err());
        assert_eq!(
            test_channel_state.snapshot().stage,
            StartupStage::UpdateCheck
        );

        let mut stable_channel_state = state_at_update_check();
        stable_channel_state
            .require_critical_update(UpdateChannel::Stable, true, true)
            .unwrap();
        assert_eq!(
            stable_channel_state.snapshot().stage,
            StartupStage::CriticalUpdateRequired
        );
        assert!(!stable_channel_state.snapshot().connected);
    }

    #[test]
    fn critical_update_cannot_be_failed_or_retried() {
        let mut state = state_at_update_check();
        state
            .require_critical_update(UpdateChannel::Stable, true, true)
            .unwrap();

        assert!(state.fail(StartupErrorCode::Network).is_err());
        assert!(state.retry().is_err());
        assert_eq!(state.snapshot().stage, StartupStage::CriticalUpdateRequired);
        assert!(!state.snapshot().connected);
    }

    #[test]
    fn retry_recovers_only_from_recoverable_error_without_connecting() {
        let mut state = StartupState::new();
        assert!(state.retry().is_err());
        assert_eq!(state.snapshot().stage, StartupStage::Boot);
        assert!(!state.snapshot().connected);

        state.fail(StartupErrorCode::Network).unwrap();
        state.retry().unwrap();
        assert_eq!(state.snapshot().stage, StartupStage::NetworkCheck);
        assert_eq!(state.snapshot().error_code, None);
        assert!(!state.snapshot().connected);
    }

    fn state_at_update_check() -> StartupState {
        let mut state = StartupState::new();
        state.transition(StartupStage::NetworkCheck).unwrap();
        state.transition(StartupStage::TlsOriginCheck).unwrap();
        state.transition(StartupStage::UpdateCheck).unwrap();
        state
    }

    #[test]
    fn snapshots_use_camel_case_fields_and_snake_case_stages() {
        let mut state = StartupState::new();
        state.transition(StartupStage::NetworkCheck).unwrap();
        state.transition(StartupStage::TlsOriginCheck).unwrap();
        state.transition(StartupStage::UpdateCheck).unwrap();
        state
            .transition(StartupStage::ProductionNavigation)
            .unwrap();
        state.transition(StartupStage::WorkspaceReady).unwrap();
        state.transition(StartupStage::Complete).unwrap();

        assert_eq!(
            serde_json::to_value(state.snapshot()).unwrap(),
            serde_json::json!({
                "stage": "complete",
                "connected": true,
                "errorCode": null,
            })
        );
    }
}
