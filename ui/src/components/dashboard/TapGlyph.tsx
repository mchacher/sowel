import { ChevronRight, Power, ShieldCheck } from "lucide-react";
import { tapGlyphOf, type MobileTapKind } from "./mobile-click-action";

const ICONS = { power: Power, chevron: ChevronRight, shield: ShieldCheck } as const;

/**
 * Spec 196 (pr8-geste) — the corner glyph telling what a tap on a mobile tile
 * does: power for a direct action, › for a sheet, a shield for a guarded one.
 * Decorative: the card's own `aria-label` says the same in words. 14 px in
 * secondary ink so it clears 3:1 on the card, where the old 11 px shield at
 * 70 % tertiary did not.
 */
export function TapGlyph({ kind, className = "" }: { kind: MobileTapKind; className?: string }) {
  const glyph = tapGlyphOf(kind);
  const Icon = ICONS[glyph];
  return (
    <Icon
      size={14}
      strokeWidth={1.5}
      aria-hidden="true"
      data-tap-glyph={glyph}
      className={`absolute top-1.5 right-1.5 text-text-secondary pointer-events-none ${className}`}
    />
  );
}
