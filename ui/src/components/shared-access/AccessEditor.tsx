import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { createSharedAccess, updateSharedAccess } from "../../api";
import type {
  SharedAccessState,
  SharedAccessView,
  SharedAccessWrite,
} from "../../types";
import {
  type ValidityDraft,
  type Wall,
  addMinutes,
  checkValidity,
  emptyValidity,
  isoToWall,
  nowWall,
  validityBody,
  validityFromView,
  wallToString,
} from "../../lib/shared-access-period";
import { refusalField, type RefusalField } from "../../lib/shared-access-errors";
import { useSharedAccess } from "../../store/useSharedAccess";
import { DateTimePicker } from "./DateTimePicker";
import { Invitation } from "./Invitation";
import { ValidityGroups } from "./ValidityGroups";
import { useSaFormat } from "./useSaFormat";
import { useValidityText } from "./useValidityText";
import { defaultGateValue, gatesBody, pluginName } from "./helpers";
import {
  Dialog,
  Refusal,
  btnPrimary,
  btnSecondary,
  errorCode,
  iconBtn,
  inputBadCls,
  inputCls,
  labelCls,
  useRefusalText,
  useValueLabel,
} from "./ui";

export interface GateDraft {
  equipmentId: string;
  /** Null for an impulse gate: what its own button sends. */
  value: string | null;
}

export type EditorMode =
  | { kind: "create"; gateIds: string[] }
  | { kind: "edit"; access: SharedAccessView };

interface Problem {
  field: RefusalField;
  text: string;
}

/**
 * Create or edit an access (R3, R7.29). For an external access the dates are
 * its source's, shown read-only, and the owner may only widen them.
 */
export function AccessEditor({
  mode,
  state,
  onClose,
}: {
  mode: EditorMode;
  state: SharedAccessState;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const refusalText = useRefusalText();
  const validityText = useValidityText();
  const valueLabel = useValueLabel();
  const fmt = useSaFormat();
  const refresh = useSharedAccess((s) => s.refresh);
  const editing = mode.kind === "edit" ? mode.access : null;
  const external = editing?.kind === "external" ? editing : null;
  const source = external?.source ?? null;
  const gateById = useMemo(
    () => new Map(state.gates.map((g) => [g.equipmentId, g])),
    [state.gates],
  );

  const [label, setLabel] = useState(editing?.label ?? "");
  const [gates, setGates] = useState<GateDraft[]>(() =>
    editing
      ? editing.gates.map((g) => ({
          equipmentId: g.equipmentId,
          value: typeof g.value === "string" ? g.value : null,
        }))
      : mode.kind === "create"
        ? mode.gateIds.map((id) => ({ equipmentId: id, value: defaultGateValue(gateById.get(id)) }))
        : [],
  );
  const [validity, setValidity] = useState<ValidityDraft>(() =>
    editing ? validityFromView(editing, fmt.tz) : emptyValidity(nowWall(fmt.tz)),
  );
  const [withCode, setWithCode] = useState(editing ? editing.code !== null : true);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");

  // External: widen only (R3.10).
  const sourceFrom = source?.from ? isoToWall(source.from, fmt.tz) : null;
  const sourceUntil = source?.until ? isoToWall(source.until, fmt.tz) : null;
  const [early, setEarly] = useState<Wall | null>(() =>
    source?.earlyOpenAt ? isoToWall(source.earlyOpenAt, fmt.tz) : null,
  );
  const [extended, setExtended] = useState<Wall | null>(() =>
    source?.extendedUntil ? isoToWall(source.extendedUntil, fmt.tz) : null,
  );

  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<SharedAccessView | null>(null);

  const free = state.gates.filter((g) => !gates.some((d) => d.equipmentId === g.equipmentId));
  const errorFor = (field: RefusalField) => (problem?.field === field ? problem.text : null);

  const save = async () => {
    setProblem(null);
    if (!label.trim()) {
      setProblem({ field: "label", text: refusalText("label_required") });
      return;
    }
    if (gates.length === 0) {
      setProblem({ field: "gates", text: refusalText("no_gate") });
      return;
    }
    const check = checkValidity(external ? { ...validity, period: false } : validity);
    if (check) {
      setProblem({ field: check.group, text: validityText(check) });
      return;
    }
    const v = validityBody(validity);
    const body: SharedAccessWrite = external
      ? {
          label: label.trim(),
          gates: gatesBody(gates, gateById),
          timeWindows: v.timeWindows,
          earlyOpenAt: early ? wallToString(early) : null,
          extendedUntil: extended ? wallToString(extended) : null,
        }
      : { label: label.trim(), gates: gatesBody(gates, gateById), withCode, ...v };
    setSaving(true);
    try {
      if (editing) {
        await updateSharedAccess(editing.id, body);
        await refresh();
        onClose();
      } else {
        const view = await createSharedAccess(body);
        await refresh();
        setCreated(view);
      }
    } catch (err) {
      const code = errorCode(err);
      setProblem({ field: refusalField(code), text: refusalText(code) });
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? t("sharedAccess.editor.editTitle") : t("sharedAccess.editor.newTitle");

  if (created) {
    return (
      <Dialog title={title} onClose={onClose} wide>
        <p className="text-[13px] text-success">
          {t("sharedAccess.editor.created", { label: created.label })}
        </p>
        <p className="text-[12.5px] text-text-secondary mt-1">
          {created.gates.map((g) => g.name).join(", ")} · {fmt.period(created.validFrom, created.validUntil)} ·{" "}
          {fmt.hours(created.timeWindows)}
        </p>
        <Invitation link={created.invitationUrl} code={created.code} />
        <div className="flex justify-end mt-5">
          <button type="button" className={btnPrimary} onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </Dialog>
    );
  }

  const externalDates = external && (
    <div className="text-[13px] text-text-secondary space-y-2.5">
      <p>
        {t("sharedAccess.editor.sourceDates", {
          plugin: pluginName(state, source?.pluginId),
          period: fmt.period(source?.from ?? null, source?.until ?? null),
        })}
      </p>
      {sourceFrom && (
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={early !== null}
              onChange={(e) => setEarly(e.target.checked ? addMinutes(sourceFrom, -60) : null)}
            />
            {t("sharedAccess.editor.openEarlier")}
          </label>
          {early && (
            <div className="mt-1.5 ml-6">
              <DateTimePicker
                label={t("sharedAccess.editor.openEarlier")}
                value={early}
                bounds={{ max: sourceFrom }}
                onChange={setEarly}
                dayRefusedText={t("sharedAccess.editor.widenOnlyEarly")}
              />
            </div>
          )}
        </div>
      )}
      {sourceUntil && (
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={extended !== null}
              onChange={(e) => setExtended(e.target.checked ? addMinutes(sourceUntil, 60) : null)}
            />
            {t("sharedAccess.editor.extend")}
          </label>
          {extended && (
            <div className="mt-1.5 ml-6">
              <DateTimePicker
                label={t("sharedAccess.editor.extend")}
                value={extended}
                bounds={{ min: sourceUntil }}
                onChange={setExtended}
                dayRefusedText={t("sharedAccess.editor.widenOnlyLate")}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Dialog title={title} onClose={onClose} wide>
      <div>
        <label className={labelCls} htmlFor="sa-label">
          {t("sharedAccess.editor.label")}
        </label>
        <input
          id="sa-label"
          className={`${errorFor("label") ? inputBadCls : inputCls} w-full`}
          value={label}
          maxLength={80}
          placeholder={t("sharedAccess.editor.labelPlaceholder")}
          onChange={(e) => setLabel(e.target.value)}
        />
        {errorFor("label") && <Refusal>{errorFor("label")}</Refusal>}
      </div>

      <div className="mt-4">
        <span className={labelCls}>{t("sharedAccess.editor.gates")}</span>
        <div className="flex flex-col gap-1.5">
          {gates.map((g) => {
            const summary = gateById.get(g.equipmentId);
            const name =
              summary?.name ??
              editing?.gates.find((x) => x.equipmentId === g.equipmentId)?.name ??
              g.equipmentId;
            return (
              <div
                key={g.equipmentId}
                className="flex items-center gap-2 flex-wrap bg-background border border-border rounded-[6px] px-2.5 py-1.5"
              >
                <span className="text-[13.5px] font-semibold text-text">{name}</span>
                {summary && summary.commandValues.length > 1 ? (
                  <>
                    <span className="text-[12px] text-text-tertiary">{t("sharedAccess.editor.sends")}</span>
                    <select
                      className={`${inputCls} py-1`}
                      value={g.value ?? ""}
                      aria-label={t("sharedAccess.editor.valueFor", { name })}
                      onChange={(e) =>
                        setGates(
                          gates.map((x) =>
                            x.equipmentId === g.equipmentId ? { ...x, value: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      {summary.commandValues.map((v) => (
                        <option key={v} value={v}>
                          {valueLabel(v)}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="text-[12px] text-text-tertiary">{t("sharedAccess.editor.impulse")}</span>
                )}
                <button
                  type="button"
                  className={`${iconBtn} ml-auto`}
                  aria-label={t("sharedAccess.editor.removeGate", { name })}
                  onClick={() => setGates(gates.filter((x) => x.equipmentId !== g.equipmentId))}
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            );
          })}
          {gates.length === 0 && (
            <p className="text-[12.5px] text-text-tertiary">{t("sharedAccess.editor.noGateYet")}</p>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {adding ? (
            <>
              <select
                className={inputCls}
                value={pick}
                aria-label={t("sharedAccess.editor.pickGate")}
                onChange={(e) => setPick(e.target.value)}
              >
                <option value="">{t("sharedAccess.editor.pickGate")}</option>
                {free.map((g) => (
                  <option key={g.equipmentId} value={g.equipmentId} disabled={!g.hasCommand}>
                    {g.name}
                    {g.hasCommand ? "" : ` — ${t("sharedAccess.editor.noCommand")}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={btnSecondary}
                disabled={!pick}
                onClick={() => {
                  setGates([...gates, { equipmentId: pick, value: defaultGateValue(gateById.get(pick)) }]);
                  setPick("");
                  setAdding(false);
                  if (problem?.field === "gates") setProblem(null);
                }}
              >
                {t("common.add")}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setAdding(false)}>
                {t("common.cancel")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`${btnSecondary} inline-flex items-center gap-1`}
              disabled={free.length === 0}
              onClick={() => setAdding(true)}
            >
              <Plus size={14} strokeWidth={1.5} />
              {t("sharedAccess.editor.addGate")}
            </button>
          )}
        </div>
        {errorFor("gates") && <Refusal>{errorFor("gates")}</Refusal>}
      </div>

      <ValidityGroups
        value={validity}
        onChange={(v) => {
          setValidity(v);
          if (problem?.field === "dates" || problem?.field === "hours") setProblem(null);
        }}
        datesError={errorFor("dates")}
        hoursError={errorFor("hours")}
        datesSlot={externalDates || undefined}
      />

      {!external && (
        <label className="flex items-center gap-2 mt-3 text-[13.5px] text-text cursor-pointer">
          <input type="checkbox" checked={withCode} onChange={(e) => setWithCode(e.target.checked)} />
          {t("sharedAccess.editor.withCode")}
          <span className="text-[12.5px] text-text-tertiary">{t("sharedAccess.editor.withCodeHint")}</span>
        </label>
      )}

      {editing ? (
        <Invitation link={editing.invitationUrl} code={withCode ? editing.code : null} />
      ) : (
        <p className="mt-3 text-[12.5px] text-text-tertiary">
          {withCode ? t("sharedAccess.editor.invitationLater") : t("sharedAccess.invitation.noCode")}
        </p>
      )}

      {errorFor("other") && <Refusal>{errorFor("other")}</Refusal>}

      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
          {t("common.cancel")}
        </button>
        <button type="button" className={btnPrimary} onClick={() => void save()} disabled={saving}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </Dialog>
  );
}
