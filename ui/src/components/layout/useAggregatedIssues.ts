import { useMemo } from "react";
import type { AlarmWording } from "../../lib/alarm-message";
import { useWebSocket } from "../../store/useWebSocket";
import { useAckedIssues } from "../../store/useAckedIssues";
import { issueSignature } from "../../lib/acked-issues";

export interface AggregatedIssue extends AlarmWording {
  /** Stable key for React rendering: `<source>:<kind>`, plus the zone for a zoned alarm. */
  key: string;
  /** Plugin id ("netatmo_weather"), or "system" for non-integration alarms. */
  source: string;
  level: "error" | "warning";
  /** Zone the alarm belongs to (#1184); absent for a global one. */
  zoneId?: string | null;
}

/**
 * Merges two real-time signals into a single user-facing list of issues:
 *
 *   1. system.alarms (events raised by core, e.g. order dispatch failures)
 *   2. integrationStatuses (per-plugin live status pushed via WS)
 *
 * Dedup rule: when a plugin appears in both lists (e.g. legrand_control
 * has an order-fail alarm AND its integration status is "error"), keep
 * only the one with the highest severity. The alarm message wins because
 * it carries the actionable detail; integration status is a coarser
 * signal (just "disconnected" or "error").
 *
 * Severity ranking: error > warning.
 *
 * Alarms dedup on source AND zone (#1184): the source of a battery alarm is the
 * equipment name, so two « Capteur porte » in two rooms used to collapse into
 * one row. Alarms without a zone (integrations, order outcomes) dedup on the
 * source alone, as before.
 */
export function useAggregatedIssues(): AggregatedIssue[] {
  const alarms = useWebSocket((s) => s.alarms);
  const integrationStatuses = useWebSocket((s) => s.integrationStatuses);

  return useMemo(() => {
    // Index by source (and zone) so we can dedup.
    const bySource = new Map<string, AggregatedIssue>();
    const alarmSources = new Set<string>();

    // (1) Alarms first — they carry the richest message.
    for (const a of alarms.values()) {
      const zoneId = a.zoneId ?? null;
      const dedupKey = zoneId ? `${a.source}\u0000${zoneId}` : a.source;
      alarmSources.add(a.source);
      bySource.set(dedupKey, {
        key: zoneId ? `${a.source}:alarm:${zoneId}` : `${a.source}:alarm`,
        source: a.source,
        level: a.level,
        message: a.message,
        messageKey: a.messageKey,
        messageParams: a.messageParams,
        ...(zoneId ? { zoneId } : {}),
      });
    }

    // (2) Integration statuses — only those in error/disconnected state.
    //     Skip if the source already has an alarm (alarm wins on detail).
    for (const [pluginId, status] of Object.entries(integrationStatuses)) {
      if (alarmSources.has(pluginId)) continue;
      if (status === "error") {
        bySource.set(pluginId, {
          key: `${pluginId}:status`,
          source: pluginId,
          level: "error",
          messageKey: "alarms.integration.error",
        });
      } else if (status === "disconnected") {
        bySource.set(pluginId, {
          key: `${pluginId}:status`,
          source: pluginId,
          level: "warning",
          messageKey: "alarms.integration.disconnected",
        });
      }
    }

    // Sort: errors before warnings, then alphabetically by source.
    return Array.from(bySource.values()).sort((a, b) => {
      if (a.level !== b.level) return a.level === "error" ? -1 : 1;
      return a.source.localeCompare(b.source);
    });
  }, [alarms, integrationStatuses]);
}

/**
 * The subset of aggregated issues the user has NOT acknowledged (#424). Drives
 * the header pill so acknowledging a persistent warning clears it from the
 * banner. The AlarmsSheet keeps using `useAggregatedIssues` (the full list) to
 * also show the acknowledged ones.
 */
export function useVisibleIssues(): AggregatedIssue[] {
  const issues = useAggregatedIssues();
  const acked = useAckedIssues((s) => s.acked);
  return useMemo(
    () => issues.filter((issue) => !acked.has(issueSignature(issue))),
    [issues, acked],
  );
}
