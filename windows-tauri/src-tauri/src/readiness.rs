use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DocumentState {
    Pending,
    Ready,
    Failed,
    Inactive,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DocumentAck {
    pub document_id: String,
    pub state: DocumentState,
    pub loaded: bool,
}

#[derive(Default)]
pub struct Readiness {
    generation: u64,
    started: bool,
    finished: bool,
    settled: bool,
    failed: bool,
    document: Option<String>,
    retired_document: Option<String>,
}

impl Readiness {
    pub fn document_id(&self) -> Option<&str> {
        self.document.as_deref()
    }

    pub fn invalidate(&mut self) {
        self.generation += 1;
        self.started = false;
        self.finished = false;
        self.settled = false;
        self.failed = false;
        if self.document.is_some() {
            self.retired_document = self.document.take();
        }
    }

    pub fn start(&mut self) -> u64 {
        self.invalidate();
        self.started = true;
        self.generation
    }

    pub fn page_finished(&mut self) {
        if self.started && !self.settled {
            self.finished = true;
        }
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.generation == generation && self.started && !self.settled
    }

    pub fn observe(&mut self, generation: u64, ack: &DocumentAck) -> Option<DocumentState> {
        if !self.is_current(generation)
            || ack.document_id.len() != 36
            || !ack
                .document_id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() || b == b'-')
            || self.retired_document.as_ref() == Some(&ack.document_id)
        {
            return None;
        }
        if let Some(document) = &self.document {
            if document != &ack.document_id {
                return None;
            }
        } else {
            self.document = Some(ack.document_id.clone());
        }
        match ack.state {
            DocumentState::Ready if self.finished && ack.loaded => {
                self.settled = true;
                Some(DocumentState::Ready)
            }
            DocumentState::Failed if !self.failed => {
                self.failed = true;
                Some(DocumentState::Failed)
            }
            DocumentState::Inactive => {
                self.settled = true;
                Some(DocumentState::Failed)
            }
            _ => None,
        }
    }

    pub fn expire(&mut self, generation: u64) -> bool {
        if !self.is_current(generation) {
            return false;
        }
        self.settled = true;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ack(state: DocumentState, document: u8) -> DocumentAck {
        DocumentAck {
            document_id: format!("00000000-0000-4000-8000-{document:012x}"),
            state,
            loaded: true,
        }
    }

    #[test]
    fn finished_without_app_ack_is_not_ready() {
        let mut gate = Readiness::default();
        let generation = gate.start();
        gate.page_finished();
        assert_eq!(
            gate.observe(generation, &ack(DocumentState::Pending, 1)),
            None
        );
        assert!(gate.is_current(generation));
    }

    #[test]
    fn both_ack_and_page_finished_orders_need_current_loaded_document() {
        for event_first in [true, false] {
            let mut gate = Readiness::default();
            let generation = gate.start();
            if event_first {
                assert_eq!(
                    gate.observe(generation, &ack(DocumentState::Ready, 1)),
                    None
                );
            }
            gate.page_finished();
            let mut loading = ack(DocumentState::Ready, 1);
            loading.loaded = false;
            assert_eq!(gate.observe(generation, &loading), None);
            assert_eq!(
                gate.observe(generation, &ack(DocumentState::Ready, 1)),
                Some(DocumentState::Ready)
            );
            assert_eq!(
                gate.observe(generation, &ack(DocumentState::Ready, 1)),
                None
            );
        }
    }

    #[test]
    fn same_document_navigation_and_stale_callbacks_cannot_complete() {
        let mut gate = Readiness::default();
        let first = gate.start();
        gate.observe(first, &ack(DocumentState::Pending, 1));
        gate.invalidate();
        gate.page_finished();
        assert_eq!(gate.observe(first, &ack(DocumentState::Ready, 1)), None);
        let second = gate.start();
        gate.page_finished();
        assert_eq!(gate.observe(first, &ack(DocumentState::Ready, 2)), None);
        assert_eq!(gate.observe(second, &ack(DocumentState::Ready, 1)), None);
        assert_eq!(
            gate.observe(second, &ack(DocumentState::Ready, 2)),
            Some(DocumentState::Ready)
        );
    }

    #[test]
    fn document_cannot_change_within_a_native_generation() {
        let mut gate = Readiness::default();
        let generation = gate.start();
        gate.observe(generation, &ack(DocumentState::Pending, 1));
        gate.page_finished();
        assert_eq!(
            gate.observe(generation, &ack(DocumentState::Ready, 2)),
            None
        );
    }

    #[test]
    fn inactive_document_and_deadline_never_become_success_or_affect_next_navigation() {
        let mut gate = Readiness::default();
        let generation = gate.start();
        assert_eq!(
            gate.observe(generation, &ack(DocumentState::Inactive, 1)),
            Some(DocumentState::Failed)
        );
        gate.page_finished();
        assert_eq!(
            gate.observe(generation, &ack(DocumentState::Ready, 1)),
            None
        );
        let next = gate.start();
        assert!(!gate.expire(generation));
        assert!(gate.expire(next));
        gate.page_finished();
        assert_eq!(gate.observe(next, &ack(DocumentState::Ready, 2)), None);
    }

    #[test]
    fn boot_failure_can_recover_on_a_fresh_current_document_ack_before_the_deadline() {
        let mut gate = Readiness::default();
        let generation = gate.start();
        assert_eq!(
            gate.observe(generation, &ack(DocumentState::Failed, 1)),
            Some(DocumentState::Failed)
        );
        assert!(gate.is_current(generation));
        assert_eq!(
            gate.observe(generation, &ack(DocumentState::Failed, 1)),
            None
        );
        gate.page_finished();
        assert_eq!(
            gate.observe(generation, &ack(DocumentState::Ready, 1)),
            Some(DocumentState::Ready)
        );
    }

    #[test]
    fn malformed_or_unstarted_ack_is_rejected() {
        let mut gate = Readiness::default();
        assert_eq!(gate.observe(0, &ack(DocumentState::Ready, 1)), None);
        let generation = gate.start();
        gate.page_finished();
        let mut invalid = ack(DocumentState::Ready, 1);
        invalid.document_id = "arbitrary payload".into();
        assert_eq!(gate.observe(generation, &invalid), None);
        assert!(serde_json::from_str::<DocumentAck>(
            r#"{"documentId":"x","state":"unknown","loaded":true}"#
        )
        .is_err());
    }
}
