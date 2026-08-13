import { useMemo } from "react";
import type { ZoneWithChildren } from "../../types";
import { flattenZonesWithPath, zoneChainMap, type ZoneOption } from "../../lib/zone-path";

/**
 * The zone-derived lookups every recipe sub-form needs (issue #387).
 *
 * The three recipe forms (`RecipeInstanceRow`, `DuplicateRecipeModal`,
 * `AddRecipeForm`) each memoized the same `flattenZonesWithPath` +
 * `zoneChainMap` pair off `zoneTree`. This hook is the single source of that
 * pair so a future picker change lands in one place instead of three.
 *
 * - `allZones`: the zone tree flattened to disambiguated {@link ZoneOption}s.
 * - `zoneChains`: `zoneId → ancestor chain`, the input to `equipmentLabelMap`.
 */
export function useZoneOptions(zoneTree: ZoneWithChildren[]): {
  allZones: ZoneOption[];
  zoneChains: Map<string, string[]>;
} {
  const allZones = useMemo(() => flattenZonesWithPath(zoneTree), [zoneTree]);
  const zoneChains = useMemo(() => zoneChainMap(allZones), [allZones]);
  return { allZones, zoneChains };
}
