import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRecipes } from "../../store/useRecipes";
import { groupActivityLog, logPeriodLabel, logSpanLabel } from "../../lib/activity-log";
import { currentLocale, formatClockTime } from "../../lib/format";
import { journalItems } from "../../lib/recipe-journal";
import type { RecipeLogEntry } from "../../types";

const LEVEL_CLASS: Record<RecipeLogEntry["level"], string> = {
  error: "text-error",
  warn: "text-warning-ink",
  info: "text-text-secondary",
};

/**
 * A recipe instance's journal (spec 198), shown inline under its row on a
 * computer and in the bottom sheet on a phone. It reads like the Activity
 * panel: newest first, a label where it crosses into another part of the
 * day, `HH:MM`, and how far back it reaches. Refreshed every 5 s while shown.
 */
export function RecipeJournal({
  instanceId,
  action,
  listClassName = "",
}: {
  instanceId: string;
  action?: ReactNode;
  /** Scroll classes for the entries only: the header and its action stay in view. */
  listClassName?: string;
}) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const getLog = useRecipes((s) => s.getLog);
  const [entries, setEntries] = useState<RecipeLogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const load = async () => {
      // One request at a time: a slow answer never overwrites a newer one.
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await getLog(instanceId);
        if (alive) {
          setEntries(next);
          setFailed(false);
          setNow(new Date());
        }
      } catch {
        // A failed refresh keeps the last entries; a failed first load says so
        // rather than reading as an empty journal.
        if (alive) setFailed(true);
      } finally {
        inFlight = false;
      }
    };
    void load();
    const id = setInterval(() => void load(), 5_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [getLog, instanceId]);

  const items = useMemo(() => journalItems(entries ?? []), [entries]);
  const groups = useMemo(() => groupActivityLog(items, now), [items, now]);
  const span = logSpanLabel(items, now, t, locale);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 min-h-7">
        <span className="text-caption text-text-tertiary">
          <span className="font-medium">{t("recipes.journal")}</span>
          {span && <span>, {span}</span>}
        </span>
        {action}
      </div>
      {entries === null && failed && (
        <p className="text-caption text-warning-ink text-center py-2">
          {t("recipes.journalError")}
        </p>
      )}
      {entries !== null && items.length === 0 && (
        <p className="text-caption text-text-tertiary text-center py-2">{t("common.noLogs")}</p>
      )}
      <div className={listClassName}>
        {groups.map((g) => (
          <section key={g.key} aria-label={logPeriodLabel(g.period, t, locale)}>
            <h4 className="text-caption font-semibold text-text-tertiary pt-2 pb-0.5">
              {logPeriodLabel(g.period, t, locale)}
            </h4>
            <ul>
              {g.items.map((item) => (
                <li
                  key={item.id}
                  className={`grid grid-cols-[2.75rem_1fr] gap-2 py-0.5 ${LEVEL_CLASS[item.level]}`}
                >
                  <time
                    dateTime={new Date(item.timestamp).toISOString()}
                    className={`text-caption tabular-nums ${item.level === "info" ? "text-text-tertiary" : ""}`}
                  >
                    {formatClockTime(item.timestamp, { locale })}
                  </time>
                  <span className="text-micro font-mono leading-5 break-words min-w-0">
                    {item.message}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
