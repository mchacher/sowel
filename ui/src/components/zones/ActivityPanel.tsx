import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Network, RotateCw } from "lucide-react";
import { useActivity } from "../../store/useActivity";
import { useWebSocket } from "../../store/useWebSocket";
import { useZones } from "../../store/useZones";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { ZoneWithChildren } from "../../types";
import { ActivityItemRow } from "./ActivityItemRow";
import { Panel } from "../home/Panel";
import { groupActivityLog, logPeriodLabel, logSpanLabel } from "../../lib/activity-log";
import { currentLocale } from "../../lib/format";

const MOBILE_CAP = 10;
const DESKTOP_MAX_HEIGHT_PX = 480;

interface Props {
  zoneId: string;
}

export function ActivityPanel({ zoneId }: Props) {
  const { t } = useTranslation();
  const items = useActivity((s) => s.items);
  const status = useActivity((s) => s.status);
  const loadForZone = useActivity((s) => s.loadForZone);
  const reset = useActivity((s) => s.reset);
  const includeDescendants = useActivity((s) => s.includeDescendants);
  const setIncludeDescendants = useActivity((s) => s.setIncludeDescendants);
  const retry = useActivity((s) => s.retry);
  const tree = useZones((s) => s.tree);
  const wsStatus = useWebSocket((s) => s.status);
  const isLive = wsStatus === "connected";
  const isMobile = useIsMobile();

  // Compute descendant zone IDs for the current zone (excluding the zone itself).
  // Keyed on the joined IDs so an unrelated zone-tree refresh (e.g. the refetch on every
  // WebSocket reconnect) doesn't hand back a new array identity and re-trigger the load.
  const descendantKey = useMemo(() => collectDescendantIds(tree, zoneId).join(","), [tree, zoneId]);
  const descendantIds = useMemo(
    () => (descendantKey === "" ? [] : descendantKey.split(",")),
    [descendantKey],
  );
  const hasDescendants = descendantIds.length > 0;

  // Re-read the clock every minute so the unlabelled "now" group of the log
  // follows the time of day. One timer per ActivityPanel instance, not per item.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Load on zone change. Reset prevents leakage between zones.
  useEffect(() => {
    if (!zoneId) return;
    reset();
    void loadForZone(zoneId, descendantIds);
  }, [zoneId, loadForZone, reset, descendantIds]);

  // Reload once the socket comes back: a load that failed while connectivity was down
  // would otherwise stay stuck on the error message until the user re-picks the zone.
  const wasLive = useRef(isLive);
  useEffect(() => {
    const reconnected = isLive && !wasLive.current;
    wasLive.current = isLive;
    if (reconnected && status === "error") void retry();
  }, [isLive, status, retry]);

  // Mobile is glance-only: hard cap at 10 most-recent items.
  // Desktop scrolls internally through the full buffered window (up to CAPACITY in the store).
  const visibleItems = useMemo(
    () => (isMobile ? items.slice(0, MOBILE_CAP) : items),
    [items, isMobile],
  );
  const groups = useMemo(() => groupActivityLog(visibleItems, now), [visibleItems, now]);
  const locale = currentLocale();

  return (
    <Panel
      title={t("activity.title")}
      subtitle={logSpanLabel(visibleItems, now, t, locale) ?? undefined}
      headerRight={
        <>
          {hasDescendants && (
            <button
              type="button"
              onClick={() => void setIncludeDescendants(!includeDescendants, descendantIds)}
              title={
                includeDescendants
                  ? t("activity.toggleDescendants.on")
                  : t("activity.toggleDescendants.off")
              }
              aria-pressed={includeDescendants}
              className={
                includeDescendants
                  ? "inline-flex items-center justify-center w-7 h-7 rounded-sm bg-primary-fill text-white hover:bg-primary-fill-hover transition-colors"
                  : "inline-flex items-center justify-center w-7 h-7 rounded-sm bg-transparent text-primary border border-[var(--p-100)] hover:bg-primary-light transition-colors"
              }
            >
              <Network size={13} strokeWidth={1.5} />
            </button>
          )}
          <span
            className={
              "inline-flex items-center gap-[5px] px-2 py-0.5 rounded-full text-caption font-semibold whitespace-nowrap " +
              (isLive
                ? "bg-[var(--green-50)] text-[var(--green-700)]"
                : "bg-background text-text-tertiary")
            }
          >
            <span
              aria-hidden="true"
              className={`w-1.5 h-1.5 rounded-full ${isLive ? "bg-success" : "border border-text-tertiary"}`}
            />
            {isLive ? t("activity.live") : t("activity.offline")}
          </span>
        </>
      }
    >
      {/* One log slice. Desktop scrolls inside it (the lid stays outside the
          scroll); mobile lets the page scroll the (small) list. */}
      <div
        className="md:overflow-y-auto"
        style={isMobile ? undefined : { maxHeight: DESKTOP_MAX_HEIGHT_PX }}
      >
        {status === "loading" && items.length === 0 && (
          <div className="px-4 py-3 text-caption text-text-tertiary">{t("activity.loading")}</div>
        )}
        {status === "error" && items.length === 0 && (
          <div className="px-4 py-3 flex items-center gap-2 text-caption text-error">
            <span>{t("activity.loadError")}</span>
            <button
              type="button"
              onClick={() => void retry()}
              className="inline-flex items-center gap-1 text-primary hover:text-primary-hover font-medium underline underline-offset-2"
            >
              <RotateCw size={12} strokeWidth={2} />
              {t("activity.retry")}
            </button>
          </div>
        )}
        {status === "ready" && items.length === 0 && (
          <div className="px-4 py-3 text-caption text-text-tertiary">{t("activity.empty")}</div>
        )}
        {groups.length > 0 && (
          // The rail runs down the centre of the 20 px dot column:
          // 16 px padding + 44 px time + 10 px gap + 9.5 px.
          <ol
            data-testid="activity-log"
            className="relative pt-1.5 pb-2 before:content-[''] before:absolute before:left-[79.5px] before:top-3.5 before:bottom-3.5 before:w-px before:bg-border"
          >
            {groups.map((group) => (
              <li key={group.key}>
                {group.labelled && (
                  <div className="pl-[100px] pr-4 pt-2 pb-0.5 text-caption font-semibold text-text-tertiary">
                    {logPeriodLabel(group.period, t, locale)}
                  </div>
                )}
                <ul>
                  {group.items.map((item) => (
                    <ActivityItemRow key={item.id} item={item} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}

function collectDescendantIds(tree: ZoneWithChildren[], zoneId: string): string[] {
  const found = findZone(tree, zoneId);
  if (!found) return [];
  const out: string[] = [];
  const walk = (z: ZoneWithChildren) => {
    for (const child of z.children ?? []) {
      out.push(child.id);
      walk(child);
    }
  };
  walk(found);
  return out;
}

function findZone(tree: ZoneWithChildren[], zoneId: string): ZoneWithChildren | null {
  for (const z of tree) {
    if (z.id === zoneId) return z;
    const child = findZone(z.children ?? [], zoneId);
    if (child) return child;
  }
  return null;
}
