import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/lib/controlSurface"

// Same story as button.tsx: the stock palette was never wired to the material,
// and the filled variant measured 3.62:1 in the light theme. The border goes
// with it — every filled variant declared `border-transparent`, an outline that
// drew nothing, and the neutral one is now a step of veil instead of a line.
const badgeVariants = cva(
  `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${FOCUS_RING}`,
  {
    variants: {
      variant: {
        default:
          "bg-[var(--kub-action-primary-background)] text-[color:var(--kub-action-primary-foreground)]",
        secondary:
          "kub-raise text-[color:var(--kub-text)]",
        destructive:
          "bg-[var(--kub-action-danger-background)] text-[color:var(--kub-action-danger-foreground)]",
        outline: "border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
