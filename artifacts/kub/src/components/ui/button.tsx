import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import {
  DISABLED_SINK,
  DISABLED_SINK_FILLED,
  FOCUS_RING,
  PRESS_FILLED,
  PRESS_SINK,
  PRESS_SINK_RAISED,
} from "@/lib/controlSurface"

// The stock shadcn palette (`bg-primary`, `bg-destructive`, `bg-accent`) is a
// second colour system standing beside the product's own: `--primary` is still
// the cyan LETSCUBE used before the accent moved, and nothing here reads a
// `--kub-*` token. Measured in the light theme, the filled variant carried its
// foreground at 3.62:1. This component renders nowhere in the product today —
// only other unused shadcn primitives import it — so this is not a repair of
// something on screen; it is making sure the next person who reaches for it
// gets the material rather than a fork of it.
const buttonVariants = cva(
  `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 ${FOCUS_RING}`,
  {
    variants: {
      variant: {
        default: `bg-[var(--kub-action-primary-background)] text-[color:var(--kub-action-primary-foreground)] hover:bg-[var(--kub-action-primary-hover)] ${PRESS_FILLED} ${DISABLED_SINK_FILLED}`,
        destructive:
          `bg-[var(--kub-action-danger-background)] text-[color:var(--kub-action-danger-foreground)] hover:bg-[var(--kub-action-danger-hover)] ${PRESS_FILLED} ${DISABLED_SINK_FILLED}`,
        outline:
          `border border-[color:var(--kub-border-color)] bg-transparent text-[color:var(--kub-text)] kub-raise-hover ${PRESS_SINK} ${DISABLED_SINK}`,
        secondary:
          `bg-transparent text-[color:var(--kub-text)] kub-raise hover:bg-[image:linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil)),linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil))] ${PRESS_SINK_RAISED} ${DISABLED_SINK_FILLED}`,
        ghost: `text-[color:var(--kub-text)] kub-raise-hover ${PRESS_SINK} ${DISABLED_SINK}`,
        link: "text-[color:var(--kub-accent-text)] underline-offset-4 hover:underline disabled:text-[color:var(--kub-muted)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
