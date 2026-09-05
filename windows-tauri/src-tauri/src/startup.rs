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
    /// The chain validated and the origin matched, but the leaf certificate is
    /// not the one recorded on an earlier connection. Deliberately distinct
    /// from `TlsOrigin`: that one means the connection was never trusted and
    /// must not be continued past, while this one is what an ordinary renewal
    /// looks like and may be accepted once, explicitly.
    PeerChanged,
}

/// What the shell's own HTTPS request observed about the node's certificate,
/// and what it had recorded before. Every field is produced by the shell; none
/// of it is ever defaulted, so a screen with no certificate to show renders
/// nothing rather than a placeholder.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerIdentity {
    /// SHA-256 of the DER leaf certificate, lowercase hex.
    pub observed_sha256: String,
    /// The value recorded on an earlier connection, absent on the first one.
    pub expected_sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupSnapshot {
    pub stage: StartupStage,
    pub connected: bool,
    pub error_code: Option<StartupErrorCode>,
    /// Omitted entirely when the shell has nothing measured to report, so a
    /// build that never reaches the TLS stage emits exactly the payload it
    /// emitted before this field existed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer: Option<PeerIdentity>,
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
    peer: Option<PeerIdentity>,
    /// The fingerprint the person chose to continue past, for this attempt
    /// only. It is never written to disk as an "always allow": the next
    /// successful connection records the certificate it actually served, so a
    /// later change asks again.
    accepted_peer: Option<String>,
}

impl StartupState {
    pub fn new() -> Self {
        Self {
            stage: StartupStage::Boot,
            error_code: None,
            peer: None,
            accepted_peer: None,
        }
    }

    /// Records what the shell's request observed. Kept apart from the stage
    /// transitions so that carrying an identity can never move the machine.
    pub fn set_peer(&mut self, peer: PeerIdentity) {
        self.peer = Some(peer);
    }

    pub fn peer(&self) -> Option<&PeerIdentity> {
        self.peer.as_ref()
    }

    pub fn accepted_peer(&self) -> Option<&str> {
        self.accepted_peer.as_deref()
    }

    /// Accepts the observed certificate for the next attempt and rearms the
    /// machine. Only reachable from the state the comparison produced, so it
    /// cannot be used to skip a chain that failed to validate — that failure
    /// carries a different error code and never reaches here.
    pub fn accept_peer_change(&mut self) -> Result<(), StartupTransitionError> {
        if self.stage != StartupStage::RecoverableError
            || self.error_code != Some(StartupErrorCode::PeerChanged)
        {
            return Err(StartupTransitionError {
                from: self.stage,
                to: StartupStage::NetworkCheck,
            });
        }
        let Some(observed) = self.peer.as_ref().map(|peer| peer.observed_sha256.clone()) else {
            return Err(StartupTransitionError {
                from: self.stage,
                to: StartupStage::NetworkCheck,
            });
        };

        self.accepted_peer = Some(observed);
        self.stage = StartupStage::NetworkCheck;
        self.error_code = None;
        Ok(())
    }

    /// The node's certificate is not the recorded one. Only reachable from the
    /// stage that performs the comparison, so a caller cannot reach the
    /// override state from anywhere else in the machine.
    pub fn fail_peer_changed(
        &mut self,
        peer: PeerIdentity,
    ) -> Result<(), StartupTransitionError> {
        if self.stage != StartupStage::TlsOriginCheck {
            return Err(StartupTransitionError {
                from: self.stage,
                to: StartupStage::RecoverableError,
            });
        }

        self.stage = StartupStage::RecoverableError;
        self.error_code = Some(StartupErrorCode::PeerChanged);
        self.peer = Some(peer);
        Ok(())
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
            peer: self.peer.clone(),
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

    fn identity(observed: &str, expected: Option<&str>) -> PeerIdentity {
        PeerIdentity {
            observed_sha256: observed.to_owned(),
            expected_sha256: expected.map(str::to_owned),
        }
    }

    #[test]
    fn a_changed_pin_is_only_reachable_from_the_stage_that_compares() {
        // Reaching the override state from anywhere else would mean a failure
        // that never validated a chain could present the "continue" control.
        for stage in [
            StartupStage::Boot,
            StartupStage::NetworkCheck,
            StartupStage::UpdateCheck,
            StartupStage::ProductionNavigation,
        ] {
            let mut state = StartupState::new();
            state.stage = stage;
            assert!(state.fail_peer_changed(identity("a", None)).is_err());
        }

        let mut state = StartupState::new();
        state.transition(StartupStage::NetworkCheck).unwrap();
        state.transition(StartupStage::TlsOriginCheck).unwrap();
        state
            .fail_peer_changed(identity("aa", Some("bb")))
            .unwrap();
        let snapshot = state.snapshot();
        assert_eq!(snapshot.stage, StartupStage::RecoverableError);
        assert_eq!(snapshot.error_code, Some(StartupErrorCode::PeerChanged));
        assert!(!snapshot.connected);
    }

    #[test]
    fn accepting_a_change_is_refused_for_every_other_failure() {
        // A chain the trust store rejected, or no connection at all, must not be
        // continuable. Only the comparison's own failure may be accepted.
        for code in [StartupErrorCode::Network, StartupErrorCode::TlsOrigin] {
            let mut state = StartupState::new();
            state.transition(StartupStage::NetworkCheck).unwrap();
            // A fingerprint observed on an earlier attempt in this same process,
            // set before the failure. Without it the call is refused for the
            // wrong reason — there is no value to accept — and the stage guard
            // goes untested: measured, deleting that guard entirely left this
            // test green. The realistic shape is exactly this one, a peer seen
            // once and a later attempt whose chain the trust store rejects.
            state.set_peer(identity("observed", Some("recorded")));
            state.fail(code).unwrap();
            assert!(state.accept_peer_change().is_err());
            assert_eq!(state.snapshot().stage, StartupStage::RecoverableError);
            assert!(state.accepted_peer().is_none());
        }
    }

    #[test]
    fn accepting_a_change_arms_one_attempt_and_records_nothing_else() {
        let mut state = StartupState::new();
        state.transition(StartupStage::NetworkCheck).unwrap();
        state.transition(StartupStage::TlsOriginCheck).unwrap();
        state
            .fail_peer_changed(identity("observed", Some("recorded")))
            .unwrap();

        state.accept_peer_change().unwrap();
        assert_eq!(state.accepted_peer(), Some("observed"));
        assert_eq!(state.snapshot().stage, StartupStage::NetworkCheck);
        assert_eq!(state.snapshot().error_code, None);

        // The acceptance is for the value that was actually shown. A later
        // change to some third certificate must stop again rather than inherit
        // this decision.
        state.transition(StartupStage::TlsOriginCheck).unwrap();
        state
            .fail_peer_changed(identity("third", Some("recorded")))
            .unwrap();
        assert_ne!(state.accepted_peer(), Some("third"));
    }

    #[test]
    fn a_snapshot_without_a_measured_certificate_carries_no_peer_field() {
        // A build that never reaches the comparison must emit exactly the
        // payload it emitted before the field existed, so the screen renders no
        // fingerprint rather than an empty one.
        let state = StartupState::new();
        let json = serde_json::to_string(&state.snapshot()).unwrap();
        assert!(!json.contains("peer"), "{json}");

        let mut measured = StartupState::new();
        measured.set_peer(identity("observed", None));
        let json = serde_json::to_string(&measured.snapshot()).unwrap();
        assert!(json.contains("\"observedSha256\":\"observed\""), "{json}");
        assert!(json.contains("\"expectedSha256\":null"), "{json}");
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
