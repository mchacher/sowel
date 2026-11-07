import { useTranslation } from "react-i18next";
import type { ZoneAggregatedData, ZoneWithChildren } from "../../types";

/**
 * One-line summary under a page title: the zone's description, then its
 * lights and shutters (« 3 lumières allumées • 6 volets ouverts »). Maison
 * shows it for the current zone; the Dashboard for the root zone (spec 196,
 * decision pr6-h1: the H1 stays the page name, the summary goes under it).
 */
export function ZoneHeroLead({
  zone,
  aggData,
}: {
  zone: ZoneWithChildren;
  aggData: ZoneAggregatedData | undefined;
}) {
  const { t } = useTranslation();
  // Compose lead segments: description (if set) + dynamic lights / shutters summary.
  const segments: string[] = [];

  if (zone.description) segments.push(zone.description);

  if (aggData) {
    if (aggData.lightsTotal > 0) {
      if (aggData.lightsOn > 0) {
        segments.push(
          t("zone.lead.lightsOn", {
            defaultValue: "{{count}} lumière allumée",
            count: aggData.lightsOn,
          }),
        );
      } else if (aggData.lightsTotal > 1) {
        segments.push(
          t("zone.lead.allLightsOff", { defaultValue: "toutes les lumières éteintes" }),
        );
      } else {
        segments.push(t("zone.lead.lightOff", { defaultValue: "lumière éteinte" }));
      }
    }
    if (aggData.shuttersTotal > 0) {
      if (aggData.shuttersOpen === aggData.shuttersTotal) {
        if (aggData.shuttersTotal > 1) {
          segments.push(
            t("zone.lead.allShuttersOpen", { defaultValue: "tous les volets ouverts" }),
          );
        } else {
          segments.push(t("zone.lead.shutterOpen", { defaultValue: "volet ouvert" }));
        }
      } else if (aggData.shuttersOpen > 0) {
        segments.push(
          t("zone.lead.shuttersOpen", {
            defaultValue: "{{count}} volet ouvert",
            count: aggData.shuttersOpen,
          }),
        );
      } else if (aggData.shuttersTotal > 1) {
        segments.push(t("zone.lead.allShuttersClosed", { defaultValue: "tous les volets fermés" }));
      } else {
        segments.push(t("zone.lead.shutterClosed", { defaultValue: "volet fermé" }));
      }
    }
  }

  if (segments.length === 0) return null;

  return (
    <div
      className="flex items-center gap-[0.6rem] mt-[0.55rem] text-small text-text-tertiary tabular-nums flex-wrap"
      aria-label={t("zone.lead.aria", { defaultValue: "Résumé de la zone" })}
    >
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-[0.6rem]">
          {i > 0 && <span className="w-1 h-1 rounded-full bg-text-tertiary/50 flex-shrink-0" />}
          <span>{seg}</span>
        </span>
      ))}
    </div>
  );
}
