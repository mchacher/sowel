import { useMemo } from "react";
import { useWebSocket } from "../../store/useWebSocket";
import { useAckedIssues } from "../../store/useAckedIssues";
import { issueSignature } from "../../lib/acked-issues";

export interface AggregatedIssue {
  /** Stable key for React rendering: `<source>:<kind>` */
  key: string;
  /** Plugin id ("netatmo_weather"), or "system" for non-integration alarms. */
  source: string;
  level: "error" | "warning";
  message: string;
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
 */
export function useAggregatedIssues(): AggregatedIssue[] {
  const alarms = useWebSocket((s) => s.alarms);
  const integrationStatuses = useWebSocket((s) => s.integrationStatuses);

  return useMemo(() => {
    // Index by source so we can dedup.
    const bySource = new Map<string, AggregatedIssue>();

    // (1) Alarms first — they carry the richest message.
    for (const a of alarms.values()) {
      bySource.set(a.source, {
        key: `${a.source}:alarm`,
        source: a.source,
        level: a.level,
        message: a.message,
      });
    }

    // (2) Integration statuses — only those in error/disconnected state.
    //     Skip if the source already has an alarm (alarm wins on detail).
    for (const [pluginId, status] of Object.entries(integrationStatuses)) {
      if (bySource.has(pluginId)) continue;
      if (status === "error") {
        bySource.set(pluginId, {
          key: `${pluginId}:status`,
          source: pluginId,
          level: "error",
          message: integrationDisconnectMessage("error"),
        });
      } else if (status === "disconnected") {
        bySource.set(pluginId, {
          key: `${pluginId}:status`,
          source: pluginId,
          level: "warning",
          message: integrationDisconnectMessage("disconnected"),
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

/** Translation lookup is done inside the components; this helper just
 *  returns a key suffix that the consumer maps to i18n. Keeping the
 *  message untranslated here avoids coupling the hook to react-i18next. */
function integrationDisconnectMessage(reason: "error" | "disconnected"): string {
  return reason === "error"
    ? "alarms.integration.error" // i18n key
    : "alarms.integration.disconnected";
}
