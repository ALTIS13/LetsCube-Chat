"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { KubButton, KubIcon, KubModal, type KubIconName } from "@/components/kub";
import { BottomNav } from "@/components/layout/BottomNav";
import { SettingsErrorNotice, type SettingsScreen } from "@/components/settings/SettingsScreen";
import type { BottomNavDestination } from "@/lib/bottomNavDestinations";
import {
  SETTINGS_SECTION_TITLES,
  settingsSearchResult,
  visibleSettingsSections,
  type SettingsSectionId,
} from "@/lib/settingsRows";
import {
  SETTINGS_CONTENT_MEASURE,
  SETTINGS_OVERLAY_GUTTER_X,
  SETTINGS_OVERLAY_GUTTER_Y,
  SETTINGS_OVERLAY_MAX_HEIGHT,
  SETTINGS_OVERLAY_MAX_WIDTH,
  SETTINGS_RAIL_WIDTH,
  activeSettingsSection,
  settingsRailVisible,
} from "@/lib/settingsSurface";
import { cn } from "@/lib/utils";

/**
 * Settings are an overlay from `md` (D-285). On phones the menu opens a sheet,
 * while the Profile tab uses the same screen in the pane above the bottom nav.
 *
 * The owner asked for Discord's approach by name, and gave the two doors he
 * expects: «Закрыть настройки в дискорде я могу просто кликнув по крестику
 * справа сверху, либо по затемнению в любом месте сбоку от окна настроек.»
 * Both are here, and neither is new code — `KubModal` already routes its ✕, a
 * click on the dim and Escape through one `onClose`, and that one call is
 * `screen.requestClose()` so unsaved text is asked about once, in the screen
 * that owns it, exactly as D-136 left it.
 *
 * What this replaces, and why the register's previous answer is not simply
 * being undone, is in `lib/settingsSurface.ts`: D-160's objections are answered
 * on their own numbers rather than sidestepped. The two that live here rather
 * than in that module:
 *
 *  - **the rail spends the width the measure refuses.** The content keeps a
 *    560px measure because past 591 a value strands from its label again, so a
 *    panel wider than that has room to give something. Four headings and a
 *    search is what it gives, and both are things a reader uses;
 *  - **nothing is taken from the chat list.** Opening this leaves the list on
 *    screen at whatever width the person dragged it to, which is the whole of
 *    the defect: how much room conversations get and how wide the settings are
 *    were one number and are now two.
 *
 * The dialog gets its material from `KubModal`; the inline phone tab uses the
 * pane background, leaving the capsule clear of the settings scroller.
 */
export function SettingsOverlay({
  screen,
  isPhone,
  profileTab,
  onProfileTabSelect,
}: {
  screen: SettingsScreen;
  isPhone: boolean;
  profileTab: boolean;
  onProfileTabSelect: (destination: BottomNavDestination) => void;
}) {
  const [query, setQuery] = useState("");

  // A layout update must not re-register this modal above an open confirmation.
  const requestCloseRef = useRef(screen.requestClose);
  useLayoutEffect(() => { requestCloseRef.current = screen.requestClose; }, [screen.requestClose]);
  const leave = useCallback(() => void requestCloseRef.current(), []);

  const filtering = !isPhone && query.trim().length > 0;
  // The engine stays `lib/settingsRows.ts`, reached directly by
  // `tests/unit/settings-search.test.mts`. This decides how a result looks and
  // never what matches — the split the column made, kept.
  const { rows, sections, total } = useMemo(
    () => settingsSearchResult(query, { isStaff: screen.isStaff }),
    [query, screen.isStaff],
  );

  const railSections = useMemo(
    () => visibleSettingsSections({ isStaff: screen.isStaff }),
    [screen.isStaff],
  );

  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [railVisible, setRailVisible] = useState(true);
  const [active, setActive] = useState(0);

  /**
   * The panel is observed, not the window.
   *
   * `border-box`, because the panel's width includes its own border and a
   * content-box observer reports two pixels less — which is the difference
   * between showing the rail and not, once at the threshold. The same
   * correction interface-material records for the composer's `ResizeObserver`.
   */
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const read = () => setRailVisible(settingsRailVisible(node.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node, { box: "border-box" });
    return () => observer.disconnect();
  }, [screen.ready, isPhone, profileTab]);

  /** Which heading the rail marks. A query replaces the screen, so it marks none. */
  const syncActive = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const tops = railSections.map((id) => {
      const node = scroller.querySelector<HTMLElement>(`[data-settings-section='${id}']`);
      if (!node) return Number.POSITIVE_INFINITY;
      return node.offsetTop - scroller.offsetTop;
    });
    setActive(
      activeSettingsSection(tops, scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight),
    );
  }, [railSections]);

  useEffect(() => {
    if (!screen.ready) return;
    syncActive();
  }, [screen.ready, filtering, syncActive]);

  const jump = (id: SettingsSectionId) => {
    const scroller = scrollRef.current;
    const node = scroller?.querySelector<HTMLElement>(`[data-settings-section='${id}']`);
    if (!scroller || !node) return;
    // The heading sits at the top of the pane with the section's own top
    // padding above it, so the jump lands on the word rather than a rule.
    scroller.scrollTo({ top: node.offsetTop - scroller.offsetTop - 8, behavior: "smooth" });
  };

  if (!screen.ready) return null;

  const showRail = !isPhone && railVisible;
  const railWidth = showRail ? SETTINGS_RAIL_WIDTH : 0;

  const actions = (
    <div data-testid="settings-actions" className="flex items-center justify-end gap-2">
      {isPhone && <KubButton variant="ghost" onClick={leave}>Закрыть</KubButton>}
      <KubButton
        onClick={() => void screen.save()}
        disabled={screen.saving}
        loading={screen.saving}
        variant={screen.saved ? "secondary" : "primary"}
        size={isPhone ? undefined : "sm"}
        leftIcon={!screen.saving ? <KubIcon name="check" size={13} /> : undefined}
      >
        {screen.saved ? "Сохранено" : "Сохранить"}
      </KubButton>
    </div>
  );

  const content = (
      <div className="flex h-full min-h-0 w-full">
        {showRail && (
          <nav
            data-testid="settings-rail"
            aria-label="Разделы настроек"
            className="flex min-h-0 shrink-0 flex-col gap-2 border-r border-[color:var(--kub-rule)] p-3"
            style={{ width: `${railWidth}px` }}
          >
            <SettingsSearchField
              query={query}
              onQuery={setQuery}
              onLeave={leave}
              testId="settings-search-input"
            />
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {railSections.map((id, index) => {
                const dimmed = filtering && !sections.includes(id);
                const current = !filtering && index === active;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      data-testid={`settings-rail-${id}`}
                      data-current={current ? "true" : undefined}
                      aria-current={current ? "true" : undefined}
                      onClick={() => {
                        if (filtering) setQuery("");
                        // The scroller has to have the unfiltered screen back
                        // before it can be scrolled to a section of it.
                        requestAnimationFrame(() => jump(id));
                      }}
                      // One string for the base, not an array joined at
                      // runtime: control-vocabulary.test.mjs reads quoted
                      // strings out of the source, so a pressable whose
                      // interactive class and whose focus ring sit in two
                      // different literals reads as a control with no focus
                      // indicator. It did — that is how this was found. And
                      // the guard does not blank comments, so a class name in
                      // backticks anywhere above is read as a class list too;
                      // that is why none appears in this one.
                      className={cn(
                        "kub-interactive relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
                        current ? CHOSEN_ROW : RESTING_ROW,
                        dimmed && "opacity-40",
                      )}
                    >
                      {current && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--kub-cyan)]"
                        />
                      )}
                      <KubIcon name={SECTION_ICONS[id]} size={14} className="shrink-0" />
                      <span className="min-w-0 truncate">{SETTINGS_SECTION_TITLES[id]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!isPhone && !railVisible && (
            <div className="flex-shrink-0 border-b border-[color:var(--kub-rule)] p-3">
              <SettingsSearchField
                query={query}
                onQuery={setQuery}
                onLeave={leave}
                testId="settings-search-input"
              />
            </div>
          )}
          {filtering && (
            <div
              data-testid="settings-search-counter"
              className="flex-shrink-0 px-4 pt-3 text-xs tabular-nums text-[color:var(--kub-muted)]"
            >
              {total > 0
                ? `${total} в ${sections.length} ${sections.length === 1 ? "разделе" : "разделах"}`
                : "ничего не найдено"}
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={syncActive}
            data-testid="settings-scroll"
            className={cn("min-h-0 flex-1 overflow-y-auto", isPhone ? "pb-4" : "pb-6")}
          >
            {/* The measure, and the reason it is a variable rather than a class:
                `SettingsGroup` reads it, the phone sheet and any narrower pane
                leave it unset and are unchanged, and a spec can write it to
                drive the cards' container queries at one viewport — which is
                the instrument D-222 needs and a `@media` query cannot give. */}
            <div
              data-testid="settings-measure"
              className="mx-auto w-full"
              style={isPhone ? undefined : MEASURE_STYLE}
            >
              {!filtering && screen.identity}
              <SettingsErrorNotice error={screen.error} />
              {filtering && total === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-[color:var(--kub-muted)]">
                  Ничего не найдено в настройках.
                </p>
              ) : (
                screen.body(filtering ? rows : null)
              )}
            </div>
          </div>
        </div>
      </div>
  );

  if (isPhone && profileTab) {
    return (
      <section
        data-testid="settings-profile-tab"
        aria-label="Настройки"
        className="absolute inset-0 z-10 flex min-h-0 flex-col bg-[var(--kub-bg)] pt-window-top"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--kub-border-color)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <KubIcon name="settings" size={16} className="text-[color:var(--kub-cyan)]" />
            <h2 className="truncate text-base font-semibold text-[color:var(--kub-text)]">Настройки</h2>
          </div>
          <button
            type="button"
            onClick={leave}
            aria-label="Закрыть"
            className="kub-icon-action kub-interactive flex-shrink-0 rounded-lg p-1.5 text-[color:var(--kub-muted)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
          >
            <KubIcon name="close" size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1">{content}</div>
        <div className="shrink-0 border-t border-[color:var(--kub-border-color)] px-4 py-3">
          {actions}
        </div>
        <div className="relative h-[calc(var(--kub-bottom-nav)+var(--kub-bottom-nav-gap)*2)] shrink-0">
          <BottomNav onSelect={onProfileTabSelect} />
        </div>
      </section>
    );
  }

  return (
    <KubModal
      open
      onClose={leave}
      title="Настройки"
      icon={<KubIcon name="settings" size={16} />}
      size="xl"
      mobileSheet={isPhone}
      scrollBody={false}
      contentClassName="p-0"
      className={isPhone ? undefined : "sm:max-w-none"}
      // Built from the constants rather than beside them, so moving one moves
      // the rendered box and `settings-overlay.spec.ts` sees it.
      style={isPhone ? undefined : {
        width: `min(${SETTINGS_OVERLAY_MAX_WIDTH}px, calc(100vw - ${2 * SETTINGS_OVERLAY_GUTTER_X}px))`,
        height: `min(${SETTINGS_OVERLAY_MAX_HEIGHT}px, calc(100vh - ${2 * SETTINGS_OVERLAY_GUTTER_Y}px))`,
        maxHeight: "none",
      }}
      panelRef={panelRef}
      testId={isPhone ? undefined : "settings-overlay"}
      closeTestId={isPhone ? undefined : "settings-close"}
      footer={actions}
    >
      {content}
    </KubModal>
  );
}

/**
 * The chosen row and the resting one, in the product's own language rather
 * than a third of my own: a cyan wash that steps on hover, accent text, and a
 * 3px accent bar down the left edge — `ChannelRail`'s `TextChannelRow`, which
 * took it from the chat list.
 *
 * **Found by looking at the frame, not by a test.** The first version marked
 * the current section with a neutral inset fill and left the hover on the
 * standard veil, and the two read as the same highlight: every screenshot
 * showed *two* sections apparently selected — the one being read and the one
 * under the pointer — with nothing to say which was which. A state and a hover
 * have to differ in kind, not only in strength.
 *
 * No class name is spelled out in this comment on purpose: shell-glass counts
 * the veil class by raw text and does not blank comments, so naming it here
 * would raise that file's count by one and the guard would be measuring prose.
 */
const CHOSEN_ROW =
  "bg-[rgb(var(--kub-cyan-rgb)/0.14)] hover:bg-[rgb(var(--kub-cyan-rgb)/0.18)] text-[color:var(--kub-accent-text)]";
const RESTING_ROW =
  "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] kub-raise-hover";

/**
 * The measure, written as a plain quoted key on purpose.
 *
 * `theme-token-contract.test.mjs` counts a custom property as defined when the
 * stylesheet declares it **or** when some source file assigns it at runtime,
 * and it recognises the second by the shape `"--kub-…":`. A computed key —
 * `["--kub-settings-measure" as string]:` — is invisible to it, so the token
 * read as referenced and never defined, which is the class of defect that
 * class of check exists for: an undefined custom property resolves to nothing
 * rather than failing, and the cap would have been silently absent.
 */
const MEASURE_STYLE = {
  "--kub-settings-measure": `${SETTINGS_CONTENT_MEASURE}px`,
  maxWidth: "var(--kub-settings-measure)",
} as CSSProperties;

const SECTION_ICONS: Readonly<Record<SettingsSectionId, KubIconName>> = {
  profile: "user",
  notifications: "notifications",
  privacy: "eye",
  application: "settings",
  service: "shield",
};

/**
 * The one search field, wherever it is drawn.
 *
 * Escape empties it first and leaves on the second press, so a long query is
 * not lost to one keystroke — the two steps the in-chat search field takes and
 * the column took before this. Leaving goes through `requestClose`, not
 * `onClose`: this is one of D-136's five doors.
 */
function SettingsSearchField({
  query,
  onQuery,
  onLeave,
  testId,
}: {
  query: string;
  onQuery: (value: string) => void;
  onLeave: () => void;
  testId: string;
}) {
  return (
    <div className="kub-field h-9 min-w-0 shrink-0 gap-2 rounded-lg bg-[var(--kub-inset)] px-3 transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]">
      <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
      <input
        data-testid={testId}
        type="text"
        placeholder="Поиск по настройкам…"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          if (query) onQuery("");
          else onLeave();
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
      />
      {query && (
        <button
          type="button"
          onClick={() => onQuery("")}
          className="kub-icon-action kub-interactive shrink-0 rounded-md text-[color:var(--kub-muted)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
          aria-label="Очистить"
        >
          <KubIcon name="close" size={12} />
        </button>
      )}
    </div>
  );
}
