"use client";

import { KubIcon, KubLogo, type KubIconName } from "@/components/kub";

const FEATURES: { name: KubIconName; label: string }[] = [
  { name: "shield", label: "Шифрование" },
  { name: "zap", label: "Реальное время" },
  { name: "group", label: "Команды и топики" },
  { name: "cloud", label: "Облачная синхронизация" },
];

export function WelcomeScreen() {
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center gap-6 chat-bg">
      <div className="flex flex-col items-center gap-5 text-center px-8 max-w-md">
        <KubLogo size={88} withGlow />

        <div>
          <h2 className="text-3xl font-extrabold mb-2 kub-text-gradient">КУБ</h2>
          <p className="text-sm leading-relaxed text-[color:var(--kub-muted)]">
            Выберите чат из списка слева, чтобы начать общение.
            Сообщения приходят быстро, защищённо и всегда синхронизированы.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 justify-center mt-1">
          {FEATURES.map(({ name, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)]"
            >
              <KubIcon name={name} size={12} className="text-[color:var(--kub-cyan)]" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
