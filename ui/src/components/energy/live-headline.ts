/**
 * The balance line of the Live flow card (spec 197, FR-E1): import, export or
 * self-powered, and how much. Pure, so the rule is tested without React.
 *
 * It replaces the status tag (« Appoint solaire » and its siblings), which
 * named the minor source and said nothing about the grid: the reviews of
 * 2026-11-08 found « Appoint solaire » over a house drawing 96 % from the grid.
 */

/** Below this, the grid is neither importing nor exporting: meter noise. */
export const BALANCE_THRESHOLD_W = 5;

export type LiveHeadlineKind = "import" | "export" | "self" | "consumption-only";

export interface LiveHeadlineInput {
  /** Signed grid power, + import / − export. Null without a main meter. */
  gridW: number | null;
  /** Solar production. Null without a production source. */
  solarW: number | null;
  /** Which source's reading is past its freshness budget, with its age. */
  stale?: { source: "grid" | "solar"; since: string | null } | null;
}

export interface LiveHeadline {
  kind: LiveHeadlineKind;
  /** The large figure, unsigned watts: import, export or consumption. */
  valueW: number;
  /** House consumption, the figure the sentence quotes. */
  consumptionW: number;
  /**
   * Share of the consumption the sun covers, whole percent. Null when nothing
   * is produced (« Pas de production solaire ») or there is no sentence.
   */
  solarPct: number | null;
  /** The stale source, when a reading behind the figure is old. */
  stale: { source: "grid" | "solar"; since: string | null } | null;
}

export function liveHeadline({ gridW, solarW, stale = null }: LiveHeadlineInput): LiveHeadline {
  const grid = gridW ?? 0;
  const solar = Math.max(0, solarW ?? 0);
  const consumptionW = Math.max(0, grid + solar);

  // Without both sources there is no balance to state: a home with no panels
  // imports exactly what it consumes, and « Import réseau » over « Pas de
  // production solaire » would describe an installation it does not have.
  if (gridW === null || solarW === null) {
    return { kind: "consumption-only", valueW: consumptionW, consumptionW, solarPct: null, stale };
  }

  const solarToHouse = Math.min(solar, consumptionW);
  const pct =
    consumptionW > 0 && solar >= BALANCE_THRESHOLD_W
      ? Math.round((solarToHouse / consumptionW) * 100)
      : null;

  if (grid <= -BALANCE_THRESHOLD_W) {
    return { kind: "export", valueW: -grid, consumptionW, solarPct: 100, stale };
  }
  // Balanced only counts as self-powered while the sun is actually producing:
  // a house at 0 W at night is not « autonome ».
  if (grid < BALANCE_THRESHOLD_W && solar >= BALANCE_THRESHOLD_W) {
    return { kind: "self", valueW: consumptionW, consumptionW, solarPct: 100, stale };
  }
  return { kind: "import", valueW: Math.max(0, grid), consumptionW, solarPct: pct, stale };
}
