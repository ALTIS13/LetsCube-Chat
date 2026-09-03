"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/app.store";
import { KubIcon, type KubIconName } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { cn } from "@/lib/utils";
import {
  EMPTY_ACHIEVEMENT_STATE,
  isCosmeticUnlocked,
  type AchievementState,
  type CosmeticDefinition,
} from "@/lib/achievementRules";
import { loadAchievementState, saveCosmeticSelection } from "@/lib/achievements";
import { backgroundStyle, canRenderCosmetic, frameStyle } from "@/lib/profileCosmetics";

/**
 * Earned decoration, and how to wear it.
 *
 * Everything shown here is the server's answer: which badges exist, which this
 * person holds, and how far the rest are. Choosing a decoration writes to the
 * profile and the database refuses anything unearned, so this screen is a view
 * onto entitlement rather than the thing that grants it.
 */
export function ProfileDecorationSection() {
  const currentUser = useAppStore((s) => s.currentUser);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [state, setState] = useState<AchievementState>(EMPTY_ACHIEVEMENT_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadAchievementState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить достижения.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const frames = useMemo(
    () => state.cosmetics.filter((item) => item.kind === "frame" && canRenderCosmetic(item.key)),
    [state.cosmetics],
  );
  const backgrounds = useMemo(
    () => state.cosmetics.filter((item) => item.kind === "background" && canRenderCosmetic(item.key)),
    [state.cosmetics],
  );

  const choose = useCallback(
    async (kind: "frame" | "background", key: string | null) => {
      if (!currentUser || saving) return;
      const column = kind === "frame" ? "profile_frame" : "profile_background";
      const previous = currentUser[column] ?? null;
      if (previous === key) return;

      setSaving(true);
      setError("");
      setCurrentUser({ ...currentUser, [column]: key });
      try {
        await saveCosmeticSelection(currentUser.id, kind === "frame" ? { frame: key } : { background: key });
      } catch {
        setCurrentUser({ ...currentUser, [column]: previous });
        setError("Не удалось сохранить оформление.");
      } finally {
        setSaving(false);
      }
    },
    [currentUser, saving, setCurrentUser],
  );

  if (!currentUser) return null;

  return (
    <div className="space-y-4">
      <Preview user={currentUser} />

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[color:var(--kub-muted)]">
          Достижения
        </h3>
        {loading ? (
          <p className="text-xs text-[color:var(--kub-muted)]">Загружаем…</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {state.achievements.map((achievement) => {
              const held = state.earned.has(achievement.key);
              const progress = state.progress[achievement.key];
              return (
                <li
                  key={achievement.key}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-xl border px-3 py-2.5",
                    held
                      ? "border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_10%,transparent)]"
                      : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]",
                  )}
                >
                  <KubIcon
                    name={(achievement.icon as KubIconName) ?? "crown"}
                    size={18}
                    className={held ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]"}
                  />
                  <div className="min-w-0">
                    <div
                      className={cn(
                        "text-sm",
                        held ? "text-[color:var(--kub-text)]" : "text-[color:var(--kub-muted)]",
                      )}
                    >
                      {achievement.title}
                    </div>
                    <div className="text-xs leading-relaxed text-[color:var(--kub-muted)]">
                      {achievement.description}
                    </div>
                    {!held && progress && (
                      <div className="mt-1.5">
                        <div className="h-1 overflow-hidden rounded-full bg-[var(--kub-surface)]">
                          <div
                            className="h-full rounded-full bg-[color:var(--kub-cyan)] transition-[width] duration-500"
                            style={{
                              width: `${Math.min(100, Math.round((progress.current / progress.target) * 100))}%`,
                            }}
                          />
                        </div>
                        <div className="mt-1 text-[11px] text-[color:var(--kub-muted)]">
                          {progress.current} из {progress.target}
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CosmeticPicker
        title="Рамка аватара"
        items={frames}
        earned={state.earned}
        selected={currentUser.profile_frame ?? null}
        onSelect={(key) => void choose("frame", key)}
        renderSwatch={(key) => {
          const style = key ? frameStyle(key) : null;
          return (
            <span
              className="block h-9 w-9 rounded-full p-[3px]"
              style={{ background: style?.ring ?? "var(--kub-surface)" }}
            >
              <span className="block h-full w-full rounded-full bg-[var(--kub-bg)]" />
            </span>
          );
        }}
      />

      <CosmeticPicker
        title="Фон профиля"
        items={backgrounds}
        earned={state.earned}
        selected={currentUser.profile_background ?? null}
        onSelect={(key) => void choose("background", key)}
        renderSwatch={(key) => {
          const style = key ? backgroundStyle(key) : null;
          return (
            <span
              className="block h-9 w-14 rounded-lg border border-[color:var(--kub-border-color)]"
              style={{ background: style?.surface ?? "var(--kub-surface)" }}
            />
          );
        }}
      />

      {error && <p className="text-xs text-[color:var(--kub-danger)]">{error}</p>}
    </div>
  );
}

function Preview({
  user,
}: {
  user: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; profile_frame?: string | null; profile_background?: string | null };
}) {
  const background = backgroundStyle(user.profile_background);
  return (
    <div
      data-testid="decoration-preview"
      className="flex items-center gap-3 overflow-hidden rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-4 py-3"
      style={background ? { backgroundImage: background.surface } : undefined}
    >
      <UserAvatar user={user} size="lg" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-[color:var(--kub-text)]">
          {user.full_name ?? user.username ?? "Профиль"}
        </div>
        <div className="text-xs text-[color:var(--kub-muted)]">Так вас видят другие</div>
      </div>
    </div>
  );
}

function CosmeticPicker({
  title,
  items,
  earned,
  selected,
  onSelect,
  renderSwatch,
}: {
  title: string;
  items: CosmeticDefinition[];
  earned: ReadonlySet<string>;
  selected: string | null;
  onSelect: (key: string | null) => void;
  renderSwatch: (key: string | null) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[color:var(--kub-muted)]">
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        <Option
          label="Без оформления"
          active={selected === null}
          locked={false}
          onClick={() => onSelect(null)}
          swatch={renderSwatch(null)}
        />
        {items.map((item) => {
          const unlocked = isCosmeticUnlocked(item, earned);
          return (
            <Option
              key={item.key}
              label={item.title}
              active={selected === item.key}
              locked={!unlocked}
              onClick={() => unlocked && onSelect(item.key)}
              swatch={renderSwatch(item.key)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Option({
  label,
  active,
  locked,
  onClick,
  swatch,
}: {
  label: string;
  active: boolean;
  locked: boolean;
  onClick: () => void;
  swatch: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      aria-pressed={active}
      title={locked ? "Пока не открыто" : label}
      className={cn(
        "relative flex min-w-[6.5rem] flex-col items-center gap-1.5 rounded-xl border px-3 py-2.5 text-center transition-colors",
        active
          ? "border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)]"
          : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] hover:border-[color:var(--kub-cyan)]",
        locked && "cursor-not-allowed opacity-45 hover:border-[color:var(--kub-border-color)]",
      )}
    >
      {swatch}
      <span className="max-w-[7rem] truncate text-[11px] text-[color:var(--kub-text)]">{label}</span>
      {locked && (
        <span className="absolute right-1.5 top-1.5 text-[color:var(--kub-muted)]">
          <KubIcon name="lock" size={12} />
        </span>
      )}
    </button>
  );
}
