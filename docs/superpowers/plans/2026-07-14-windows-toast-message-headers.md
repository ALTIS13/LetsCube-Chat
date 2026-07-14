# Windows Toast Message Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain five independently clickable unread message notifications per chat under a stable Windows Toast Header.

**Architecture:** The frontend derives a unique native tag from the notification row and a stable native group from the chat presentation tag. Rust validates the group/header contract, emits protocol-activated Toast Header XML, and removes cards by the same tag/group pair. The notifications hook trims overflow cards and closes every card whose row becomes read.

**Tech Stack:** React, TypeScript, Tauri 2, Rust, Windows.UI.Notifications, Node test runner.

## Global Constraints

- Preserve exact `chat` and `message` routing for every card.
- Keep at most five unread Windows message cards per chat.
- Do not change Browser/PWA push collapse or in-app notification grouping.
- Do not apply SQL or change Supabase schema/RLS.
- Do not publish Test or Stable before physical Windows QA passes.

---

### Task 1: Frontend Native Identity Contract

**Files:**
- Modify: `tests/unit/desktop-notification-adapter.test.mts`
- Modify: `artifacts/kub/src/lib/platform/desktopNotifications.ts`
- Modify: `artifacts/kub/src/types/desktop.d.ts`

**Interfaces:**
- Produces: native payload `{ id, group, header, title, body, kind, route }`.
- Produces: `desktopMessageOverflowRows(items, 5)` for deterministic trimming.

- [ ] **Step 1: Write a failing test** asserting two messages in one chat have different IDs, the same group/header, exact individual routes, and a chat-only header route.
- [ ] **Step 2: Run** `pnpm.cmd exec tsx --test tests/unit/desktop-notification-adapter.test.mts` and confirm the old same-ID assertion fails.
- [ ] **Step 3: Implement** unique message identity, stable native groups, header metadata, and overflow selection without changing browser tags.
- [ ] **Step 4: Run the targeted test** and confirm it passes.

### Task 2: Windows Toast Header Contract

**Files:**
- Modify: `windows-tauri/src-tauri/src/lib.rs`
- Modify: `tests/unit/tauri-shell.test.mjs`

**Interfaces:**
- Consumes: validated frontend native `group` and optional `header`.
- Produces: escaped `<header ... activationType="protocol"/>` and exact protocol routes.

- [ ] **Step 1: Write failing Rust/source tests** for header XML, bounded group/header fields, exact message route, and chat-only header route.
- [ ] **Step 2: Run** `cargo test notification -- --nocapture` and the Tauri shell test; confirm failure before implementation.
- [ ] **Step 3: Implement** request validation, header XML, `SetGroup`, and removal by the same unique tag/group pair.
- [ ] **Step 4: Run both targeted suites** and confirm all tests pass.

### Task 3: Five-Card Retention and Read Cleanup

**Files:**
- Modify: `artifacts/kub/src/hooks/useNotifications.ts`
- Test: `tests/unit/desktop-notification-adapter.test.mts`

**Interfaces:**
- Consumes: `desktopMessageOverflowRows` and `closeDesktopNotificationForRow`.
- Produces: at most five unread native cards per chat and immediate cleanup when rows become read.

- [ ] **Step 1: Add failing tests** for six unread rows yielding only the oldest overflow row and for isolation between chats/tasks.
- [ ] **Step 2: Run the targeted test** and confirm failure.
- [ ] **Step 3: Reconcile native unread row IDs** in `useNotifications`, close every read transition, and remove overflow rows while retaining browser tag cleanup.
- [ ] **Step 4: Run targeted unit tests** and confirm pass.

### Task 4: Build and Physical QA

**Files:**
- Update: `docs/QA_RESULTS.md`
- Update: `docs/native/WINDOWS_PACKAGING_PLAN.md`

**Interfaces:**
- Consumes: signed local 0.2.7 installer.
- Produces: physical evidence for fresh toast, Notification Center history, header grouping, exact routes, and five-card retention.

- [ ] **Step 1: Run** Rust, TypeScript, web build, release catalog, and diff/format validation.
- [ ] **Step 2: Build/sign/install** local `LETSCUBE_0.2.7_x64-setup.exe` without publishing channels.
- [ ] **Step 3: Send six unique QA messages** from the second account while LETSCUBE is hidden.
- [ ] **Step 4: Physically verify** the group contains at most five cards, each card opens its exact message, the header opens the chat, and chat read removes the group.
- [ ] **Step 5: Record results, commit, push, then publish/promote only after all physical checks pass.**

