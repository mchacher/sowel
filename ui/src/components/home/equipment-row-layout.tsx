import { Children, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

/*
 * The parts of an equipment row in a zone panel (#1163). The row is one flex
 * line, and every piece on it is one of three kinds:
 *
 * - the name, which yields only to what is never hidden, by wrapping onto a
 *   second line (two at most) rather than being cut;
 * - readings, which are read-only and give way first (`RowReadings`): they take
 *   the room the name leaves and show as many of their items as fit, from the
 *   first, dropping the others whole, the last first. A row without controls
 *   keeps its first reading (`keepFirst`);
 * - controls (`RowControls`): never hidden, and the only part of the row that
 *   does not open the equipment page.
 *
 * The whole row is the name's link, stretched over the row (`RowName`); the
 * control groups sit above it, so a tap on a control never navigates.
 */

/** The row: one flex line; `relative` anchors the stretched link. */
export function EquipmentRow({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex items-center px-[1.1rem] py-[0.55rem] min-h-[52px] transition-colors duration-150 hover:bg-border-light/40">
      {children}
    </div>
  );
}

/**
 * The name, and the row's only link: up to two lines, then an ellipsis. Its
 * `::after` covers the whole row, so a tap anywhere outside a control opens the
 * equipment, and the keyboard focus ring outlines the row it opens. `badge`
 * sits right after the name (the degraded marker, spec 116).
 */
export function RowName({
  to,
  state,
  name,
  badge,
}: {
  to: string;
  state?: LinkProps["state"];
  name: string;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0 ml-[0.85rem] mr-1">
      <Link
        to={to}
        state={state}
        className="min-w-0 text-body font-medium text-text line-clamp-2 break-words text-balance hover:text-primary transition-colors after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary"
      >
        {name}
      </Link>
      {badge}
    </div>
  );
}

/**
 * Pushes what follows the name to the right edge when nothing else takes the
 * room (a row of controls only). A `RowReadings` takes it first.
 */
export function RowSpacer() {
  return <span aria-hidden="true" className="ml-auto" />;
}

const READINGS_SHAPE: Record<"fill" | "keepFirst" | "trailing", string> = {
  // The row's readings: all the room the name and the controls leave, the
  // items packed to the right, any of them free to go.
  fill: "flex-1 basis-0 min-w-0 overflow-hidden",
  // The same, but the first item cannot go: `overflow-clip` keeps the box's
  // automatic minimum width (its widest item), which a hidden overflow drops.
  keepFirst: "flex-1 basis-0 overflow-clip",
  // A second group further along the row (a timed command's countdown): no
  // wider than its items, so it never opens a gap between two controls.
  trailing: "w-0 grow max-w-max overflow-hidden",
};

/**
 * Read-only items that give way. The group shows as many items as fit, from the
 * first: the others wrap onto a second line that is clipped away, so an item
 * disappears whole instead of being cut. The empty first child holds the first
 * line open, which lets even the first item go; `keepFirst` leaves it out.
 * Taps go through to the row's link: a counter with its own opacity would
 * otherwise sit above it and swallow the tap.
 * Items never wrap inside themselves: that keeps the box's minimum width at its
 * widest item, so a kept first item is never cut.
 *
 * At most one `fill` or `keepFirst` group per row: two would split the room
 * between them and open a gap.
 */
export function RowReadings({
  children,
  keepFirst = false,
  trailing = false,
  gap = "2",
}: {
  children: ReactNode;
  keepFirst?: boolean;
  trailing?: boolean;
  gap?: "2" | "3";
}) {
  const items = Children.toArray(children);
  if (items.length === 0) return null;
  const shape = trailing ? "trailing" : keepFirst ? "keepFirst" : "fill";
  const itemGap = gap === "3" ? "ml-3" : "ml-2";
  return (
    <div
      data-row-part="readings"
      data-row-readings={shape}
      className={`pointer-events-none flex h-8 flex-wrap justify-end ${READINGS_SHAPE[shape]}`}
    >
      {shape !== "keepFirst" && <span aria-hidden="true" className="h-8" />}
      {items.map((item, i) => (
        <div
          key={i}
          className={`h-8 flex items-center flex-shrink-0 whitespace-nowrap ${itemGap} empty:hidden`}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

/**
 * Controls: never shrunk, never hidden, and above the stretched link, so a tap
 * on them (or between two of them) acts on the equipment and stays on the page.
 */
export function RowControls({ children }: { children: ReactNode }) {
  return (
    <div
      data-row-part="controls"
      className="relative flex items-center gap-2 flex-shrink-0 ml-3 empty:hidden"
    >
      {children}
    </div>
  );
}
