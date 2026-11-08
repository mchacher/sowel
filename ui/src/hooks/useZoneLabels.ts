import { useMemo } from "react";
import { useZones } from "../store/useZones";
import { flattenZonesWithPath, type ZoneOption } from "../lib/zone-path";

/**
 * `zoneId → ZoneOption` over the live zone tree, for rows that only carry a
 * zone id and have to name the room (#1184, alarm rows). The label is the
 * shortest suffix that tells the zone from its homonyms (spec 139): the bare
 * room name when it is unique, `Étage 1 › Chambre` when it is not.
 */
export function useZoneLabels(): Map<string, ZoneOption> {
  const tree = useZones((s) => s.tree);
  return useMemo(() => new Map(flattenZonesWithPath(tree).map((z) => [z.id, z])), [tree]);
}
