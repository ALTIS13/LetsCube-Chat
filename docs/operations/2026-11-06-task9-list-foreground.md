# Task9: recheck list access on foreground return

2026-11-06. Source/browser accepted, physical signed Android and actual
revocation/regrant still open at this checkpoint.

`useTask` rechecked detail on foreground return and network recovery, but
`useTasks` used only task/checklist Realtime events. A former coassignee may
not be eligible for the event that took away access. The list could keep the
old card after a foreground return even while the detail became unavailable.

The list now uses its existing debounced, session-owned RLS read on visible
`visibilitychange` and `online`. It does not poll or request in a hidden tab.
RLS, permissions, list filters and the handling of explicit versus temporary
read failure are unchanged. Same-tick events share the existing debounce.

Two compiled-browser tests failed before the change: neither event dispatched
a second read. Both now pass: a 200 response without the exact task removes
the card; an online read restores the newly permitted row; event bursts do
not multiply reads. The compiled hidden-guard omission fails the no-background
assertion. **66/66** affected list, permissions and review tests passed.

Next native acceptance: the one reviewed private QA task under a quiet
Location Staff coassignee; observe a typed but unsent comment, revoke on Home,
verify editor and exact card retire, regrant on Home and open a fresh empty
editor. Do not infer two-draft acceptance from the Staff role. Use the
next signed candidate containing this change; retain Stable50 as the rollback.
