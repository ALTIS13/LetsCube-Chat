"use client";

export function WelcomeScreen() {
  return (
    <div
      className="flex-1 h-full flex flex-col items-center justify-center gap-6 chat-bg"
    >
      <div className="flex flex-col items-center gap-4 text-center px-8 max-w-sm">
        {/* Logo */}
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center text-4xl shadow-2xl"
          style={{
            background: "linear-gradient(135deg, var(--tg-accent), #3a6d9e)",
            boxShadow: "0 8px 32px rgba(82,136,193,0.3)",
          }}
        >
          ✈️
        </div>

        {/* Title */}
        <div>
          <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--tg-text)" }}>
            КУБ
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--tg-text-secondary)" }}>
            Выберите чат из списка слева, чтобы начать общение.
            Сообщения приходят быстро, защищённо и всегда синхронизированы.
          </p>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-2 justify-center mt-2">
          {["🔒 Шифрование", "⚡ Реальное время", "📱 На всех устройствах", "☁️ Облачная синхронизация"].map((feat) => (
            <span
              key={feat}
              className="px-3 py-1 rounded-full text-xs font-medium"
              style={{
                background: "rgba(82,136,193,0.12)",
                color: "var(--tg-text-secondary)",
                border: "1px solid rgba(82,136,193,0.2)",
              }}
            >
              {feat}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
