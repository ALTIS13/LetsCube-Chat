"use client";

import { KubLogo } from "@/components/kub";

export function WelcomeScreen() {
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center gap-6 chat-bg" data-testid="welcome-screen">
      <div className="flex flex-col items-center gap-5 text-center px-8 max-w-md">
        <KubLogo size={88} withGlow />

        <div>
          <h2 className="text-3xl font-extrabold mb-2 kub-text-gradient">LETSCUBE</h2>
          <p className="text-sm leading-relaxed text-[color:var(--kub-muted)]">
            Выберите диалог, чтобы открыть переписку.
          </p>
        </div>
      </div>
    </div>
  );
}
