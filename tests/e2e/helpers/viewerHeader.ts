import type { Page } from "@playwright/test";

/**
 * One definition of what the media viewer's header owes the picture's own name,
 * shared by the two specs that guard it.
 *
 * It is here because both of them had their own number, and both numbers were
 * wrong in the same way. `media-viewer-actions.spec.ts` required 80px and
 * `media-original-claim.spec.ts` required 60px; each was measured once, at one
 * width, in the browser shell, against a container that is the viewport minus a
 * fixed amount of chrome. So each said «at least this much at 390» and nothing
 * at any other width — and both stayed green through 2026-09-21, while the
 * header the product actually ships to a phone gave the title **12px at 360**
 * and 42px at 390: an ellipsis with no characters in front of it.
 *
 * Two things had to change for a number to mean anything again.
 *
 * The **unit**: the contract is «still a title rather than one letter and an
 * ellipsis», which is a statement about legible characters. Pixels are the
 * wrong unit for it, because how many characters a pixel buys depends on the
 * font the machine resolved — and `document.fonts.check` answers true for a
 * face that never loaded, so a run with the font hosts blocked measures Segoe
 * UI and gets a different answer for the same width.
 *
 * The **case**: «the busiest header» is the Android shell, whose file control
 * keeps its word at every width (D-147), on a video, the only kind with a
 * fourth control (D-148), showing a re-encoded upload, which adds the
 * originality badge. Both specs left the last one out while naming the first
 * two, and the badge was the item doing the damage.
 */

/**
 * The narrowest phone the product supports, carried by the contract rather than
 * left to `--project`.
 *
 * `chromium-mobile-360` is in `playwright.config.ts` and in almost nobody's
 * command line: across the tracker, the QA results and the defect register the
 * four habitual projects are named 115 times between them and this one 5. A
 * width nothing runs is a width nothing protects, so a contract about the
 * narrow end brings its own width and holds whichever project runs it.
 */
export const NARROWEST_PHONE = { width: 360, height: 800 };

/**
 * How much of the title has to survive the truncation, in characters.
 *
 * Eight is where a Russian file name gets past its first word. The measured
 * floor in the busiest header after the 2026-09-21 repair is 11 at 360, so the
 * bar has headroom rather than being pinned to one day's font metrics — and the
 * pre-repair layout reads 4, which is what this number exists to refuse.
 */
export const TITLE_CHARACTERS_REQUIRED = 8;

export interface ViewerHeaderFit {
  /** Pixels the header row scrolls by; anything above 0 hides a control. */
  overflow: number;
  /** The title element's own rendered width. Reported, not asserted on. */
  titleWidth: number;
  /** Characters of the title that fit with an ellipsis after them. */
  legible: number;
  /** Characters the title has. A short name may legitimately fit whole. */
  length: number;
  /** Whether the originality badge is really drawn, not merely present. */
  badgeDrawn: boolean;
}

/**
 * What the header does with the title, measured off the page.
 *
 * The widest prefix that still fits with an ellipsis after it, ruled in the
 * title's own computed font — so the answer is what a reader can read rather
 * than what `textContent` holds.
 */
export function measureViewerHeader(page: Page): Promise<ViewerHeaderFit | null> {
  return page.evaluate(() => {
    const control = document.querySelector('[data-testid="media-viewer-file-action"]');
    const row = control?.parentElement;
    const title = document.querySelector('[data-testid="media-viewer-title"]') as HTMLElement | null;
    if (!row || !title) return null;
    const text = (title.textContent ?? "").trim();
    const ruler = document.createElement("span");
    ruler.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    ruler.style.font = getComputedStyle(title).font;
    document.body.appendChild(ruler);
    const available = title.getBoundingClientRect().width;
    let legible = 0;
    for (let i = 1; i <= text.length; i += 1) {
      ruler.textContent = `${text.slice(0, i)}…`;
      if (ruler.getBoundingClientRect().width <= available) legible = i;
    }
    ruler.remove();
    const badge = document.querySelector('[data-testid="media-viewer-originality"]');
    return {
      overflow: row.scrollWidth - row.clientWidth,
      titleWidth: Math.round(available),
      legible,
      length: text.length,
      badgeDrawn: (badge?.getBoundingClientRect().width ?? 0) > 0,
    };
  });
}

/** The contract in words, for a failure message that says what was wrong. */
export function titleShortfall(fit: ViewerHeaderFit, width: number): string {
  return `${fit.legible} of ${fit.length} characters at ${width}px, title ${fit.titleWidth}px`;
}
