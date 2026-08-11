import { describe, it, expect } from "vitest";
import {
  flattenZonesWithPath,
  zoneChainMap,
  equipmentLabelMap,
  groupEquipmentsByZone,
  ZONE_PATH_SEPARATOR,
} from "./zone-path";
import type { ZoneWithChildren } from "../types";

/** Minimal zone node — only the fields the flattener reads. */
function zone(id: string, name: string, children: ZoneWithChildren[] = []): ZoneWithChildren {
  return {
    id,
    name,
    parentId: null,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    children,
  } as ZoneWithChildren;
}

// The tree reported in issue #385: "Salle de bain" three times, "WC" twice.
const tree: ZoneWithChildren[] = [
  zone("domaine", "Domaine", [
    zone("maison", "Maison", [zone("m-sdb", "Salle de bain"), zone("m-grenier", "Grenier")]),
    zone("gite", "Gîte", [
      zone("rdc", "RDC", [zone("rdc-sdb", "Salle de bain"), zone("rdc-wc", "WC")]),
      zone("etage", "Étage", [zone("et-sdb", "Salle de bain"), zone("et-wc", "WC")]),
    ]),
  ]),
];

const zones = flattenZonesWithPath(tree);
const labelOf = (id: string) => zones.find((z) => z.id === id)?.label;
const pathOf = (id: string) => zones.find((z) => z.id === id)?.path;

describe("flattenZonesWithPath", () => {
  it("leaves a unique name alone — no noise where there is no ambiguity", () => {
    expect(labelOf("m-grenier")).toBe("Grenier");
    expect(labelOf("maison")).toBe("Maison");
  });

  it("adds just enough ancestors to tell homonyms apart", () => {
    expect(labelOf("m-sdb")).toBe("Maison › Salle de bain");
    expect(labelOf("rdc-sdb")).toBe("RDC › Salle de bain");
    expect(labelOf("et-sdb")).toBe("Étage › Salle de bain");
  });

  it("gives every homonym the same number of segments, so labels compare", () => {
    const segments = ["m-sdb", "rdc-sdb", "et-sdb"].map(
      (id) => labelOf(id)!.split(ZONE_PATH_SEPARATOR).length,
    );
    expect(new Set(segments).size).toBe(1);
  });

  it("produces distinct labels for every homonym group", () => {
    const bathrooms = zones.filter((z) => z.name === "Salle de bain").map((z) => z.label);
    const wcs = zones.filter((z) => z.name === "WC").map((z) => z.label);
    expect(new Set(bathrooms).size).toBe(3);
    expect(new Set(wcs).size).toBe(2);
  });

  it("walks up further when one ancestor is not enough", () => {
    const deep = flattenZonesWithPath([
      zone("root", "Domaine", [
        zone("a", "Maison", [zone("a-rdc", "RDC", [zone("a-sdb", "Salle de bain")])]),
        zone("b", "Gîte", [zone("b-rdc", "RDC", [zone("b-sdb", "Salle de bain")])]),
      ]),
    ]);
    const l = (id: string) => deep.find((z) => z.id === id)?.label;
    expect(l("a-sdb")).toBe("Maison › RDC › Salle de bain");
    expect(l("b-sdb")).toBe("Gîte › RDC › Salle de bain");
  });

  it("keeps the full chain in `path`, root omitted when there is only one", () => {
    expect(pathOf("rdc-sdb")).toBe("Gîte › RDC › Salle de bain");
    expect(pathOf("domaine")).toBe("Domaine");
  });

  it("keeps every chain complete when several roots exist", () => {
    const multi = flattenZonesWithPath([
      zone("a", "Maison", [zone("a-sdb", "Salle de bain")]),
      zone("b", "Gîte", [zone("b-sdb", "Salle de bain")]),
    ]);
    expect(multi.find((z) => z.id === "a-sdb")?.path).toBe("Maison › Salle de bain");
    expect(multi.find((z) => z.id === "b-sdb")?.label).toBe("Gîte › Salle de bain");
  });

  it("reports depth from the tree, unaffected by the root omission", () => {
    expect(zones.find((z) => z.id === "domaine")?.depth).toBe(0);
    expect(zones.find((z) => z.id === "gite")?.depth).toBe(1);
    expect(zones.find((z) => z.id === "rdc-sdb")?.depth).toBe(3);
  });

  it("walks depth-first so a dropdown reads like the tree", () => {
    expect(zones.map((z) => z.id)).toEqual([
      "domaine",
      "maison",
      "m-sdb",
      "m-grenier",
      "gite",
      "rdc",
      "rdc-sdb",
      "rdc-wc",
      "etage",
      "et-sdb",
      "et-wc",
    ]);
  });

  it("returns an empty list for an empty tree", () => {
    expect(flattenZonesWithPath([])).toEqual([]);
  });

  it("renders a name containing the separator verbatim", () => {
    const odd = flattenZonesWithPath([zone("root", "Maison", [zone("x", "Cave › Atelier")])]);
    expect(odd.find((z) => z.id === "x")?.label).toBe("Cave › Atelier");
  });

  it("falls back to the whole chain when homonyms cannot be separated", () => {
    // Same name at every level: no suffix ever separates them.
    const twins = flattenZonesWithPath([
      zone("r1", "Bloc", [zone("a", "Salle")]),
      zone("r2", "Bloc", [zone("b", "Salle")]),
    ]);
    expect(twins.find((z) => z.id === "a")?.label).toBe("Bloc › Salle");
    expect(twins.find((z) => z.id === "b")?.label).toBe("Bloc › Salle");
  });
});

describe("zoneChainMap", () => {
  it("maps every zone id to its ancestor chain", () => {
    const map = zoneChainMap(zones);
    expect(map.size).toBe(11);
    expect(map.get("et-wc")).toEqual(["Gîte", "Étage", "WC"]);
  });

  it("returns undefined for an unknown id so callers can fall back", () => {
    expect(zoneChainMap(zones).get("ghost")).toBeUndefined();
  });
});

describe("equipmentLabelMap", () => {
  const chains = zoneChainMap(zones);

  it("leaves a unique name bare — a compact dropdown has no room to waste", () => {
    const labels = equipmentLabelMap(
      [
        { id: "s1", name: "Hygro salon", zoneId: "maison" },
        { id: "s2", name: "Température", zoneId: "m-sdb" },
      ],
      chains,
    );
    expect(labels.get("s1")).toBe("Hygro salon");
    expect(labels.get("s2")).toBe("Température");
  });

  it("qualifies a repeated name with the shortest zone suffix that separates the candidates", () => {
    // Three ventilations in plainly different rooms: the room name is enough,
    // even though "Salle de bain" needs an ancestor to be a unique *zone*.
    const labels = equipmentLabelMap(
      [
        { id: "v1", name: "VMC", zoneId: "m-sdb" },
        { id: "v2", name: "VMC", zoneId: "etage" },
        { id: "v3", name: "VMC", zoneId: "m-grenier" },
      ],
      chains,
    );
    expect(labels.get("v1")).toBe("VMC — Salle de bain");
    expect(labels.get("v2")).toBe("VMC — Étage");
    expect(labels.get("v3")).toBe("VMC — Grenier");
  });

  it("walks up only for the candidates that need it", () => {
    const labels = equipmentLabelMap(
      [
        { id: "t1", name: "Température", zoneId: "m-sdb" },
        { id: "t2", name: "Température", zoneId: "rdc-sdb" },
      ],
      chains,
    );
    expect(labels.get("t1")).toBe("Température — Maison › Salle de bain");
    expect(labels.get("t2")).toBe("Température — RDC › Salle de bain");
  });

  it("falls back to the bare name when the zone is gone", () => {
    const labels = equipmentLabelMap(
      [
        { id: "o1", name: "VMC", zoneId: "deleted" },
        { id: "o2", name: "VMC", zoneId: "maison" },
      ],
      chains,
    );
    expect(labels.get("o1")).toBe("VMC");
    expect(labels.get("o2")).toBe("VMC — Maison");
  });

  it("cannot separate two equipments sharing a name and a zone", () => {
    const labels = equipmentLabelMap(
      [
        { id: "c1", name: "VMC", zoneId: "maison" },
        { id: "c2", name: "VMC", zoneId: "maison" },
      ],
      chains,
    );
    expect(labels.get("c1")).toBe("VMC — Maison");
    expect(labels.get("c2")).toBe("VMC — Maison");
  });
});

describe("groupEquipmentsByZone", () => {
  const eq = (id: string, zoneId: string) => ({ id, zoneId });

  it("keeps homonym zones apart — the bug the name-keyed grouping had", () => {
    const groups = groupEquipmentsByZone(
      [eq("a", "m-sdb"), eq("b", "rdc-sdb"), eq("c", "et-sdb")],
      zones,
    );
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.zone?.id)).toEqual(["m-sdb", "rdc-sdb", "et-sdb"]);
    expect(groups.every((g) => g.equipments.length === 1)).toBe(true);
  });

  it("orders groups like the tree, not alphabetically", () => {
    const groups = groupEquipmentsByZone(
      [eq("a", "et-wc"), eq("b", "maison"), eq("c", "rdc-sdb")],
      zones,
    );
    expect(groups.map((g) => g.zone?.id)).toEqual(["maison", "rdc-sdb", "et-wc"]);
  });

  it("hands the caller the full chain of each group", () => {
    const [group] = groupEquipmentsByZone([eq("a", "rdc-sdb")], zones);
    expect(group.zone?.chain).toEqual(["Gîte", "RDC", "Salle de bain"]);
  });

  it("skips zones with no equipment", () => {
    const groups = groupEquipmentsByZone([eq("a", "m-grenier")], zones);
    expect(groups.map((g) => g.zone?.id)).toEqual(["m-grenier"]);
  });

  it("keeps several equipments of one zone together, in input order", () => {
    const [group] = groupEquipmentsByZone([eq("a", "maison"), eq("b", "maison")], zones);
    expect(group.equipments.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("collects equipments of a deleted zone in a trailing group rather than dropping them", () => {
    const groups = groupEquipmentsByZone([eq("a", "deleted"), eq("b", "maison")], zones);
    expect(groups.map((g) => g.zone?.id ?? null)).toEqual(["maison", null]);
    expect(groups[1].equipments.map((e) => e.id)).toEqual(["a"]);
  });

  it("returns nothing for no equipments", () => {
    expect(groupEquipmentsByZone([], zones)).toEqual([]);
  });
});
