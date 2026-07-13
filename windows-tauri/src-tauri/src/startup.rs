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
                    StartupStage::UpdateCheck,
                    StartupStage::CriticalUpdateRequired
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

    pub fn fail(&mut self, error_code: StartupErrorCode) {
        self.stage = StartupStage::RecoverableError;
        self.error_code = Some(error_code);
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
        state.fail(StartupErrorCode::Network);
        assert_eq!(state.snapshot().stage, StartupStage::RecoverableError);
        assert!(!state.snapshot().connected);
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
