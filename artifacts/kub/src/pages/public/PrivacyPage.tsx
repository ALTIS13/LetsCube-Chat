import { useEffect } from "react";
import { Link } from "wouter";
import { KubButton, KubIcon } from "@/components/kub";
import {
  PRIVACY_POLICY,
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_VERSION,
  type PrivacyPolicyBlock,
} from "@/content/privacyPolicy";
import { PublicPageShell } from "./PublicPageShell";

export function PrivacyPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Политика конфиденциальности — LETSCUBE";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <PublicPageShell>
      <main className="public-policy mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="border-b border-[color:var(--kub-border-color)] pb-8 sm:pb-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--kub-pink)]">
                Правовые документы
              </p>
              <h1 className="mt-3 text-3xl font-bold leading-tight text-[color:var(--kub-text)] sm:text-4xl">
                {PRIVACY_POLICY.title}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[color:var(--kub-muted)] sm:text-base">
                {PRIVACY_POLICY.summary}
              </p>
            </div>
            <div className="public-page-print-hide flex flex-wrap items-center gap-2">
              <KubButton
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<KubIcon name="file" size={15} />}
                onClick={() => window.print()}
                data-testid="privacy-print"
              >
                Версия для печати
              </KubButton>
              <Link
                href="/support"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--kub-cyan)] px-3 text-xs font-semibold text-[color:var(--kub-bg)] hover:bg-[var(--kub-cyan-hover)]"
              >
                <KubIcon name="chats" size={15} />
                Задать вопрос
              </Link>
            </div>
          </div>

          <dl className="mt-7 grid gap-px overflow-hidden rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-border-color)] sm:grid-cols-3">
            <PolicyMeta label="Версия" value={PRIVACY_POLICY_VERSION} />
            <PolicyMeta label="Действует с" value={PRIVACY_POLICY_EFFECTIVE_DATE} />
            <PolicyMeta label="Оператор" value={PRIVACY_POLICY.operator.shortName} />
          </dl>
        </header>

        <div className="grid gap-10 py-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
          <aside className="public-page-print-hide lg:sticky lg:top-24 lg:self-start">
            <nav aria-label="Оглавление политики">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
                Оглавление
              </p>
              <ol className="space-y-0.5 border-l border-[color:var(--kub-border-color)]">
                {PRIVACY_POLICY.sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block border-l-2 border-transparent py-1.5 pl-3 text-xs leading-5 text-[color:var(--kub-muted)] transition-colors hover:border-[color:var(--kub-cyan)] hover:text-[color:var(--kub-text)]"
                    >
                      {section.title.replace(/^\d+\.\s*/, "")}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <article className="min-w-0">
            {PRIVACY_POLICY.sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-24 border-b border-[color:var(--kub-border-color)] py-7 first:pt-0 last:border-b-0"
              >
                <h2 className="text-xl font-bold leading-snug text-[color:var(--kub-text)] sm:text-2xl">
                  {section.title}
                </h2>
                <div className="mt-4 space-y-4 text-sm leading-7 text-[color:var(--kub-text-muted)] sm:text-[15px]">
                  {section.blocks.map((block, index) => (
                    <PolicyBlock key={`${section.id}-${index}`} block={block} />
                  ))}
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>
    </PublicPageShell>
  );
}

function PolicyMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--kub-surface)] px-4 py-3">
      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-[color:var(--kub-text)]">{value}</dd>
    </div>
  );
}

function PolicyBlock({ block }: { block: PrivacyPolicyBlock }) {
  if (block.kind === "paragraph") {
    return <p>{block.text}</p>;
  }

  if (block.kind === "list") {
    return (
      <ul className="space-y-2 pl-5">
        {block.items.map((item) => (
          <li key={item} className="list-disc marker:text-[color:var(--kub-cyan)]">
            {item}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <dl className="divide-y divide-[color:var(--kub-border-color)] border-y border-[color:var(--kub-border-color)]">
      {block.items.map((item) => (
        <div key={item.term} className="grid gap-1 py-3 sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-5">
          <dt className="font-semibold text-[color:var(--kub-text)]">{item.term}</dt>
          <dd>{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
