import { cn } from "@/lib/utils";

interface KubSkeletonProps {
  className?: string;
}

/**
 * A placeholder block, sized by its caller to match what will replace it.
 *
 * The size is the whole point. A spinner in the middle of an empty panel tells
 * a person that something is happening but nothing about what is coming, and
 * when the data lands the layout jumps by the full height of the list. A
 * placeholder that holds the final dimensions means the page is already the
 * right shape before it has any content.
 */
export function KubSkeleton({ className }: KubSkeletonProps) {
  return <span aria-hidden="true" className={cn("kub-skeleton block", className)} />;
}

interface KubSkeletonRowsProps {
  /** How many placeholder rows to draw. */
  count?: number;
  /** Matches the real row's height, so nothing moves when the data arrives. */
  rowClassName?: string;
  className?: string;
  /** Announced to a screen reader in place of the silent shimmer. */
  label?: string;
}

/**
 * A list of placeholder rows, shaped like the list that is loading.
 *
 * It carries `aria-busy` and a label because the shimmer says nothing to a
 * screen reader: without it, the region is simply empty until it is not.
 */
export function KubSkeletonRows({
  count = 6,
  rowClassName,
  className,
  label = "Загрузка",
}: KubSkeletonRowsProps) {
  return (
    <div className={cn("space-y-px", className)} aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={cn("flex items-center gap-3 px-3 py-3", rowClassName)}
        >
          <KubSkeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <KubSkeleton className="h-3.5 w-[38%] rounded" />
            <KubSkeleton className="h-3 w-[62%] rounded" />
          </div>
          <KubSkeleton className="hidden h-5 w-24 shrink-0 rounded-md sm:block" />
        </div>
      ))}
    </div>
  );
}
