"use client";

import { useEffect, useMemo, useState } from "react";
import { KubIcon } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { createClient } from "@/lib/supabase/client";
import { COASSIGNEES_MAX } from "@/lib/taskCoassignees";
import type { Profile } from "@/types/database";
import { TASK_SEARCH_WELL } from "./taskFieldWell";

interface TaskCoassigneesFieldProps {
  value: Profile[];
  onChange: (next: Profile[]) => void;
  /** The responsible person, who is never offered as a co-executor too. */
  assigneeId: string | null;
}

/**
 * «Соисполнители» in the task form (tracker item 67): the people doing the
 * work beside the responsible one, found the way the assignee is found — by
 * name or @username — and shown as removable chips.
 */
export function TaskCoassigneesField({ value, onChange, assigneeId }: TaskCoassigneesFieldProps) {
  const supabase = useMemo(() => createClient(), []);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const full = value.length >= COASSIGNEES_MAX;

  useEffect(() => {
    const query = search.trim();
    if (!query || full) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`)
        .limit(8);
      const taken = new Set([...value.map((person) => person.id), assigneeId ?? ""]);
      setResults(((data ?? []) as Profile[]).filter((person) => !taken.has(person.id)));
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, supabase, value, assigneeId, full]);

  return (
    <div data-testid="task-coassignees-field">
      <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-accent-text)]">
        Соисполнители
      </label>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((person) => (
            <span
              key={person.id}
              data-testid="task-coassignee-chip"
              className="flex max-w-full items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1 text-sm kub-raise"
            >
              <UserAvatar user={person} size="sm" />
              <span className="min-w-0 truncate text-[color:var(--kub-text)]">{person.full_name ?? "Без имени"}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((other) => other.id !== person.id))}
                aria-label={`Убрать ${person.full_name ?? "соисполнителя"}`}
                className="rounded-full p-0.5 text-[color:var(--kub-muted)] kub-raise-hover"
              >
                <KubIcon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {!full && (
        <div className={TASK_SEARCH_WELL}>
          <KubIcon name="search" size={14} className="text-[color:var(--kub-muted)]" />
          <input
            type="text"
            data-testid="task-coassignee-search"
            placeholder="Добавить соисполнителя…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
          />
          {searching && <KubIcon name="spinner" size={14} className="text-[color:var(--kub-cyan)]" />}
        </div>
      )}
      {results.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-xl kub-raise">
          {results.map((person) => (
            <button
              type="button"
              key={person.id}
              onClick={() => {
                onChange([...value, person]);
                setSearch("");
                setResults([]);
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left kub-raise-hover"
            >
              <UserAvatar user={person} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[color:var(--kub-text)]">{person.full_name ?? "Без имени"}</div>
                {person.username && <div className="truncate text-[12px] text-[color:var(--kub-muted)]">@{person.username}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[12px] text-[color:var(--kub-muted)]">
        Ведут задачу вместе с исполнителем: берут её в работу и отправляют на подтверждение.
      </p>
    </div>
  );
}
