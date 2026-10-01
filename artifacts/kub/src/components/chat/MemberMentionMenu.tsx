import { useEffect, useRef } from "react";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { BotLikeAvatar } from "@/components/bots/BotAvatar";
import { FOCUS_RING } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";
import type { MemberMentionCandidate } from "@/lib/memberMentions";

export function MemberMentionMenu({ id, candidates, activeIndex, onChoose }: {
  id: string; candidates: readonly MemberMentionCandidate[]; activeIndex: number;
  onChoose: (candidate: MemberMentionCandidate) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);
  return (
    <div id={id} ref={list} role="listbox" aria-label="Участники чата" data-testid="member-mention-menu"
      className="kub-glass-strong bg-[var(--kub-surface-3)] w-full max-w-[420px] max-h-[min(23rem,40dvh)] overflow-y-auto overscroll-contain rounded-lg border border-[color:var(--glass-line)] p-1 shadow-lg">
      {candidates.length === 0 ? <p className="px-3 py-3 text-sm text-[color:var(--kub-muted)]">Никого не найдено</p>
        : candidates.map((candidate, index) => (
          <button key={`${candidate.kind}:${candidate.id}`} id={`${id}-${index}`} type="button" role="option"
            aria-selected={activeIndex === index} data-mention-id={candidate.id}
            aria-label={`${candidate.label.slice(1)}, ${candidate.kind === "bot" ? "бот" : "участник"}${candidate.disambiguator ? `, ${candidate.disambiguator}` : ""}`}
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(candidate)}
            className={cn("flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left kub-raise-hover", FOCUS_RING,
              activeIndex === index && "bg-[var(--kub-raised)]")}>
            {candidate.kind === "bot"
              ? <BotLikeAvatar size="sm" bot={{ id: candidate.id, display_name: candidate.label.slice(1), username: candidate.username ?? "", avatar_url: candidate.avatar_url }} />
              : <UserAvatar size="sm" user={{ id: candidate.id, full_name: candidate.label.slice(1), username: candidate.username ?? null, avatar_url: candidate.avatar_url ?? null }} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[color:var(--kub-text)]">{candidate.label.slice(1)}</span>
              <span className="block truncate text-xs text-[color:var(--kub-muted)]">
                {candidate.kind === "bot" ? "Бот" : "Участник"}{candidate.disambiguator ? ` · ${candidate.disambiguator}` : candidate.username ? ` · @${candidate.username}` : ""}
              </span>
            </span>
          </button>
        ))}
    </div>
  );
}
