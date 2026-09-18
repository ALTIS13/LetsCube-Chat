import type { Page } from "@playwright/test";

/**
 * The instrument D-222 tier 2 is owed.
 *
 * The entry's tier-2 widths — «four Russian tabs at ~100px each», «a ~148px
 * description field», «352+320 at a 1024px viewport» — were arithmetic. This
 * reads the same numbers off the laid-out page and adds the two things
 * arithmetic cannot supply: **how many line boxes the text actually occupies**,
 * which separates a cramped control from a broken one, and **whether a box
 * clips or overflows**, which separates a word that is merely tight from a word
 * that is gone.
 *
 * Every target is addressed by its **class string**, not by its line number:
 * an attribute selector on the exact `class` React wrote. Line numbers move;
 * the string is the thing the register names.
 *
 * Nothing here asserts.
 */

export interface BoxReading {
  /** The element's own text, collapsed. Truncated so a report stays readable. */
  text: string;
  width: number;
  height: number;
  /** Line boxes the text occupies. Two or more means it wrapped. */
  lines: number;
  /** The widest line box of the box's own text. */
  textWidth: number;
  /** The box clips its own content rather than wrapping it. */
  clipped: boolean;
  /** The content is wider than the box and is **not** clipped: it spills. */
  overflows: boolean;
}

export interface Probe {
  box: BoxReading;
  /** Resolved grid tracks, when the box is a grid. */
  tracks: number[] | null;
  flexWrap: string;
  children: BoxReading[];
}

/**
 * Installs `__d222.probe(selector)` on the page.
 *
 * An init script rather than one `page.evaluate` per reading, so a measurement
 * taken before a patch and one taken after are taken by the same code.
 */
export async function installMeasure(page: Page) {
  await page.addInitScript(() => {
    const collapse = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 90);
    const round = (value: number) => Math.round(value * 100) / 100;

    /**
     * Distinct line boxes across every text node under `el`, and the widest.
     *
     * The width matters as much as the count: a `whitespace-nowrap` label
     * wider than its own content box spills into its padding without ever
     * raising `scrollWidth`, so «does it fit» has to be asked of the text.
     */
    const lineBoxes = (el: Element) => {
      const tops = new Set<number>();
      let widest = 0;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if ((node.textContent ?? "").trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width > 0.5) {
              tops.add(Math.round(rect.top * 2) / 2);
              widest = Math.max(widest, rect.width);
            }
          }
        }
        node = walker.nextNode();
      }
      return { lines: tops.size, textWidth: widest };
    };

    const reading = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const wider = el.scrollWidth > el.clientWidth + 0.5;
      const hidden = getComputedStyle(el).overflowX !== "visible";
      const text = lineBoxes(el);
      return {
        text: collapse(el.textContent ?? ""),
        width: round(rect.width),
        height: round(rect.height),
        lines: text.lines,
        textWidth: round(text.textWidth),
        clipped: wider && hidden,
        overflows: wider && !hidden,
      };
    };

    Object.defineProperty(window, "__d222", {
      configurable: true,
      value: {
        probe(selector: string) {
          return Array.from(document.querySelectorAll(selector)).map((el) => {
            const style = getComputedStyle(el);
            return {
              box: reading(el),
              tracks: style.display.includes("grid")
                ? style.gridTemplateColumns
                    .split(" ")
                    .filter(Boolean)
                    .map((value) => round(Number.parseFloat(value)))
                : null,
              flexWrap: style.flexWrap,
              children: Array.from(el.children).map((child) => reading(child)),
            };
          });
        },
      },
    });
  });
}

declare global {
  interface Window {
    __d222: { probe(selector: string): Probe[] };
  }
}

export async function probe(page: Page, selector: string): Promise<Probe[]> {
  return page.evaluate((value) => window.__d222.probe(value), selector);
}

/**
 * The eight lines D-222 tier 2 names, addressed by the class string each one
 * carries rather than by its line number.
 *
 * `L250` and `L266` are indistinguishable by class — the same row of two
 * buttons under «Команды» and under «Webhook» — so they share one entry and
 * the report keys them apart by their own text.
 */
export const TIER_2 = {
  "BotSettingsPanel L169 tabs": "[role='tablist']",
  "BotSettingsPanel L223 state buttons":
    'div[class="flex flex-col gap-2 sm:flex-row sm:flex-wrap"]',
  // Matched on the half of the class string a fix does not touch, so the same
  // probe reads the same box before and after one.
  "BotSettingsPanel L243 command grid":
    'div[class^="grid gap-2 border-b border-[color:var(--kub-rule)] pb-3"]',
  // Starts like the command and webhook rows, ends at the direction utility —
  // which excludes the state row (ends in `flex-wrap`), the privacy row (ends
  // in `items-center`) and the developer row (starts with `mb-4`).
  "BotSettingsPanel L250/L266 button rows": 'div[class^="flex flex-col gap-2 "][class$="flex-row"]',
  "BotSettingsPanel L278 privacy row":
    'div[class="flex flex-col gap-2 border-b border-[color:var(--kub-rule)] py-3 sm:flex-row sm:items-center"]',
  "BotSettingsPanel L287 token buttons":
    'div[class="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap"]',
  "SupportTicketDetails L150 split":
    'div[class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]"]',
} as const;

/**
 * The boxes a threshold would be expressed against, so the number in a fix is
 * a width somebody measured rather than a width somebody assumed.
 */
export const CONTAINERS = {
  "BotsPage detail pane": "[data-testid='bots-detail-pane']",
  "BotSettingsPanel section": 'section[aria-labelledby^="bot-section-"]',
} as const;

/**
 * Proof the shipped face is on the page, measured rather than asked.
 *
 * `document.fonts.check` answers `true` for a face that never loaded, so this
 * compares the advance width of a string in Inter against the same string in a
 * family that cannot exist. Equal widths mean the fallback is drawing.
 */
export async function interIsDrawing(page: Page) {
  return page.evaluate(async () => {
    const drawing = () => {
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return false;
      const sample = "Запросить полный доступ";
      context.font = '16px "___d222_absent___"';
      const fallback = context.measureText(sample).width;
      context.font = '16px "Inter", "___d222_absent___"';
      return Math.abs(context.measureText(sample).width - fallback) > 0.5;
    };
    // The face arrives over the network, so this is a race, not a state.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await document.fonts.ready;
      if (drawing()) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  });
}
