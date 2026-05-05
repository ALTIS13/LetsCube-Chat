import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface KubPanelProps extends HTMLAttributes<HTMLDivElement> {
  glow?: "none" | "cyan" | "pink" | "soft";
  padded?: boolean;
}

const glowClass = {
  none: "",
  cyan: "kub-glow-cyan",
  pink: "kub-glow-pink",
  soft: "kub-glow-soft",
} as const;

export const KubPanel = forwardRef<HTMLDivElement, KubPanelProps>(
  ({ glow = "none", padded = true, className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "kub-panel",
          padded && "p-5",
          glowClass[glow],
          className
        )}
        {...rest}
      >
        {children}
      </div>
    );
  }
);
KubPanel.displayName = "KubPanel";
