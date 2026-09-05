"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  // Portalled, which this was not. Rendered in place, a tooltip inherits the
  // typography of whatever it is attached to — and a good many triggers here
  // are section headings carrying `uppercase tracking-wider`, so their tooltips
  // came out shouting in capitals. It also inherited any ancestor's
  // `overflow: hidden`, which clips a tooltip near the edge of a scrolling
  // panel. The portal fixes both at the source: the panel is rendered into
  // `body`, and the theme lives on `<html>`, so the tokens still reach it.
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // The three typography resets are belt and braces on top of the portal:
        // they state what a tooltip is rather than relying on nothing above it
        // ever setting a case or a tracking again.
        "z-50 overflow-hidden rounded-md border kub-glass-strong px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-popover-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
