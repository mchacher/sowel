import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useZoneOptions } from "./useZoneOptions";
import type { ZoneWithChildren } from "../../types";

// #387: the three recipe sub-forms each memoized the same
// flattenZonesWithPath + zoneChainMap pair. useZoneOptions is now the single
// source of that pair. These pin the contract the forms rely on and that the
// memoized identities stay stable across re-renders with the same tree.

function zone(id: string, name: string, children: ZoneWithChildren[] = []): ZoneWithChildren {
  return {
    id,
    name,
    parentId: null,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    children,
  };
}

describe("useZoneOptions", () => {
  it("flattens the tree and maps every zone id to its ancestor chain", () => {
    const tree = [zone("root", "Maison", [zone("salon", "Salon"), zone("cuisine", "Cuisine")])];
    const { result } = renderHook(() => useZoneOptions(tree));

    expect(result.current.allZones.map((z) => z.id)).toEqual(["root", "salon", "cuisine"]);
    // The single implicit root is dropped from descendant chains (see zone-path).
    expect(result.current.zoneChains.get("salon")).toEqual(["Salon"]);
    expect(result.current.zoneChains.get("root")).toEqual(["Maison"]);
  });

  it("keeps allZones/zoneChains referentially stable across re-renders of the same tree", () => {
    const tree = [zone("root", "Maison", [zone("salon", "Salon")])];
    const { result, rerender } = renderHook(() => useZoneOptions(tree));
    const first = result.current;
    rerender();
    expect(result.current.allZones).toBe(first.allZones);
    expect(result.current.zoneChains).toBe(first.zoneChains);
  });
});
