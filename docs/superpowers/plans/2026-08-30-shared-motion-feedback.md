# Shared Motion And Interaction Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give LETSCUBE consistent, polished and accessible visual feedback for presses, loading, success, errors, copying, panels and route-level state changes without slowing chat workflows or causing layout shifts.

**Architecture:** Define semantic CSS motion tokens and reduced-motion behavior, then add a small application feedback controller plus stable-dimension button feedback. Migrate high-value actions incrementally through shared helpers instead of adding component-local timers and alerts.

**Tech Stack:** React, CSS custom properties, existing LETSCUBE component system, Lucide/LETSCUBE icons, Node test runner, Playwright, Tauri WebView2 and Capacitor WebView.

**Spec:** `docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md`

## Global Constraints

- Timing tokens are 90 ms instant, 140 ms fast, 220 ms standard, 320 ms emphasized and approximately 2.4 seconds transient success.
- Prefer opacity and transform; never animate layout dimensions for decorative feedback.
- Loading placeholders retain the final component dimensions.
- Essential actions never wait for animation completion.
- `prefers-reduced-motion: reduce` removes decorative movement while preserving text/icon/color feedback.
- Do not create overlapping toast stacks that cover call, notification or native window controls.
- Preserve chat scroll anchoring, input focus, native titlebar dragging, Android keyboard insets and existing notification cards.
- iPhone/iPad PWA implementation remains owned by another agent; provide shared tokens and handoff notes without editing its specific runtime behavior.

## Task-Specific Skills

- Before UI implementation, read `impeccable`, `build-web-apps:react-best-practices`, `build-web-apps:frontend-testing-debugging` and `product-design:audit`.
- Use Playwright screenshots and reduced-motion emulation for visual QA.

---

### Task 1: Add semantic motion tokens and reduced-motion contracts

**Files:**
- Create: `artifacts/kub/src/lib/motion.ts`
- Create: `tests/unit/motion-contract.test.mts`
- Modify: `artifacts/kub/src/index.css`
- Modify: `artifacts/kub/src/components/kub/KubButton.tsx`
- Modify: `artifacts/kub/src/components/kub/KubModal.tsx`
- Modify: `artifacts/kub/src/components/kub/KubTooltip.tsx`

**Interfaces:**
- Produces: `MOTION_MS`, `feedbackDuration(kind)` and `prefersReducedMotion()`.
- Produces CSS variables `--kub-motion-instant`, `--kub-motion-fast`, `--kub-motion-standard`, `--kub-motion-emphasis`, `--kub-motion-feedback`.

- [x] **Step 1: Write failing token tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { MOTION_MS, feedbackDuration } from "../../artifacts/kub/src/lib/motion.ts";

test("motion timings match the approved semantic contract", () => {
  assert.deepEqual(MOTION_MS, { instant: 90, fast: 140, standard: 220, emphasis: 320, feedback: 2400 });
  assert.equal(feedbackDuration("success", false), 2400);
  assert.equal(feedbackDuration("success", true), 1600);
});
```

- [x] **Step 2: Run the unit test and verify it fails**

Run: `node --test tests/unit/motion-contract.test.mts`

Expected: FAIL because `motion.ts` does not exist.

- [x] **Step 3: Implement the semantic timing module**

```ts
export const MOTION_MS = Object.freeze({
  instant: 90,
  fast: 140,
  standard: 220,
  emphasis: 320,
  feedback: 2400,
});

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function feedbackDuration(_kind: "success" | "info" | "warning" | "error", reduced = prefersReducedMotion()) {
  return reduced ? 1600 : MOTION_MS.feedback;
}
```

- [x] **Step 4: Add CSS variables and reusable state classes**

```css
:root {
  --kub-motion-instant: 90ms;
  --kub-motion-fast: 140ms;
  --kub-motion-standard: 220ms;
  --kub-motion-emphasis: 320ms;
  --kub-motion-feedback: 2400ms;
  --kub-ease-standard: cubic-bezier(.2, .8, .2, 1);
  --kub-ease-emphasis: cubic-bezier(.16, 1, .3, 1);
}

.kub-interactive {
  transition-duration: var(--kub-motion-fast);
  transition-timing-function: var(--kub-ease-standard);
}
.kub-interactive:active:not(:disabled) { transform: scale(.98); }

@media (prefers-reduced-motion: reduce) {
  :root {
    --kub-motion-instant: 1ms;
    --kub-motion-fast: 1ms;
    --kub-motion-standard: 1ms;
    --kub-motion-emphasis: 1ms;
  }
  .kub-interactive:active:not(:disabled) { transform: none; }
}
```

Consolidate existing duplicate reduced-motion blocks rather than adding a third competing rule.

- [x] **Step 5: Apply tokens to core LETSCUBE controls**

Replace hard-coded `duration-150`/`duration-200` in `KubButton`, `KubModal` and `KubTooltip` with semantic classes. Preserve existing dimensions, focus rings and disabled behavior. Do not migrate all generated Radix wrappers in this task.

- [x] **Step 6: Run tests and commit**

```powershell
node --test tests/unit/motion-contract.test.mts
pnpm.cmd --filter @workspace/kub run typecheck
git add artifacts/kub/src/lib/motion.ts artifacts/kub/src/index.css artifacts/kub/src/components/kub tests/unit/motion-contract.test.mts
git commit -m "feat(ui): define LETSCUBE motion tokens"
```

---

### Task 2: Add a bounded global action-feedback system

**Files:**
- Create: `artifacts/kub/src/lib/actionFeedback.ts`
- Create: `artifacts/kub/src/hooks/useActionFeedback.ts`
- Create: `artifacts/kub/src/components/kub/KubFeedbackViewport.tsx`
- Create: `artifacts/kub/src/components/kub/KubCopyButton.tsx`
- Create: `tests/unit/action-feedback.test.mts`
- Create: `tests/e2e/action-feedback.spec.ts`
- Modify: `artifacts/kub/src/components/kub/index.ts`
- Modify: `artifacts/kub/src/App.tsx`

**Interfaces:**
- Produces: `showActionFeedback({ kind, title, detail?, key? })`.
- Produces: `copyWithFeedback(text, options) -> Promise<boolean>`.
- Viewport shows at most three items and deduplicates by key.

- [x] **Step 1: Write failing controller tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createActionFeedbackStore } from "../../artifacts/kub/src/lib/actionFeedback.ts";

test("feedback queue is bounded and keyed updates replace duplicates", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "success", title: "Один", key: "copy" });
  store.show({ kind: "success", title: "Два", key: "copy" });
  store.show({ kind: "info", title: "Три" });
  store.show({ kind: "warning", title: "Четыре" });
  store.show({ kind: "error", title: "Пять" });
  assert.equal(store.getSnapshot().length, 3);
  assert.equal(store.getSnapshot().some((item) => item.title === "Один"), false);
});
```

- [x] **Step 2: Run the controller test and verify it fails**

Run: `node --test tests/unit/action-feedback.test.mts`

Expected: FAIL because the controller is absent.

- [x] **Step 3: Implement the external-store controller**

Use `useSyncExternalStore` compatibility: immutable snapshots, subscription cleanup, unique IDs, keyed replacement, max three visible records and timer disposal. Error detail is bounded to 160 characters and accepts only already-sanitized UI text.

- [x] **Step 4: Implement the viewport**

Place it below the desktop topbar in the top-right safe region and above mobile bottom navigation with safe-area insets. Each item has icon, title, optional detail and accessible `role="status"` or `role="alert"`. Success disappears after 2.4 seconds; errors remain up to 5 seconds or until closed. The viewport is pointer-transparent outside visible items.

- [x] **Step 5: Implement stable copy feedback**

`KubCopyButton` keeps fixed width, swaps `copy` to `check`, exposes `aria-live` text and calls:

```ts
export async function copyWithFeedback(text: string, options: { success: string; error: string; key: string }) {
  try {
    await navigator.clipboard.writeText(text);
    showActionFeedback({ kind: "success", title: options.success, key: options.key });
    return true;
  } catch {
    showActionFeedback({ kind: "error", title: options.error, key: `${options.key}:error` });
    return false;
  }
}
```

- [x] **Step 6: Mount exactly one viewport and test it**

Mount `KubFeedbackViewport` once under providers in `App.tsx`. Playwright asserts copy icon transition, visible Russian confirmation, automatic dismissal, deduplication and no overlap with the topbar/window controls at desktop and bottom navigation on mobile.

- [x] **Step 7: Run tests and commit**

```powershell
node --test tests/unit/action-feedback.test.mts
pnpm.cmd --filter @workspace/kub run typecheck
pnpm.cmd exec playwright test tests/e2e/action-feedback.spec.ts
git add artifacts/kub/src/lib/actionFeedback.ts artifacts/kub/src/hooks/useActionFeedback.ts artifacts/kub/src/components/kub/KubFeedbackViewport.tsx artifacts/kub/src/components/kub/KubCopyButton.tsx artifacts/kub/src/components/kub/index.ts artifacts/kub/src/App.tsx tests/unit/action-feedback.test.mts tests/e2e/action-feedback.spec.ts
git commit -m "feat(ui): add bounded action feedback"
```

---

### Task 3: Migrate copy and save actions to consistent feedback

**Files:**
- Modify: `artifacts/kub/src/pages/admin/InvitesTab.tsx`
- Modify: `artifacts/kub/src/components/sidebar/ChatList.tsx`
- Modify: `artifacts/kub/src/components/search/SearchShared.tsx`
- Modify: `artifacts/kub/src/components/chat/MessageBubble.tsx`
- Modify: `artifacts/kub/src/pages/admin/UsersTab.tsx`
- Create: `tests/unit/copy-actions-contract.test.mjs`
- Modify: `tests/e2e/action-feedback.spec.ts`
- Modify: `tests/e2e/message-send-safety.spec.ts`

**Interfaces:**
- Consumes: `copyWithFeedback` and `KubCopyButton` from Task 2.
- Removes silent clipboard catches and component-local copy timers from migrated actions.

- [x] **Step 1: Write a failing static contract test**

Read the five target files and assert no direct `navigator.clipboard.writeText` remains outside `actionFeedback.ts`, no `.catch(() => {})` swallows copy failures, and each surface imports `copyWithFeedback` or `KubCopyButton`.

- [x] **Step 2: Run the contract test and verify it fails**

Run: `node --test tests/unit/copy-actions-contract.test.mjs`

Expected: FAIL on the current direct clipboard calls.

- [x] **Step 3: Migrate invitation-link copying first**

Replace `InvitesTab` local notice/timer with key `invite-link:<invite.id>`, success `Ссылка приглашения скопирована`, and error `Не удалось скопировать ссылку`. Keep the button width stable while the icon changes.

- [x] **Step 4: Migrate usernames and admin fields**

Use keys based on surface and profile ID. Do not include copied email or phone values in feedback text. Success strings are `Никнейм скопирован`, `Email скопирован` and `Номер скопирован`.

- [x] **Step 5: Migrate message copying**

The context action copies text, closes the menu immediately, shows `Сообщение скопировано`, and reports failure without changing selection, reply state or scroll position. Empty/media-only messages do not offer text copy.

- [x] **Step 6: Add browser interaction coverage**

Test invitation link, username and message copy. Assert feedback appears once, copy buttons remain the same bounding-box size, message scrollTop changes by at most one pixel, and reduced-motion mode uses no transform animation.

- [x] **Step 7: Run tests and commit**

```powershell
node --test tests/unit/copy-actions-contract.test.mjs
pnpm.cmd --filter @workspace/kub run typecheck
pnpm.cmd exec playwright test tests/e2e/action-feedback.spec.ts tests/e2e/message-send-safety.spec.ts
git add artifacts/kub/src/pages/admin/InvitesTab.tsx artifacts/kub/src/components/sidebar/ChatList.tsx artifacts/kub/src/components/search/SearchShared.tsx artifacts/kub/src/components/chat/MessageBubble.tsx artifacts/kub/src/pages/admin/UsersTab.tsx tests/unit/copy-actions-contract.test.mjs tests/e2e/action-feedback.spec.ts tests/e2e/message-send-safety.spec.ts
git commit -m "refactor(ui): unify copy action feedback"
```

---

### Task 4: Standardize loading, modal and save transitions

**Files:**
- Create: `artifacts/kub/src/components/kub/KubAsyncButton.tsx`
- Create: `artifacts/kub/src/components/kub/KubStableSkeleton.tsx`
- Create: `tests/unit/async-feedback-state.test.mts`
- Modify: `artifacts/kub/src/components/kub/KubButton.tsx`
- Modify: `artifacts/kub/src/components/kub/KubModal.tsx`
- Modify: `artifacts/kub/src/components/sidebar/SettingsModal.tsx`
- Modify: `artifacts/kub/src/pages/admin/InvitesTab.tsx`
- Modify: `artifacts/kub/src/App.tsx`
- Create: `tests/e2e/motion-layout-stability.spec.ts`

**Interfaces:**
- Produces async states `idle | loading | success | error` without changing control dimensions.
- Modal entry/exit uses opacity/transform and remains interruptible.

- [ ] **Step 1: Write failing async-state tests**

Test that `loading -> success -> idle` schedules only the transient success timer, a second action cancels the old timer, unmount clears timers, and reduced motion changes duration but not state order.

- [ ] **Step 2: Implement stable async button and skeleton**

`KubAsyncButton` reserves icon and label slots, overlays a spinner without removing label width, and exposes success/error icons. `KubStableSkeleton` requires explicit width/height or aspect ratio and never infers size from loading text.

- [ ] **Step 3: Make modal transitions geometry-stable**

Keep `KubModal` outer width, max-height and scroll owner unchanged across enter/open/exit. Animate only overlay opacity and panel `translateY(8px) scale(.99)` to identity. Do not animate height or padding.

- [ ] **Step 4: Apply to high-value save flows**

Use stable async feedback for Settings save and invite create/update. Successful settings show `Настройки сохранены`; network failures keep input values and show a sanitized feedback item. The Bot Platform plan adopts these primitives in `BotsPage` when that independent track is implemented.

- [ ] **Step 5: Stabilize route/loading screens**

The profile loading screen, public release loading and bot list loading use skeletons matching final dimensions. Existing startup secure-connection screen remains separate and must not have its timing or geometry changed by generic route animations.

- [ ] **Step 6: Add layout measurements**

Playwright captures bounding boxes before, during and after loading/success. Assert button width/height and modal panel bounds do not change, settings remain keyboard reachable, and chat scrollTop remains stable while an unrelated feedback item appears.

- [ ] **Step 7: Run tests and commit**

```powershell
node --test tests/unit/async-feedback-state.test.mts
pnpm.cmd --filter @workspace/kub run typecheck
pnpm.cmd exec playwright test tests/e2e/motion-layout-stability.spec.ts tests/e2e/visual-style-layout.spec.ts tests/e2e/unified-interface-chrome.spec.ts
git add artifacts/kub/src/components/kub artifacts/kub/src/components/sidebar/SettingsModal.tsx artifacts/kub/src/pages/admin/InvitesTab.tsx artifacts/kub/src/App.tsx tests/unit/async-feedback-state.test.mts tests/e2e/motion-layout-stability.spec.ts
git commit -m "feat(ui): stabilize async and modal feedback"
```

---

### Task 5: Complete cross-platform visual and regression QA

**Files:**
- Create: `docs/operations/shared-motion-feedback.md`
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`
- Modify: `docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md` only if the shipped token contract differs after review.

**Interfaces:**
- Produces shared web/Windows/Android evidence and a macOS/iOS handoff table.
- Does not modify iPhone/iPad PWA implementation code.

- [ ] **Step 1: Run complete browser validation**

```powershell
git diff --check
pnpm.cmd typecheck
pnpm.cmd e2e:smoke
pnpm.cmd exec playwright test tests/e2e/action-feedback.spec.ts tests/e2e/motion-layout-stability.spec.ts tests/e2e/visual-style-layout.spec.ts tests/e2e/notification-center.spec.ts tests/e2e/message-send-safety.spec.ts
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
```

- [ ] **Step 2: Run visual QA across themes and motion preferences**

Capture desktop `1920x1080`, desktop `1440x900`, mobile `390x844` and mobile `412x915` in light/dark and normal/reduced motion. Check no feedback overlaps notification bell, future call-control region, Tauri controls, Android keyboard or bottom navigation.

- [ ] **Step 3: Run Windows and Android regression checks**

Run `pnpm.cmd windows:tauri:test`, focused Tauri shell/startup QA, `pnpm.cmd android:sync` and `pnpm.cmd android:build:debug`. Physically verify one copy action and one settings save on available devices without modifying release signing.

- [ ] **Step 4: Record Apple handoff**

Document the CSS token names, semantic states, reduced-motion mapping, feedback safe-area rules and native substitutions expected for macOS/iOS. Record that Apple agents consume the contract after pulling `main` and must not fork a second feedback protocol.

- [ ] **Step 5: Deploy and inspect production**

Push the validated commit, verify exact-commit Coolify deployment, then test copy, settings, invite and error feedback on `https://app.letscube.ru`. Confirm no raw error payload appears and no feedback blocks chat use.

- [ ] **Step 6: Commit the QA record**

```powershell
git add docs/operations/shared-motion-feedback.md docs/PRODUCTION_PRIORITY_TRACKER.md docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md
git commit -m "docs(ui): record shared motion rollout"
```

## Task 1 closure

Done as written, with two corrections the tests forced.

The tokens first landed in the `.dark` block, because the anchor they were
placed beside turned out to live there rather than in `:root`. The theme parity
contract caught it immediately — motion is not a themed value, and a light-theme
user would have had none. They now sit in `:root`.

The two existing reduced-motion blocks were consolidated into one, as the step
required, rather than a third being added beside them.

`--kub-motion-feedback` deliberately does NOT collapse to 1ms under reduced
motion, and a test asserts that. The preference removes movement, not feedback:
collapsing it would delete the message a person still needs to read. The
shortening happens in `feedbackDuration`, which returns 1600ms instead.

Four mutations fail the contract: drifting a duration from `MOTION_MS`,
collapsing the feedback duration, letting the press transform survive reduced
motion, and a control writing its own Tailwind duration again.

## Task 2 closure

Done as written, with the placement corrected by measurement and one test
rewritten after it passed for the wrong reason.

**Placement.** The step said top-right. Put there, the card covered the staff
area's last navigation tab: that strip runs 56px to 101px, and the first offset
was 52px. A confirmation that hides a control is a worse trade than no
confirmation, so the viewport clears 101px everywhere. What the e2e pins is the
overlap with the navigation, not the offset — the number will change the moment
the chrome does.

**Task 3 came with it.** All five silent copy sites were migrated in the same
change, because leaving them silent would have shipped a feedback system nobody
could see. `InvitesTab` also stopped reporting success through a panel notice
that stayed until the next action replaced it, and `ChatList` stopped reporting
a refused clipboard through a modal alert — a heavy interruption for a clipboard
refusal.

**A failed copy is now reported.** Previously a refused clipboard write looked
exactly like a successful one, which is the worse half of the original defect:
silence read as success.

**Error duration is not shortened by reduced motion**, on the same reasoning
Task 1 recorded for the feedback token: the preference removes movement, not the
time a person needs to read a failure. Errors also get `role="alert"` where a
success gets `role="status"`.

**One test passed for the wrong reason and was rewritten.** The keyed-replacement
assertion was written inside a queue of five entries, so the bound of three
dropped the first one anyway — the test stayed green with keyed replacement
removed entirely. It is now asserted on its own, with two entries and nothing
else, plus two cases proving that unkeyed entries and differently-keyed entries
do not collapse.

Eight mutations fail the contract, including unbounding the queue, letting a
repeat stack, shortening an error under reduced motion, unbounding the detail,
returning a fresh snapshot on every read, letting the viewport intercept
clicks, sliding it back over the navigation, and silencing a failed copy.
