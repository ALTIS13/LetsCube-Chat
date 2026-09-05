import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubIcon } from "@/components/kub";

function isReplitHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host.includes("replit.dev") ||
    host.includes("replit.app") ||
    host.includes("replit.com") ||
    host.endsWith(".repl.co")
  );
}

/**
 * When the app runs inside a third-party iframe (e.g. the Replit preview
 * pane), browsers may block the storage that Supabase uses to persist the
 * auth session. In that case authenticated REST calls go out without a JWT
 * and trigger RLS errors like `42501`.
 */
export function IframeAuthBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch {
      inIframe = true;
    }
    if (!inIframe) return;

    let referrerHost = "";
    try {
      referrerHost = document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      referrerHost = "";
    }
    if (!isReplitHost(window.location.hostname) && !isReplitHost(referrerHost)) {
      return;
    }

    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) setShow(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setShow(!session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!show) return null;

  return (
    // `-strong`, because it covers the top of an application it is not part
    // of. What it replaced was an opaque warn/background mix with a
    // `backdrop-blur-sm` behind it — a blur over a flat fill returns that fill,
    // so the frosting was inert and the material was written by hand. The
    // warning is carried by the edge and the icon, both of which answer a 3:1
    // requirement rather than a 4.5:1 one.
    <div className="kub-glass-strong fixed top-0 inset-x-0 z-[9999] px-4 py-2.5 flex items-center gap-3 justify-center text-xs font-medium text-[color:var(--kub-text)] border-b-2 border-[color:var(--kub-warn)]">
      <KubIcon name="warning" size={14} tone="warn" className="flex-shrink-0" />
      <span className="text-center">
        Превью Replit запущено в iframe — браузер может блокировать сессию.
        Откройте приложение в новом окне для корректной работы.
      </span>
      <button
        onClick={() => window.open(window.location.href, "_blank", "noopener")}
        className="inline-flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 rounded-md bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] font-semibold hover:bg-[var(--kub-cyan-hover)] transition-colors"
      >
        <KubIcon name="externalLink" size={12} />
        Открыть в новом окне
      </button>
    </div>
  );
}
