import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { ReleaseDownloadAction } from "./ReleaseDownloadAction";
import type { PublicPlatformState } from "@/lib/publicReleaseModel";

/**
 * One platform section: the real interface at a stable aspect ratio, the
 * platform, its status and exactly one action.
 *
 * The imagery is a screenshot of the shipping application, matched to the
 * reader's theme. A platform without a published build carries no image and no
 * download control, so nothing here implies a store listing or a release date.
 */

type Props = {
  platform: PublicPlatformState;
  onRetry?: () => void;
};

type Preview = { dark: string; light: string; ratio: string };

/**
 * Only a platform with a published build is illustrated.
 *
 * A single screenshot cannot be theme matched, and reusing another platform's
 * render under an unreleased heading would suggest a product that does not
 * exist yet. Those sections state their status instead.
 */
const PREVIEWS: Partial<Record<string, Preview>> = {
  windows: {
    dark: "/product/windows-messenger-dark.webp",
    light: "/product/windows-messenger-light.webp",
    ratio: "16 / 10",
  },
  android: {
    dark: "/product/android-messenger-dark.webp",
    light: "/product/android-messenger-light.webp",
    ratio: "780 / 1192",
  },
};

const FORM_FACTORS: Record<string, "desktop" | "phone"> = {
  windows: "desktop",
  macos: "desktop",
  android: "phone",
  ios: "phone",
};

const STATUS_LABELS: Record<PublicPlatformState["state"], string> = {
  loading: "Проверяем каталог релизов",
  available: "Stable доступна",
  unavailable: "Готовим выпуск",
  error: "Каталог сейчас недоступен",
};

/**
 * The status line under a platform heading.
 *
 * "unavailable" covers two different situations and only one of them is a
 * release being prepared. A platform with no published catalog at all has no
 * build and no schedule, so labelling it "Готовим выпуск" would announce
 * progress that does not exist — the same claim the button and the summary
 * already refuse to make.
 */
function statusLabel(platform: PublicPlatformState): string {
  if (!platform.catalogPublished) return "В разработке";
  return STATUS_LABELS[platform.state];
}

export function PlatformShowcase({ platform, onRetry }: Props) {
  const { resolvedTheme } = useTheme();
  const preview = PREVIEWS[platform.platform];
  const formFactor = FORM_FACTORS[platform.platform] ?? "desktop";
  const source = preview ? (resolvedTheme === "light" ? preview.light : preview.dark) : null;

  return (
    <section
      aria-labelledby={`platform-${platform.platform}`}
      className="border-t border-[color:var(--kub-border-color)] py-8 first:border-t-0 sm:py-12"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-12">
        <div className="min-w-0 lg:w-[38%]">
          <div className="flex items-center gap-2 text-[color:var(--kub-muted)]">
            <FormFactorGlyph kind={formFactor} />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {formFactor === "phone" ? "Мобильное приложение" : "Настольное приложение"}
            </span>
          </div>

          <h3 id={`platform-${platform.platform}`} className="mt-3 text-2xl font-bold text-[color:var(--kub-text)]">
            {platform.title}
          </h3>

          {/* The stale disclosure travels with the action, which the hero
              renders on its own, so printing it here too would duplicate it. */}
          <p className="mt-2 text-sm text-[color:var(--kub-muted)]">{statusLabel(platform)}</p>

          <div className="mt-6">
            <ReleaseDownloadAction platform={platform} onRetry={onRetry} />
          </div>
        </div>

        {source && (
          <div className="min-w-0 flex-1">
            {/* A fixed ratio so the section never reflows while the image
                decodes, and the box is reserved before it arrives. */}
            <div
              className={cn(
                "mx-auto overflow-hidden rounded-xl border border-[color:var(--kub-border-color)]",
                formFactor === "phone" ? "max-w-[300px]" : "w-full",
              )}
              style={{ aspectRatio: preview?.ratio }}
            >
              <img
                src={source}
                alt={`Интерфейс LETSCUBE на платформе ${platform.title}`}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * A neutral form-factor mark. Platform logos are trademarks and carry an
 * endorsement reading we are not entitled to, so this says desktop or phone
 * instead of naming a vendor with its own glyph.
 */
function FormFactorGlyph({ kind }: { kind: "desktop" | "phone" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {kind === "desktop" ? (
        <>
          <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5.5 14h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="4" y="1.5" width="8" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7 12.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
