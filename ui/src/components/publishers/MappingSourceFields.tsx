import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails, RecipeInstance, RecipeInfo } from "../../types";
import { type ZoneOption, zoneChainMap, equipmentLabelMap } from "../../lib/zone-path";
import { mappingSourceKeys, type MappingSourceType } from "./mapping-source";

// The universal "publisher mapping source" selector (issue #457): pick a source
// (equipment / zone / recipe), optionally filter equipments and recipes by
// zone, then pick one of the source's keys. Identical across every publisher
// transport (MQTT, Telegram, Web Push, ...), so it lives once here. Callers own
// the surrounding grid, the transport-specific payload field (a publish key, a
// message, ...) and the submit buttons. The i18n keys differ only by prefix, so
// callers pass `keyPrefix` ("mqttPublishers" | "notifPublishers").
interface MappingSourceFieldsProps {
  keyPrefix: string;
  sourceType: MappingSourceType;
  setSourceType: (v: MappingSourceType) => void;
  sourceId: string;
  setSourceId: (v: string) => void;
  sourceKey: string;
  setSourceKey: (v: string) => void;
  filterZoneId: string;
  setFilterZoneId: (v: string) => void;
  equipments: EquipmentWithDetails[];
  zones: ZoneOption[];
  recipeInstances: RecipeInstance[];
  recipes: RecipeInfo[];
  /**
   * How a recipe instance is labelled in the dropdown. Defaults to the recipe
   * name (the MQTT page behaviour); the notification page passes a richer label
   * that appends the target equipment names so identical recipes are
   * distinguishable.
   */
  recipeOptionLabel?: (inst: RecipeInstance) => string;
}

export function MappingSourceFields({
  keyPrefix,
  sourceType,
  setSourceType,
  sourceId,
  setSourceId,
  sourceKey,
  setSourceKey,
  filterZoneId,
  setFilterZoneId,
  equipments,
  zones,
  recipeInstances,
  recipes,
  recipeOptionLabel,
}: MappingSourceFieldsProps) {
  const { t } = useTranslation();
  const k = (suffix: string) => t(`${keyPrefix}.${suffix}`);

  const filteredEquipments = filterZoneId
    ? equipments.filter((e) => e.zoneId === filterZoneId)
    : equipments;

  // Homonym equipments get a "name - zone" label (spec 139), qualified only
  // against the other candidates in this dropdown.
  const eqLabels = equipmentLabelMap(filteredEquipments, zoneChainMap(zones));

  const filteredRecipeInstances = filterZoneId
    ? recipeInstances.filter((i) => i.params.zone === filterZoneId)
    : recipeInstances;

  const availableKeys = mappingSourceKeys(sourceType, sourceId, { equipments, recipeInstances });

  const handleSourceTypeChange = (val: MappingSourceType) => {
    setSourceType(val);
    setFilterZoneId("");
    setSourceId("");
    setSourceKey("");
  };

  const selectClass =
    "w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text";
  const labelClass = "block text-[11px] text-text-secondary mb-1";

  return (
    <>
      <div>
        <label className={labelClass}>{k("sourceType")}</label>
        <select
          value={sourceType}
          onChange={(e) => handleSourceTypeChange(e.target.value as MappingSourceType)}
          className={selectClass}
        >
          <option value="equipment">{k("equipment")}</option>
          <option value="zone">{k("zone")}</option>
          <option value="recipe">{k("recipe")}</option>
        </select>
      </div>

      <div>
        <label className={labelClass}>{k("zone")}</label>
        <select
          value={sourceType === "zone" ? sourceId : filterZoneId}
          onChange={(e) => {
            if (sourceType === "zone") {
              setSourceId(e.target.value);
              setSourceKey("");
            } else {
              setFilterZoneId(e.target.value);
              setSourceId("");
              setSourceKey("");
            }
          }}
          className={selectClass}
        >
          <option value="">{sourceType === "zone" ? k("selectSource") : k("allZones")}</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
      </div>

      {sourceType === "equipment" && (
        <div>
          <label className={labelClass}>{k("equipment")}</label>
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setSourceKey("");
            }}
            className={selectClass}
          >
            <option value="">{k("selectSource")}</option>
            {filteredEquipments.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eqLabels.get(eq.id) ?? eq.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {sourceType === "recipe" && (
        <div>
          <label className={labelClass}>{k("recipeInstance")}</label>
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setSourceKey("");
            }}
            className={selectClass}
          >
            <option value="">{k("selectSource")}</option>
            {filteredRecipeInstances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {recipeOptionLabel
                  ? recipeOptionLabel(inst)
                  : (recipes.find((r) => r.id === inst.recipeId)?.name ?? inst.recipeId)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={labelClass}>{k("sourceKey")}</label>
        <select
          value={sourceKey}
          onChange={(e) => setSourceKey(e.target.value)}
          className={selectClass}
          disabled={!sourceId}
        >
          <option value="">{k("selectKey")}</option>
          {availableKeys.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
