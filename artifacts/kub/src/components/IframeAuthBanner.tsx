import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubIcon } from "@/components/kub";

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
    <div className="fixed top-0 inset-x-0 z-[9999] px-4 py-2.5 flex items-center gap-3 justify-center text-xs font-medium bg-[color-mix(in_srgb,var(--kub-warn)_20%,var(--kub-bg))] text-[color:var(--kub-text)] border-b border-[color:var(--kub-warn)]/40 backdrop-blur-sm">
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
