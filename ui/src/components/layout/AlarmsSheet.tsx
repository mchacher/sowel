import { AlertTriangle, AlertOctagon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../dashboard/BottomSheet";
import { INTEGRATION_LABELS } from "../../constants";
import { useAggregatedIssues, type AggregatedIssue } from "./useAggregatedIssues";

interface AlarmsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function AlarmsSheet({ open, onClose }: AlarmsSheetProps) {
  const { t } = useTranslation();
  const issues = useAggregatedIssues();

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("alarms.title")}
      icon={<AlertTriangle size={18} strokeWidth={1.5} className="text-error" />}
    >
      {issues.length === 0 ? (
        <div className="text-center text-text-tertiary text-[13px] py-6">{t("alarms.empty")}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {issues.map((issue) => (
            <IssueRow key={issue.key} issue={issue} />
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}

function IssueRow({ issue }: { issue: AggregatedIssue }) {
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
    <li className="flex items-start gap-3 px-3 py-2.5 rounded-[8px] bg-border-light/50">
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
    </li>
  );
}
