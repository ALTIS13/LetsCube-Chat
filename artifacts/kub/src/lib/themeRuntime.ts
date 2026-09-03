export type ResolvedTheme = "dark" | "light";

/**
 * Theme application, kept out of the React module so it can be tested directly.
 *
 * The theme is applied twice: once by an inline script in `index.html` before
 * the first paint, and once here on every change. Both must do the same four
 * things, or the page either flashes the wrong theme on load or stops following
 * the switcher afterwards.
 */

export const THEME_STORAGE_KEY = "kub-theme";
export const THEME_LEGACY_KEY = "kub:theme";

/**
 * The page background per theme, as literal values.
 *
 * The pre-paint bootstrap runs before any stylesheet is applied, so it cannot
 * read `--kub-bg`. `tests/unit/theme-bootstrap-parity.test.mjs` asserts these
 * stay equal to the stylesheet's own values.
 */
export const THEME_SURFACE_COLORS: Record<ResolvedTheme, string> = {
  dark: "#050B18",
  light: "#F4F8FC",
};

/** Everything a theme change must touch. */
export function applyResolvedTheme(resolved: ResolvedTheme, target?: Document): void {
  const doc = target ?? (typeof document === "undefined" ? undefined : document);
  if (!doc) return;

  const root = doc.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.setAttribute("data-theme", resolved);
  // Tells the user agent which palette its own controls, scrollbars and form
  // widgets should use, so they stop rendering dark-on-dark.
  root.style.colorScheme = resolved;

  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_SURFACE_COLORS[resolved]);
}

/**
 * The same logic as an inline pre-paint script.
 *
 * The keys and colours are interpolated rather than retyped so a rename cannot
 * leave the bootstrap reading something nothing writes. `index.html` carries a
 * copy of this because a static HTML file cannot import from TypeScript; the
 * parity test compares them.
 */
export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var saved = localStorage.getItem("${THEME_STORAGE_KEY}");
    if (saved !== "system" && saved !== "dark" && saved !== "light") {
      var legacy = localStorage.getItem("${THEME_LEGACY_KEY}");
      saved = (legacy === "dark" || legacy === "light") ? legacy : "system";
    }
    var resolved = saved;
    if (saved === "system") {
      // The Android shell marks the phone's night mode in the user agent,
    // because its WebView does not pass it through to the media query:
    // measured on two Android 15 phones with night mode on, this query said
    // light and the app rendered light on a dark phone.
    var recorded = null;
    try { recorded = localStorage.getItem("letscube:night"); } catch (e) {}
    // Inside a template literal a single backslash is consumed by the
    // string, so the emitted regex read /letscube-night/([01])/ — where the
    // inner slash closes the literal early and the whole bootstrap failed
    // to parse. It is doubled so the emitted script escapes the slash.
    var night = /letscube-night\\/([01])/.exec(navigator.userAgent);
    if (recorded === "1" || recorded === "0") { night = [null, recorded]; }
    if (night) {
      resolved = night[1] === "1" ? "dark" : "light";
    } else {
      resolved = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    }
    apply(resolved);
  } catch (e) {
    apply("dark");
  }
  function apply(resolved) {
    var root = document.documentElement;
    root.classList.remove("dark");
    root.classList.remove("light");
    root.classList.add(resolved);
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "light" ? "${THEME_SURFACE_COLORS.light}" : "${THEME_SURFACE_COLORS.dark}");
  }
})();
`.trim();
