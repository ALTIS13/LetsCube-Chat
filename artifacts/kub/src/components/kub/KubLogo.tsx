import { cn } from "@/lib/utils";

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
      <span style={{ fontSize: `${size * 0.5}px`, lineHeight: 1 }}>К</span>
    </span>
  );
}
