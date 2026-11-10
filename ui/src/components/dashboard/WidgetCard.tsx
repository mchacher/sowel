import { useContext, type ReactNode } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCardPrimaryAction } from "./card-primary-action";
import { TileOrderOutcomeLine } from "../equipments/OrderOutcomeLine";
import { TileEquipmentContext } from "../equipments/order-outcome";
import { equipmentLinkState } from "../../lib/equipment-origin";
import { useIsMobile } from "../../hooks/useIsMobile";
import { CardModePills } from "./CardModePills";

interface WidgetCardProps {
  label: string;
  /** Zone qualifier (spec 139) — a second, quieter line under the title. */
  sublabel?: string;
  /** Optional className extension — used by callers that need to layer behavior (transitions, edit-mode chrome…). */
  className?: string;
  /** Primary action, fired by a click anywhere on the tile that did not start on a nested control. */
  onClick?: () => void;
  /** Absolutely placed in the top-right corner (the mobile tap glyph, spec 196). */
  corner?: ReactNode;
  children: ReactNode;
}

/**
 * Shared dashboard widget shell.
 *
 * Three responsibilities:
 * - Visual chrome (bg, border, radius, padding, fixed responsive height).
 * - Centered title at 17 px, truncated, over an optional zone line.
 * - Vertical flex container for the widget's per-type content.
 *
 * The zone goes on its own line rather than into the title: a card is ~240 px
 * wide, so "Plafonnier — Chambre 1" truncates precisely where it stops being
 * ambiguous. Splitting the two keeps the name readable and the zone legible.
 *
 * With `onClick`, the whole tile becomes the widget's primary action, the way
 * the mobile card has always worked. `useCardPrimaryAction` holds the two
 * gestures that must not trigger it (a click on a nested control, a slider drag
 * released off its track). Keyboard users keep the nested button; a
 * role="button" here would nest an interactive element inside another one.
 *
 * Per-type widgets (light, shutter, thermostat, etc.) wrap their content
 * with this component. See specs/098-design-system-dashboard.
 */
export function WidgetCard({
  label,
  sublabel,
  className = "",
  onClick,
  corner,
  children,
}: WidgetCardProps) {
  const cardAction = useCardPrimaryAction(onClick);
  const { t } = useTranslation();
  // Spec 196 (pr9-dashboard) — on an equipment tile the title opens the
  // equipment page, from the desktop width only: on a phone the whole tile is
  // its tap action and the page is reached from the sheet's footer. The card
  // action ignores clicks that land on a link.
  const equipmentId = useContext(TileEquipmentContext);
  const isMobile = useIsMobile();
  // A tile rendered outside a router (a picker preview, a test) keeps a plain title.
  const inRouter = useInRouterContext();
  const linkable = inRouter && equipmentId !== null && !isMobile;

  return (
    <div
      className={`card relative p-3 flex flex-col h-[160px] sm:h-[240px] overflow-hidden ${
        onClick ? "cursor-pointer active:scale-[0.98] transition-transform" : ""
      } ${className}`}
      {...cardAction}
    >
      <div className={`relative mb-2 text-center ${corner ? "px-4 sm:px-0" : ""}`}>
        {linkable ? (
          <Link
            to={`/equipments/${equipmentId}`}
            state={equipmentLinkState(t("nav.dashboard"), "/dashboard")}
            className="block text-lead font-semibold text-text truncate leading-tight hover:text-primary hover:underline underline-offset-2"
          >
            {label}
          </Link>
        ) : (
          <span className="block text-lead font-semibold text-text truncate leading-tight">
            {label}
          </span>
        )}
        {sublabel && (
          <span className="block text-micro text-text-tertiary truncate">{sublabel}</span>
        )}
        {/* Spec 188 — what became of the last tracked order (gate, cover).
            Renders nothing outside an equipment tile or without a tracked order. */}
        <TileOrderOutcomeLine />
        {/* Spec 201 — the mode of the recipe driving this equipment, under the
            title block; a click moves to the next mode (computer only: a phone
            changes it from the sheet). Renders nothing
            outside an equipment tile. */}
        <CardModePills equipmentId={equipmentId} interactive={!isMobile} />
      </div>
      {children}
      {corner}
    </div>
  );
}
