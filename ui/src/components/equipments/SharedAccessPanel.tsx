import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { getSharedAccessGatePanel, setSharedAccessArmed } from "../../api";
import { useSharedAccess } from "../../store/useSharedAccess";
import { Refusal, Switch, btnPrimary, errorCode, useRefusalText } from "../shared-access/ui";
import { ConfigRow } from "./ConfigRow";

/**
 * Spec 181 R8.31 — « Accès partagés » on a gate's own page, beside
 * « Confirmation avant action »: the armed switch, how many people can open
 * this gate, and « Créer un accès » with this gate already listed.
 * Admin-only, gate-only — the caller gates the mount; the panel itself stays
 * hidden while the feature is off.
 */
export function SharedAccessPanel({
  equipmentId,
  defaultOpen = false,
}: {
  equipmentId: string;
  /** Open on arrival; the equipment page keeps its Configuration rows closed. */
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const enabled = useSharedAccess((s) => s.enabled);
  const refreshStore = useSharedAccess((s) => s.refreshSoon);
  const refusalText = useRefusalText();
  const [panel, setPanel] = useState<{ armed: boolean; people: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (enabled !== true) return;
    let alive = true;
    getSharedAccessGatePanel(equipmentId)
      .then((p) => alive && setPanel(p))
      .catch((err: unknown) => alive && setError(refusalText(errorCode(err))));
    return () => {
      alive = false;
    };
  }, [enabled, equipmentId, refusalText]);

  if (enabled !== true) return null;

  const toggle = async (armed: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setPanel(await setSharedAccessArmed(equipmentId, armed));
      refreshStore();
    } catch (err) {
      setError(refusalText(errorCode(err)));
    } finally {
      setBusy(false);
    }
  };

  const people = panel?.people ?? 0;
  const armed = panel?.armed ?? true;

  const summary = !panel
    ? undefined
    : !armed
      ? t("sharedAccess.disarmed")
      : people > 0
        ? t("sharedAccess.panel.summary", { count: people })
        : t("sharedAccess.panel.summaryNobody");

  return (
    <ConfigRow
      icon={KeyRound}
      title={t("sharedAccess.title")}
      summary={summary}
      summaryTone={panel && !armed ? "alert" : "muted"}
      defaultOpen={defaultOpen}
    >
      {!panel && !error ? (
        <Loader2 size={14} className="animate-spin text-text-tertiary" />
      ) : (
        <>
          <p className="text-caption text-text-tertiary">
            {!armed ? (
              <>
                <b className="text-error">{t("sharedAccess.panel.disarmedTitle")}</b>{" "}
                {t("sharedAccess.panel.disarmed", { count: people })}
              </>
            ) : people > 0 ? (
              t("sharedAccess.panel.people", { count: people })
            ) : (
              t("sharedAccess.panel.nobody")
            )}
            {people > 0 && (
              <>
                {" "}
                <Link
                  to={`/shared-access?gate=${encodeURIComponent(equipmentId)}`}
                  className="font-semibold text-primary hover:underline"
                >
                  {t("sharedAccess.panel.seeAccesses")}
                </Link>
              </>
            )}
          </p>
          <div className="flex items-center gap-2.5 mt-3 flex-wrap">
            <Switch
              checked={armed}
              disabled={busy || !panel}
              label={t("sharedAccess.armed")}
              onChange={(next) => void toggle(next)}
            />
            <span className="text-small text-text">
              {armed ? t("sharedAccess.armed") : t("sharedAccess.disarmed")}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              className={btnPrimary}
              onClick={() =>
                navigate(`/shared-access?gate=${encodeURIComponent(equipmentId)}&new=1`)
              }
            >
              {t("sharedAccess.create")}
            </button>
          </div>
        </>
      )}
      {error && <Refusal>{error}</Refusal>}
    </ConfigRow>
  );
}
