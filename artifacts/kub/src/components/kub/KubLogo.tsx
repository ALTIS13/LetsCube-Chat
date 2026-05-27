import { cn } from "@/lib/utils";
import { kubBrandAsset } from "./brandAssets";

interface KubLogoProps {
  size?: number;
  className?: string;
  withGlow?: boolean;
}

export function KubLogo({ size = 56, className, withGlow = false }: KubLogoProps) {
  return (
    <span
      className={cn("kub-cube-logo", withGlow && "kub-glow-cyan", className)}
      style={{
        width: size,
        height: size,
        borderRadius: `${size * 0.18}px`,
      }}
      aria-hidden="true"
    >
      <img
        src={kubBrandAsset("letscube-mark.svg")}
        alt=""
        draggable={false}
        className="h-[72%] w-[72%] object-contain"
      />
    </span>
  );
}
