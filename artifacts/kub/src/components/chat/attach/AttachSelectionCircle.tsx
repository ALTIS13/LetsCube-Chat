import { cn } from "@/lib/utils";

/**
 * The circle in a picked item's corner: empty until the item is selected, then
 * filled with its place in the order, as Telegram numbers a selection. Over a
 * photo the ring is white so it reads on any picture; on the sheet it is muted.
 */
export function AttachSelectionCircle({ number, over }: { number: number | null; over: "photo" | "sheet" }) {
  const selected = number !== null;
  return (
    <span
      aria-hidden="true"
      data-attach-selection={selected ? number : "none"}
      className={cn(
        "flex h-[1.625rem] min-w-[1.625rem] shrink-0 items-center justify-center rounded-full border-2 px-1 text-[13px] font-bold leading-none tabular-nums",
        selected
          ? "border-[color:var(--kub-cyan)] bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
          : over === "photo"
          ? "border-white bg-black/25"
          : "border-[color:var(--kub-muted)]",
        selected && over === "photo" && "border-white",
      )}
    >
      {selected ? number : ""}
    </span>
  );
}
