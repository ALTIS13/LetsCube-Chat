import { cn } from "@/lib/utils";

interface KubStableSkeletonProps {
  /** Required. A placeholder that guesses its own size is the defect, not the fix. */
  width: string;
  height: string;
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
}

const ROUNDED = {
  sm: "rounded",
  md: "rounded-md",
  lg: "rounded-xl",
  full: "rounded-full",
} as const;

/**
 * A placeholder that must be told what it is standing in for.
 *
 * `KubSkeleton` takes its size from the classes a caller happens to pass, which
 * is fine inside a row template written next to the real row. This one is for
 * standalone use, and it makes the size a required argument on purpose: a
 * placeholder sized by the text "Загрузка…" is exactly the thing that makes the
 * page jump when the real content arrives, and it is easy to write by accident.
 */
export function KubStableSkeleton({
  width,
  height,
  className,
  rounded = "md",
}: KubStableSkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("kub-skeleton block", ROUNDED[rounded], className)}
      style={{ width, height }}
    />
  );
}
