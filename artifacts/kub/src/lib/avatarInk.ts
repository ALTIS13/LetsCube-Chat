/**
 * The readable ink for a generated avatar background.
 *
 * The monogram used to be `text-white` on every one of the pastel colours
 * above. All ten failed the 4.5:1 contrast requirement — the worst, `#FFEAA7`,
 * measured 1.19:1, which is not low contrast but an invisible letter — while
 * all ten pass comfortably with dark ink. The palette was picked for dark text
 * and was being drawn with light text. See D-012.
 *
 * This picks per colour rather than hardcoding dark ink, so a future palette
 * change cannot silently reintroduce the defect.
 */
export function avatarInkFor(background: string): string {
  const hex = background.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const channel = (offset: number) => {
    const value = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  const withWhite = 1.05 / (luminance + 0.05);
  const withBlack = (luminance + 0.05) / 0.05;
  return withBlack >= withWhite ? "#0B1220" : "#FFFFFF";
}
