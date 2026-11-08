import type { LucideIcon } from "lucide-react";

/**
 * The heading every card on the Live page shares (issue #818).
 *
 * The four sections had drifted: two headings at 14px with no icon, one at
 * 15px with an icon and a hint, and the flow diagram with no heading at all,
 * so the eye had nothing to anchor on and the first card was unlabelled. The
 * arbitration card was the one that read best, so its shape is the one kept.
 *
 * A component rather than a copied block, because four copies of a heading is
 * how they came to differ in the first place.
 *
 * Spec 197 (FR-E3.4): the icon is optional, and the Energy sections drop it.
 * A pie beside the donut it heads, a node graph over the flow: each icon only
 * repeated the card below it, on every card of the page.
 */
export function SectionHeader({
  icon: Icon,
  title,
  hint,
  aside,
}: {
  icon?: LucideIcon;
  title: string;
  /** Optional second line, for a section whose purpose is not obvious. */
  hint?: string;
  /** Optional right-aligned slot, e.g. the arbiter's state sticker. */
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 mb-4">
      {Icon && <Icon size={18} strokeWidth={1.5} className="text-text-secondary mt-0.5" />}
      <div className="min-w-0">
        <h2 className="text-lead font-semibold text-text">{title}</h2>
        {hint && <p className="text-caption text-text-secondary">{hint}</p>}
      </div>
      {aside}
    </div>
  );
}
