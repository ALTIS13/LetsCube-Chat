import { cn } from "@/lib/utils";
import { kubBrandAsset } from "./brandAssets";

interface KubBrandLogoProps {
  variant?: "horizontal" | "vertical" | "mark";
  tone?: "light" | "dark";
  className?: string;
  imgClassName?: string;
  decorative?: boolean;
  alt?: string;
}

export function KubBrandLogo({
  variant = "horizontal",
  tone = "light",
  className,
  imgClassName,
  decorative = false,
  alt = "Letscube",
}: KubBrandLogoProps) {
  const file =
    variant === "mark"
      ? "letscube-mark.svg"
      : variant === "vertical"
        ? tone === "dark"
          ? "letscube-logo-vertical-dark.svg"
          : "letscube-logo-vertical-light.svg"
        : tone === "dark"
          ? "letscube-logo-horizontal-dark.svg"
          : "letscube-logo-horizontal-light.svg";

  return (
    <span className={cn("inline-flex min-w-0 items-center", className)}>
      <img
        src={kubBrandAsset(file)}
        alt={decorative ? "" : alt}
        aria-hidden={decorative ? "true" : undefined}
        draggable={false}
        className={cn("block max-w-full object-contain", imgClassName)}
      />
    </span>
  );
}
