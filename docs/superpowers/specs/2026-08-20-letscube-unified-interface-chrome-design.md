# LETSCUBE Unified Interface Chrome Design

**Status:** approved direction, implementation pending  
**Date:** 2026-08-20  
**Scope:** shared web interface, administration dashboard, Windows Tauri shell  
**Out of scope:** iPhone/iPad PWA changes, backend schema changes, Android packaging, release signing

## Goal

Remove visible layout drift from the messenger, simplify settings and empty states, turn the administration summary into a useful operational surface, and make the Windows window frame part of the same LETSCUBE interface without changing messenger behavior.

## Approved Direction

Use one shared top application rail on desktop-sized viewports. The rail spans the sidebar and workspace, owns the single authenticated-shell LETSCUBE wordmark, and becomes the custom draggable title bar in the Windows client. The rows directly below it use one shared height and border baseline so the sidebar controls and chat header no longer produce staggered horizontal lines.

On mobile web and Android, the shared desktop rail is hidden. Existing compact navigation and native-safe behavior remain unchanged.

## Visual System

- Preserve the current dark LETSCUBE palette, light theme, typography, icon family, border language, and compact operational density.
- Use `--kub-*` semantic tokens. Do not introduce a second palette or isolated hard-coded theme.
- Use a shared chrome height token for the desktop app rail and a shared control-row height token for the sidebar and chat header.
- Keep border placement owned by the parent row instead of stacking unrelated child borders.
- Keep motion state-driven, short, and compatible with `prefers-reduced-motion`.
- Do not add decorative cards, feature badges, gradients in text, or unsupported security claims.

## Shared Application Chrome

### AppTopBar

Create a focused `AppTopBar` component above the desktop sidebar/workspace split.

Web behavior:

- render one horizontal LETSCUBE wordmark on the left;
- reserve the center as flexible space without marketing copy;
- show only real application state on the right when available;
- do not render window controls.

Windows behavior:

- render the same visual surface and wordmark;
- make safe empty regions draggable;
- render minimize, maximize/restore, and close controls on the right;
- close keeps the existing close-to-tray behavior;
- double-clicking the draggable region toggles maximize;
- controls have familiar icons, tooltips, keyboard focus, and stable hit targets;
- the startup surface uses matching chrome so navigation to the production web app does not flash between two frame styles.

The Tauri window changes from native decorations to custom decorations only after its bridge commands and startup chrome are covered by tests. Commands remain limited to the exact production origin and the `main` window.

### Aligned Control Rows

Below `AppTopBar`:

- `SidebarHeader` becomes one control row with search, profile/menu, notifications, and compose action;
- `ChatHeader` uses the same row height;
- both rows end on the same border baseline;
- folder tabs, topic strips, pinned messages, and search strips remain content-specific rows below that baseline;
- no child may visually extend its border into the neighboring column.

The authenticated shell keeps exactly one LETSCUBE wordmark. Mobile retains a compact mark only when the desktop rail is not rendered.

## Settings Version Presentation

The release distribution section must not expose build placeholders or source-control diagnostics to ordinary users.

- Never render `Сборка: 0.0.0`.
- Hide the technical footer when the version is missing, invalid, or equal to `0.0.0`.
- When a real semantic version exists, render `Версия X.Y.Z`.
- In a native client, append a real channel/platform label only when supplied by the runtime.
- Keep commit hashes available to internal diagnostics, not the ordinary profile/settings footer.

## Media Quality Control

Replace the three large option cards with one compact discrete track.

- The control has three stops: `Экономно`, `Стандарт`, `Высокое`.
- Each stop is a real radio option with keyboard and touch support.
- A single thumb/active segment communicates the selected value.
- Only the selected option's description appears below the track.
- The existing `MediaQuality` values, persistence, recording profiles, upload profiles, and playback behavior remain unchanged.
- The compact attachment-menu and expanded composer placements use the same component and semantics.

## Welcome Surface

Remove the four feature pills and claims such as `Шифрование`, `Реальное время`, and `Облачная синхронизация` from the empty chat surface.

The surface contains:

- the existing LETSCUBE mark;
- one plain `LETSCUBE` heading without gradient text;
- the factual message `Выберите диалог, чтобы открыть переписку.`

The empty state remains calm and centered and does not compete with the chat list.

## Administration Dashboard

The dashboard remains an operational interface rather than a marketing dashboard. It uses the already installed `Recharts` dependency and existing RLS-protected data sources.

### Information Hierarchy

1. Compact system-status strip: online users, messages today, new users, and active restrictions.
2. Seven-day registration trend derived from bounded profile timestamps.
3. Online/offline composition based on existing profile counts.
4. Recent users list, limited to the newest records visible through current RLS.
5. Recent audit events, limited to sanitized event metadata already used by the audit screen.
6. Attention summary for active bans/mutes and other already available operational counts.

### Data Rules

- Do not invent values or interpolate missing data.
- Fetch independent queries in parallel.
- Bound row-returning queries and reuse existing parsing/label helpers where practical.
- Keep the current 30-second refresh and realtime invalidation, but coalesce refreshes and avoid overlapping requests.
- Show explicit loading, empty, partial-error, and last-updated states.
- A failure in one secondary panel does not erase successfully loaded headline metrics.
- No schema or RLS change is part of this stage.

### Responsive Behavior

- Wide desktop uses a primary trend region with narrower recent-activity regions.
- Intermediate desktop stacks secondary regions below the trend.
- Mobile uses one linear column with horizontally safe charts and lists.
- Charts have textual summaries and do not rely on color alone.

## Windows Bridge

Extend the existing exact-origin `window.letscubeDesktop` bridge with narrowly scoped commands:

- `startDragging()`;
- `minimize()`;
- `toggleMaximize()`;
- `isMaximized()`;
- `closeToTray()`.

Rust commands reject non-main windows. The web app does not access generic shell execution, filesystem, or unrestricted window APIs. Existing updater, notification routing, tray, single-instance, profile isolation, and close-to-hide behavior remain unchanged.

## Error Handling

- Unsupported or unavailable desktop bridge methods hide or disable only native controls; they do not break the web shell.
- Window-command failures are sanitized and never displayed as raw Rust/JavaScript errors.
- Dashboard partial failures show a compact retry action for the affected region.
- Media quality selection always falls back to the existing `balanced` default.
- Version placeholders are omitted instead of replaced with misleading copy.

## Testing

### Test-first Contracts

- settings omit `Сборка: 0.0.0` and show a valid semantic version;
- media quality renders one three-stop radio track and preserves the stored value;
- WelcomeScreen no longer renders feature pills or unsupported claims;
- AppTopBar renders one authenticated-shell wordmark;
- sidebar and chat control-row border baselines differ by no more than one pixel;
- dashboard renders real metric, trend, recent-user, recent-event, empty, and partial-error states;
- web mode never exposes Windows controls;
- Windows mode exposes working controls and keeps close-to-tray behavior;
- Tauri startup and production surfaces use matching chrome geometry.

### Visual Matrix

- 3840x2160;
- 1920x1080;
- 1440x900;
- 390x844;
- 412x915;
- Windows Tauri QA at its minimum size and default 1360x860 size.

### Regression Guards

- notification grouping/read-sync;
- chat unread/bottom/search/notification anchoring;
- browser/PWA push;
- Android media/geolocation behavior;
- Windows notifications, updater, tray, single instance, and exact-origin policy;
- light and dark themes;
- no horizontal overflow or raw errors in UI.

## Delivery Sequence

1. Add failing web layout/settings/media/welcome tests.
2. Implement shared chrome and compact controls.
3. Add failing dashboard data-state and layout tests.
4. Implement the richer bounded dashboard.
5. Add failing Tauri bridge/titlebar tests.
6. Implement custom Windows chrome and startup parity.
7. Run full web, visual, Tauri, and Impeccable verification.

Each sequence remains independently reviewable. Production deployment and release promotion happen only after the complete validation matrix passes.
