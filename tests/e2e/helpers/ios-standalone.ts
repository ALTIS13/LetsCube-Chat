import { expect, type Page } from "@playwright/test";

/**
 * An installed iPhone web app, reproduced as far as a desktop machine can.
 *
 * Three things separate the app on the home screen from the same page in a
 * Safari tab, and no desktop engine emulates any of them on its own:
 *
 *  - **The unsafe areas.** With `viewport-fit=cover` the page is drawn under the
 *    status bar, the Dynamic Island and the home indicator, and
 *    `env(safe-area-inset-*)` says how much of each edge they take. Playwright's
 *    WebKit reports `0px` on all four sides whatever the viewport, so a layout
 *    that reads `env()` directly cannot be checked in the engine that matters.
 *    The application reads the insets through four custom properties declared
 *    once in `index.css`, and a custom property *can* be overridden — that is
 *    the only way Safari's own layout engine gets to arrange the product around
 *    a notch on this machine.
 *  - **`navigator.standalone`**, which WebKit leaves `undefined`.
 *  - **`(display-mode: standalone)`**, which WebKit answers `false`. CDP's media
 *    emulation is accepted by Chromium and still leaves `matchMedia` false, so
 *    the query is answered here instead.
 *
 * What this cannot tell is whether iOS itself honours any of it; the device
 * checklist exists for that. What it proves is the layout's half of the
 * contract: given those insets, nothing a person reads or taps is under the
 * hardware.
 *
 * The Chromium half is `emulateSafeAreaWithCdp`. It overrides the insets at the
 * source, so `env()` itself reports them — the one way to show that the tokens
 * really come from `env()` rather than only from the override above.
 */

export type Insets = { top: number; right: number; bottom: number; left: number };
export type Orientation = "portrait" | "landscape";

/**
 * iPhone 14 Pro, in points. The insets are Apple's for that model: the status
 * bar and Dynamic Island take 59 at the top in portrait and move to both long
 * edges in landscape, and the home indicator keeps 34 in portrait and 21 in
 * landscape.
 */
export const IPHONE_14_PRO: Record<Orientation, { viewport: { width: number; height: number }; insets: Insets }> = {
  portrait: { viewport: { width: 393, height: 852 }, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  landscape: { viewport: { width: 852, height: 393 }, insets: { top: 0, right: 59, bottom: 21, left: 59 } },
};

/** The four properties `index.css` declares from `env(safe-area-inset-*)`. */
export const SAFE_AREA_TOKENS = {
  top: "--kub-safe-top",
  right: "--kub-safe-right",
  bottom: "--kub-safe-bottom",
  left: "--kub-safe-left",
} as const;

export const EMULATION_STYLE_ID = "kub-ios-standalone-emulation";

/**
 * Installs the installed-app conditions into every document the page loads.
 *
 * Must be called before the first navigation. The tokens are injected as an
 * `!important` rule on `:root`, so they win over the stylesheet's own
 * declaration regardless of which of the two arrives first.
 */
export async function emulateInstalledIosApp(page: Page, insets: Insets): Promise<void> {
  await page.addInitScript(
    ({ insets, tokens, styleId }) => {
      try {
        Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true });
      } catch {
        /* a navigator that refuses the property still gets the media query */
      }

      const nativeMatchMedia = typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
      const displayMode = /\(\s*display-mode\s*:\s*([a-z-]+)\s*\)/i;
      const staticList = (query: string, matches: boolean) =>
        ({
          matches,
          media: query,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return false;
          },
        }) as unknown as MediaQueryList;
      window.matchMedia = (query: string) => {
        const mode = displayMode.exec(String(query));
        if (mode) return staticList(String(query), mode[1].toLowerCase() === "standalone");
        return nativeMatchMedia ? nativeMatchMedia(query) : staticList(String(query), false);
      };

      const css = `:root{${tokens.top}:${insets.top}px !important;${tokens.right}:${insets.right}px !important;${tokens.bottom}:${insets.bottom}px !important;${tokens.left}:${insets.left}px !important;}`;
      const install = () => {
        if (document.getElementById(styleId)) return true;
        const host = document.head ?? document.documentElement;
        if (!host) return false;
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = css;
        host.appendChild(style);
        return true;
      };
      if (!install()) {
        const observer = new MutationObserver(() => {
          if (install()) observer.disconnect();
        });
        observer.observe(document, { childList: true, subtree: true });
      }
    },
    { insets, tokens: SAFE_AREA_TOKENS, styleId: EMULATION_STYLE_ID },
  );
}

/**
 * Overrides the insets inside Chromium itself, so `env(safe-area-inset-*)`
 * reports them. The override belongs to the page's target and survives
 * navigation for as long as the session lives.
 */
export async function emulateSafeAreaWithCdp(page: Page, insets: Insets): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setSafeAreaInsetsOverride" as never, { insets } as never);
}

/**
 * What the four tokens resolve to, read through a computed padding.
 *
 * Padding rather than `getPropertyValue`: a padding is resolved to pixels by
 * every engine, while the raw custom property may come back as the unresolved
 * `env(...)` text. An undefined token resolves the padding to `0px`, which is
 * exactly the answer a surface reading it would get.
 */
export async function resolvedSafeAreaTokens(page: Page): Promise<Insets> {
  return page.evaluate((tokens) => {
    const probe = document.createElement("div");
    probe.style.cssText = [
      "position:fixed",
      "visibility:hidden",
      "pointer-events:none",
      "left:0",
      "top:0",
      `padding-top:var(${tokens.top})`,
      `padding-right:var(${tokens.right})`,
      `padding-bottom:var(${tokens.bottom})`,
      `padding-left:var(${tokens.left})`,
    ].join(";");
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const result = {
      top: parseFloat(style.paddingTop),
      right: parseFloat(style.paddingRight),
      bottom: parseFloat(style.paddingBottom),
      left: parseFloat(style.paddingLeft),
    };
    probe.remove();
    return result;
  }, SAFE_AREA_TOKENS);
}

export type SafeAreaViolation = {
  kind: "control" | "text";
  zone: "top" | "right" | "bottom" | "left";
  what: string;
  overlap: { x: number; y: number; width: number; height: number };
};

/**
 * Every control and every run of text a person can see, at rest, inside an
 * unsafe area.
 *
 * "Can see" is three conditions, and each one exists because leaving it out
 * produced a false answer:
 *
 *  - the box is clipped by the scroll containers it actually belongs to — a
 *    message scrolled out of its list is not on screen, even though its
 *    bounding box says it is. Clipping follows the containing-block chain, so
 *    a `fixed` menu is not clipped by the overflow of the column that happens
 *    to render it;
 *  - the part inside the unsafe area has real extent, more than a pixel each
 *    way, so a hairline border at a rounded edge is not reported;
 *  - it is on top there. The conversation runs behind the chat header on
 *    purpose, so a bubble under the status bar that the header covers is
 *    background, not content. Hit testing decides that, and hit testing skips
 *    `pointer-events: none`, so a glass layer does not count as covering.
 *
 * "At rest" is the fourth, and it is how an iPhone scroll view works rather than
 * a leniency: a page taller than the screen runs under the home indicator on
 * its way past, in every native app. What has to hold is that it can be
 * brought clear. So content whose own scroll container can still carry it away
 * from that edge is not reported there — and the scenarios scroll each such
 * container to its end and ask again, which is where missing end padding
 * shows. A `sticky` or `fixed` box does not move with the scroll, so it never
 * gets that allowance.
 *
 * Nothing a person wrote is ever put in the result unless `revealText` is set,
 * which only the fixture screens do: the signed-in screens show real people's
 * conversations, and a failure message is an artefact like any other.
 */
export async function findSafeAreaViolations(
  page: Page,
  insets: Insets,
  options: { revealText?: boolean } = {},
): Promise<SafeAreaViolation[]> {
  return page.evaluate(
    ({ insets, revealText }) => {
      type Box = { x0: number; y0: number; x1: number; y1: number };
      const width = window.innerWidth;
      const height = window.innerHeight;
      const viewport: Box = { x0: 0, y0: 0, x1: width, y1: height };
      const zones = (
        [
          ["top", { x0: 0, y0: 0, x1: width, y1: insets.top }],
          ["bottom", { x0: 0, y0: height - insets.bottom, x1: width, y1: height }],
          ["left", { x0: 0, y0: 0, x1: insets.left, y1: height }],
          ["right", { x0: width - insets.right, y0: 0, x1: width, y1: height }],
        ] as Array<[SafeAreaViolation["zone"], Box]>
      ).filter(([, zone]) => zone.x1 > zone.x0 && zone.y1 > zone.y0);

      const intersect = (a: Box, b: Box): Box | null => {
        const box = {
          x0: Math.max(a.x0, b.x0),
          y0: Math.max(a.y0, b.y0),
          x1: Math.min(a.x1, b.x1),
          y1: Math.min(a.y1, b.y1),
        };
        return box.x1 > box.x0 && box.y1 > box.y0 ? box : null;
      };

      const createsFixedContainingBlock = (style: CSSStyleDeclaration) => {
        const backdrop =
          style.getPropertyValue("backdrop-filter") || style.getPropertyValue("-webkit-backdrop-filter");
        return (
          style.transform !== "none" ||
          style.filter !== "none" ||
          (backdrop !== "" && backdrop !== "none") ||
          style.perspective !== "none" ||
          /\b(paint|layout|strict|content)\b/.test(style.contain) ||
          /\b(transform|filter|perspective)\b/.test(style.willChange)
        );
      };

      type Placement = {
        box: Box | null;
        /** Which unsafe edges a scroll container could still carry this away from. */
        canScrollClearOf: Set<SafeAreaViolation["zone"]>;
      };

      /**
       * The part of `rect` that is not clipped away by its own overflow chain,
       * and the edges its scroll containers could still move it away from.
       */
      const place = (element: Element, rect: DOMRect): Placement => {
        let box = intersect({ x0: rect.left, y0: rect.top, x1: rect.right, y1: rect.bottom }, viewport);
        const canScrollClearOf = new Set<SafeAreaViolation["zone"]>();
        const ownPosition = getComputedStyle(element).position;
        let reference = ownPosition;
        // A sticky or fixed box stays where it is while the container scrolls.
        let pinned = ownPosition === "sticky" || ownPosition === "fixed";
        let ancestor = element.parentElement;
        while (box && ancestor && ancestor !== document.documentElement) {
          const style = getComputedStyle(ancestor);
          const containsReference =
            reference === "fixed"
              ? createsFixedContainingBlock(style)
              : reference === "absolute"
                ? style.position !== "static" || createsFixedContainingBlock(style)
                : true;
          if (containsReference) {
            if (style.overflowX !== "visible" || style.overflowY !== "visible") {
              const outer = ancestor.getBoundingClientRect();
              const left = outer.left + ancestor.clientLeft;
              const top = outer.top + ancestor.clientTop;
              box = intersect(box, {
                x0: style.overflowX === "visible" ? -Infinity : left,
                y0: style.overflowY === "visible" ? -Infinity : top,
                x1: style.overflowX === "visible" ? Infinity : left + ancestor.clientWidth,
                y1: style.overflowY === "visible" ? Infinity : top + ancestor.clientHeight,
              });
              if (!pinned) {
                const scrollsY = /auto|scroll/.test(style.overflowY) && ancestor.scrollHeight > ancestor.clientHeight + 1;
                const scrollsX = /auto|scroll/.test(style.overflowX) && ancestor.scrollWidth > ancestor.clientWidth + 1;
                if (scrollsY && ancestor.scrollTop > 1) canScrollClearOf.add("top");
                if (scrollsY && ancestor.scrollTop + ancestor.clientHeight < ancestor.scrollHeight - 1) {
                  canScrollClearOf.add("bottom");
                }
                if (scrollsX && Math.abs(ancestor.scrollLeft) > 1) canScrollClearOf.add("left");
                if (scrollsX && Math.abs(ancestor.scrollLeft) + ancestor.clientWidth < ancestor.scrollWidth - 1) {
                  canScrollClearOf.add("right");
                }
              }
            }
            reference = style.position;
            if (style.position === "sticky") pinned = true;
          }
          ancestor = ancestor.parentElement;
        }
        return { box, canScrollClearOf };
      };

      const isShown = (element: Element) => {
        const check = (element as Element & { checkVisibility?: (options: object) => boolean }).checkVisibility;
        if (typeof check === "function") {
          return check.call(element, {
            checkOpacity: true,
            checkVisibilityCSS: true,
            opacityProperty: true,
            visibilityProperty: true,
          });
        }
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
      };

      /** Whether `owner` is what is painted on top at some point of `box`. */
      const onTopSomewhere = (owner: Element, box: Box) => {
        const xs = [(box.x0 + box.x1) / 2, box.x0 + (box.x1 - box.x0) / 4, box.x1 - (box.x1 - box.x0) / 4];
        const ys = [(box.y0 + box.y1) / 2, box.y0 + (box.y1 - box.y0) / 4, box.y1 - (box.y1 - box.y0) / 4];
        for (const x of xs) {
          for (const y of ys) {
            const top = document.elementFromPoint(x, y);
            if (!top) continue;
            if (top === owner || owner.contains(top) || top.contains(owner)) return true;
          }
        }
        return false;
      };

      const describe = (element: Element, text: string | null) => {
        const tag = element.tagName.toLowerCase();
        const own = element.getAttribute("data-testid");
        const role = element.getAttribute("role");
        const holder = element.parentElement?.closest("[data-testid]")?.getAttribute("data-testid");
        const label = revealText ? element.getAttribute("aria-label") : null;
        const snippet = revealText && text ? text.trim().replace(/\s+/g, " ").slice(0, 48) : null;
        return [
          tag,
          own ? `[data-testid="${own}"]` : "",
          role ? `[role="${role}"]` : "",
          label ? `[aria-label="${label}"]` : "",
          snippet ? ` "${snippet}"` : "",
          holder && holder !== own ? ` inside [data-testid="${holder}"]` : "",
        ].join("");
      };

      const found = new Map<string, SafeAreaViolation>();
      const report = (kind: SafeAreaViolation["kind"], owner: Element, placement: Placement, text: string | null) => {
        const box = placement.box;
        if (!box) return;
        for (const [zone, area] of zones) {
          if (placement.canScrollClearOf.has(zone)) continue;
          const overlap = intersect(box, area);
          if (!overlap || overlap.x1 - overlap.x0 <= 1 || overlap.y1 - overlap.y0 <= 1) continue;
          if (!onTopSomewhere(owner, overlap)) continue;
          const what = describe(owner, text);
          const key = `${kind}|${zone}|${what}`;
          if (found.has(key)) continue;
          found.set(key, {
            kind,
            zone,
            what,
            overlap: {
              x: Math.round(overlap.x0),
              y: Math.round(overlap.y0),
              width: Math.round(overlap.x1 - overlap.x0),
              height: Math.round(overlap.y1 - overlap.y0),
            },
          });
        }
      };

      const controls = document.querySelectorAll(
        [
          "button",
          "a[href]",
          'input:not([type="hidden"])',
          "select",
          "textarea",
          "summary",
          '[role="button"]',
          '[role="link"]',
          '[role="menuitem"]',
          '[role="tab"]',
          '[role="switch"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="option"]',
          '[contenteditable="true"]',
          '[contenteditable=""]',
        ].join(","),
      );
      for (const control of controls) {
        if (!isShown(control)) continue;
        const rect = control.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        report("control", control, place(control, rect), control.textContent);
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      });
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const owner = node.parentElement;
        if (!owner || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(owner.tagName) || !isShown(owner)) continue;
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width < 1 || rect.height < 1) continue;
          report("text", owner, place(owner, rect), node.nodeValue);
        }
      }

      return Array.from(found.values());
    },
    { insets, revealText: options.revealText ?? false },
  );
}

/**
 * The assertion every scenario makes, with its precondition. The emulated
 * insets must have reached the layout — otherwise an empty result proves
 * nothing — and the caller checks, before this, that the screen really holds
 * the surface under test.
 */
export async function expectClearOfHardware(
  page: Page,
  insets: Insets,
  where: string,
  options: { revealText?: boolean } = {},
): Promise<void> {
  expect(
    await resolvedSafeAreaTokens(page),
    "the emulated insets never reached the layout, so an empty result would prove nothing",
  ).toEqual(insets);
  const violations = await findSafeAreaViolations(page, insets, { revealText: options.revealText ?? true });
  expect(violations, `${where}: under the hardware\n${formatViolations(violations)}`).toEqual([]);
}

/** One line per violation, for an assertion message a person can act on. */
export function formatViolations(violations: SafeAreaViolation[]): string {
  return violations
    .map(
      (violation) =>
        `  ${violation.zone.padEnd(6)} ${violation.kind.padEnd(7)} ${violation.what} ` +
        `(${violation.overlap.width}x${violation.overlap.height} at ${violation.overlap.x},${violation.overlap.y})`,
    )
    .join("\n");
}
