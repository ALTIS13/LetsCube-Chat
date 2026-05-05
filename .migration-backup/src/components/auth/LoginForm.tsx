"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Mail, Lock, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) { setError(error.message); setGoogleLoading(false); }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--tg-bg)" }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-4xl shadow-2xl"
            style={{
              background: "linear-gradient(135deg, var(--tg-accent), #3a6d9e)",
              boxShadow: "0 8px 32px rgba(82,136,193,0.35)",
            }}
          >
            ✈️
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold" style={{ color: "var(--tg-text)" }}>
              КУБ
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--tg-text-secondary)" }}>
              Войдите в свой аккаунт
            </p>
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6 shadow-xl"
          style={{ background: "var(--tg-sidebar)" }}
        >
          {/* Email form */}
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            {/* Email */}
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ background: "var(--tg-input)" }}
            >
              <Mail size={16} style={{ color: "var(--tg-text-secondary)", flexShrink: 0 }} />
              <input
                type="email"
                placeholder="Эл. почта"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--tg-text)" }}
              />
            </div>

            {/* Password */}
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ background: "var(--tg-input)" }}
            >
              <Lock size={16} style={{ color: "var(--tg-text-secondary)", flexShrink: 0 }} />
              <input
                type={showPass ? "text" : "password"}
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--tg-text)" }}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                style={{ color: "var(--tg-text-secondary)" }}
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs px-1" style={{ color: "#ef4444" }}>{error}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all hover:brightness-110 active:scale-95 mt-1"
              style={{ background: "var(--tg-accent)", color: "#fff" }}
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              <span>Войти</span>
            </button>
          </form>
        </div>

        {/* Register link */}
        <p className="text-center text-sm mt-4" style={{ color: "var(--tg-text-secondary)" }}>
          Нет аккаунта?{" "}
          <Link href="/register" className="font-medium" style={{ color: "var(--tg-accent)" }}>
            Зарегистрироваться
          </Link>
        </p>
      </div>
    </div>
  );
}
