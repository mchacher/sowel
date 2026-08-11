import { useMemo } from "react";
import { AlertTriangle, AlertOctagon, X, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../dashboard/BottomSheet";
import { INTEGRATION_LABELS } from "../../constants";
import { useAggregatedIssues, type AggregatedIssue } from "./useAggregatedIssues";
import { useAckedIssues } from "../../store/useAckedIssues";
import { issueSignature } from "../../lib/acked-issues";

interface AlarmsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function AlarmsSheet({ open, onClose }: AlarmsSheetProps) {
  const { t } = useTranslation();
  const issues = useAggregatedIssues();
  const acked = useAckedIssues((s) => s.acked);
  const ack = useAckedIssues((s) => s.ack);
  const unack = useAckedIssues((s) => s.unack);

  const { active, acknowledged } = useMemo(() => {
    const active: AggregatedIssue[] = [];
    const acknowledged: AggregatedIssue[] = [];
    for (const issue of issues) {
      (acked.has(issueSignature(issue)) ? acknowledged : active).push(issue);
    }
    return { active, acknowledged };
  }, [issues, acked]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("alarms.title")}
      icon={<AlertTriangle size={18} strokeWidth={1.5} className="text-error" />}
    >
      {active.length === 0 && acknowledged.length === 0 ? (
        <div className="text-center text-text-tertiary text-[13px] py-6">{t("alarms.empty")}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {active.length > 0 && (
            <ul className="flex flex-col gap-2">
              {active.map((issue) => (
                <IssueRow
                  key={issue.key}
                  issue={issue}
                  onAcknowledge={() => ack(issueSignature(issue))}
                />
              ))}
            </ul>
          )}

          {acknowledged.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[11px] font-semibold uppercase text-text-tertiary px-1">
                {t("alarms.acknowledgedSection")}
              </div>
              <ul className="flex flex-col gap-2">
                {acknowledged.map((issue) => (
                  <IssueRow
                    key={issue.key}
                    issue={issue}
                    acknowledged
                    onRestore={() => unack(issueSignature(issue))}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function IssueRow({
  issue,
  acknowledged = false,
  onAcknowledge,
  onRestore,
}: {
  issue: AggregatedIssue;
  acknowledged?: boolean;
  onAcknowledge?: () => void;
  onRestore?: () => void;
}) {
  const { t } = useTranslation();
  const isError = issue.level === "error";
  const Icon = isError ? AlertOctagon : AlertTriangle;
  const tone = isError ? "text-error" : "text-warning";
  const sourceLabel = INTEGRATION_LABELS[issue.source] ?? issue.source;

  // Aggregated issues from integration status carry an i18n key as the
  // message. Alarms emitted by the engine carry a free-form message.
  // The convention is "alarms.*" → translate; anything else → render as-is.
  const message = issue.message.startsWith("alarms.") ? t(issue.message) : issue.message;

  return (
    <li
      className={`flex items-start gap-3 px-3 py-2.5 rounded-[8px] bg-border-light/50 ${
        acknowledged ? "opacity-60" : ""
      }`}
    >
      <Icon size={16} strokeWidth={1.5} className={`mt-0.5 flex-shrink-0 ${tone}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-text">
          <span>{sourceLabel}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
              isError ? "bg-error/10 text-error" : "bg-warning/10 text-warning"
            }`}
          >
            {isError ? t("alarms.level.error") : t("alarms.level.warning")}
          </span>
        </div>
        <div className="text-[12px] text-text-secondary mt-0.5 break-words">{message}</div>
      </div>
      {acknowledged ? (
        <button
          type="button"
          onClick={onRestore}
          title={t("alarms.unacknowledge")}
          aria-label={t("alarms.unacknowledge")}
          className="mt-0.5 flex-shrink-0 text-text-tertiary hover:text-text transition-colors"
        >
          <Undo2 size={15} strokeWidth={1.5} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onAcknowledge}
          title={t("alarms.acknowledge")}
          aria-label={t("alarms.acknowledge")}
          className="mt-0.5 flex-shrink-0 text-text-tertiary hover:text-text transition-colors"
        >
          <X size={15} strokeWidth={1.5} />
        </button>
      )}
    </li>
  );
}
