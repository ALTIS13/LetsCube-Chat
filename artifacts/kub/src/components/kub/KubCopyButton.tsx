import { useEffect, useRef, useState } from "react";
import { copyWithFeedback } from "@/lib/actionFeedback";
import { MOTION_MS } from "@/lib/motion";
import { KubButton } from "./KubButton";
import { KubIcon } from "./KubIcon";

interface KubCopyButtonProps {
  /** What goes on the clipboard. */
  value: string;
  /** The button's own wording; also what the confirmation says was copied. */
  label?: string;
  /** Distinguishes this button's confirmation from another's. */
  feedbackKey: string;
  successTitle?: string;
  errorTitle?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
}

/**
 * Copy, with the result visible on the button itself.
 *
 * The transient card says what happened; this says it in the place the person
 * is already looking. The two are not redundant — the card is easy to miss when
 * the eyes are on the button that was just pressed.
 *
 * The label does not change with the icon, so the button keeps its width and
 * nothing beside it moves. A control that resizes on success makes the row
 * jump at the exact moment a person is about to click something else.
 */
export function KubCopyButton({
  value,
  label = "Скопировать",
  feedbackKey,
  successTitle = "Скопировано",
  errorTitle = "Не удалось скопировать",
  variant = "secondary",
  size = "sm",
  className,
}: KubCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    const ok = await copyWithFeedback(value, {
      success: successTitle,
      error: errorTitle,
      key: feedbackKey,
    });
    if (!ok) return;
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), MOTION_MS.feedback);
  };

  return (
    <KubButton
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => void copy()}
      leftIcon={<KubIcon name={copied ? "check" : "copy"} size={13} />}
    >
      {label}
      {/* Announced rather than shown: the visible label is deliberately stable,
          so without this a screen reader would hear nothing at all. */}
      <span className="sr-only" aria-live="polite">
        {copied ? successTitle : ""}
      </span>
    </KubButton>
  );
}
