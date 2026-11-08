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
 *   first, dropping the others whole, the last first. A row whose controls draw
 *   no button (none bound, or the equipment disabled) keeps its first reading;
 * - controls (`RowControls`): never hidden, and the only part of the row that
 *   does not open the equipment page.
 *
 * The whole row is the name's link, stretched over the row (`RowName`); the
 * control groups sit above it, so a tap on a control never navigates.
 */

/** The row: one flex line; `relative` anchors the stretched link. */
export function EquipmentRow({ children }: { children: ReactNode }) {
  return (
    <div className="group/eqrow relative flex items-center px-[1.1rem] py-[0.55rem] min-h-[52px] transition-colors duration-150 hover:bg-border-light/40">
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
      {/* Above the stretched link, so its tooltip (spec 116) can be hovered */}
      {badge && <span className="relative flex flex-shrink-0">{badge}</span>}
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

/**
 * Read-only items that give way. The group takes all the room the name and the
 * controls leave and shows as many items as fit, from the first, packed to the
 * right: the others wrap onto a second line that is clipped away, so an item
 * disappears whole instead of being cut.
 *
 * Whether the first item may go too depends on the row. Without a live control
 * it stays: `overflow-clip` (unlike a hidden overflow) keeps the group's
 * automatic minimum width, its widest item, and items never wrap inside
 * themselves. With one, the group may shrink to nothing, and an empty first
 * child holds the first line open so that even the first item can wrap away.
 *
 * `trailing` is a second group further along the row (a timed command's
 * countdown): no wider than its items, so it never opens a gap between two
 * controls, and free to go entirely. Only one group per row may be the main
 * one: two would split the room between them and open a gap.
 *
 * Taps go through to the row's link: a counter with its own opacity would
 * otherwise sit above it and swallow the tap.
 */
export function RowReadings({
  children,
  trailing = false,
  gap = "2",
}: {
  children: ReactNode;
  trailing?: boolean;
  gap?: "2" | "3";
}) {
  const items = Children.toArray(children);
  if (items.length === 0) return null;
  const itemGap = gap === "3" ? "ml-3" : "ml-2";
  return (
    <div
      data-row-part="readings"
      data-row-readings={trailing ? "trailing" : "main"}
      className={`pointer-events-none flex h-8 flex-wrap justify-end ${
        trailing
          ? "w-0 grow max-w-max overflow-hidden"
          : // "group-has-…/eqrow:" = the row has a live control: a control group
            // that draws a button. Decided by what renders, not by the type: a
            // gate without a command, or a disabled pump, draws none. Spelled
            // out in full so that Tailwind finds the classes.
            "flex-1 basis-0 overflow-clip group-has-[[data-row-part=controls]_button]/eqrow:min-w-0"
      }`}
    >
      <span
        aria-hidden="true"
        data-row-opener=""
        className={
          trailing ? "h-8" : "h-8 hidden group-has-[[data-row-part=controls]_button]/eqrow:block"
        }
      />
      {items.map((item, i) => (
        <div
          key={i}
          className={`h-8 flex items-center gap-2 flex-shrink-0 whitespace-nowrap ${itemGap} empty:hidden`}
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
