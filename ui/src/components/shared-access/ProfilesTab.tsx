import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Star } from "lucide-react";
import {
  createSharedAccessProfile,
  deleteSharedAccessProfile,
  updateSharedAccessProfile,
} from "../../api";
import type { SharedAccessProfileView, SharedAccessState } from "../../types";
import {
  type ValidityDraft,
  checkValidity,
  emptyValidity,
  nowWall,
  validityBody,
  validityFromView,
} from "../../lib/shared-access-period";
import { refusalField, type RefusalField } from "../../lib/shared-access-errors";
import { useSharedAccess } from "../../store/useSharedAccess";
import { ValidityGroups } from "./ValidityGroups";
import { defaultGateValue, gatesBody, pluginName } from "./helpers";
import type { GateDraft } from "./AccessEditor";
import { useSaFormat } from "./useSaFormat";
import { useValidityText } from "./useValidityText";
import {
  Refusal,
  btnDanger,
  btnPrimary,
  btnSecondary,
  errorCode,
  inputBadCls,
  inputCls,
  labelCls,
  useRefusalText,
  useValueLabel,
} from "./ui";

const NEW = "__new__";

/**
 * R9.32–33 — the « Profils » tab: what opens, for which plugin. The default
 * profile is marked and cannot be deleted; the others can, and the accesses
 * already made from them keep their gates until their own end.
 */
export function ProfilesTab({ state }: { state: SharedAccessState }) {
  const { t } = useTranslation();
  const fmt = useSaFormat();
  const [selected, setSelected] = useState<string | null>(
    () => state.profiles.find((p) => p.isDefault)?.id ?? state.profiles[0]?.id ?? null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  // The editor's identity: it changes when the owner picks another profile or
  // « + profil », never when a new profile gets its id — so the editor, and
  // its « saved / no gate yet » message, survive the create.
  const [editorKey, setEditorKey] = useState(0);
  const pick = (id: string | null) => {
    if (id !== selected) setEditorKey((k) => k + 1);
    setSelected(id);
    setNotice(null);
  };

  const current =
    selected === NEW ? null : (state.profiles.find((p) => p.id === selected) ?? null);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div>
        <ul className="flex flex-col gap-1.5">
          {state.profiles.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-current={p.id === selected}
                onClick={() => pick(p.id)}
                className={`w-full text-left bg-surface border rounded-[10px] px-3 py-2.5 cursor-pointer transition-colors ${
                  p.id === selected ? "border-primary" : "border-border hover:border-text-tertiary"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {p.isDefault && (
                    <Star
                      size={14}
                      strokeWidth={1.5}
                      className="text-warning"
                      role="img"
                      aria-label={t("sharedAccess.profiles.defaultTitle")}
                    >
                      <title>{t("sharedAccess.profiles.defaultTitle")}</title>
                    </Star>
                  )}
                  <span className="text-[14px] font-semibold text-text">{p.name}</span>

                  {p.gates.length === 0 && (
                    <span className="text-[11.5px] rounded-full px-2 py-0.5 bg-warning/15 text-warning">
                      {t("sharedAccess.profiles.noGate")}
                    </span>
                  )}
                  <span
                    className={`text-[11.5px] rounded-full px-2 py-0.5 ${
                      p.pluginId ? "bg-primary-light text-primary" : "bg-border-light text-text-tertiary"
                    }`}
                  >
                    {p.pluginId
                      ? t("sharedAccess.profiles.grantedTo", { plugin: pluginName(state, p.pluginId) })
                      : t("sharedAccess.profiles.noPlugin")}
                  </span>
                </div>
                <div className="text-[12px] text-text-secondary mt-1">
                  {p.gates.length
                    ? p.gates.map((g) => g.name).join(", ")
                    : t("sharedAccess.profiles.opensNothing")}{" "}
                  · {fmt.period(p.validFrom, p.validUntil)} · {fmt.hours(p.timeWindows)} ·{" "}
                  {p.withCode ? t("sharedAccess.profiles.withCodeShort") : t("sharedAccess.line.linkOnly")}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <button
            type="button"
            className={`${btnSecondary} inline-flex items-center gap-1`}
            onClick={() => pick(NEW)}
          >
            <Plus size={14} strokeWidth={1.5} />
            {t("sharedAccess.profiles.add")}
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-[10px] p-4">
        {selected === NEW || current ? (
          <ProfileEditor
            key={editorKey}
            profile={current}
            state={state}
            onCreated={(id) => setSelected(id)}
            onDeleted={(name) => {
              setSelected(null);
              setNotice(t("sharedAccess.profiles.deleted", { name }));
            }}
          />
        ) : notice ? (
          <p className="text-[13px] text-success">{notice}</p>
        ) : (
          <p className="text-[13px] text-text-tertiary">{t("sharedAccess.profiles.pick")}</p>
        )}
      </div>
    </div>
  );
}

interface Message {
  ok: boolean;
  field: RefusalField;
  text: string;
}

function ProfileEditor({
  profile,
  state,
  onCreated,
  onDeleted,
}: {
  profile: SharedAccessProfileView | null;
  state: SharedAccessState;
  onCreated: (id: string) => void;
  onDeleted: (name: string) => void;
}) {
  const { t } = useTranslation();
  const fmt = useSaFormat();
  const refusalText = useRefusalText();
  const validityText = useValidityText();
  const valueLabel = useValueLabel();
  const refresh = useSharedAccess((s) => s.refresh);
  const gateById = useMemo(
    () => new Map(state.gates.map((g) => [g.equipmentId, g])),
    [state.gates],
  );

  const [name, setName] = useState(profile?.name ?? t("sharedAccess.profiles.newName"));
  const [gates, setGates] = useState<GateDraft[]>(
    () =>
      profile?.gates.map((g) => ({
        equipmentId: g.equipmentId,
        value: typeof g.value === "string" ? g.value : null,
      })) ?? [],
  );
  // What the editor opened with: a bound the owner leaves alone is not sent.
  const [initialValidity, setInitialValidity] = useState<ValidityDraft | undefined>(() =>
    profile ? validityFromView(profile, fmt.tz) : undefined,
  );
  const [validity, setValidity] = useState<ValidityDraft>(
    () => initialValidity ?? emptyValidity(nowWall(fmt.tz)),
  );
  const [withCode, setWithCode] = useState(profile?.withCode ?? true);
  const [pluginId, setPluginId] = useState(profile?.pluginId ?? "");
  const [message, setMessage] = useState<Message | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const errorFor = (field: RefusalField) =>
    message && !message.ok && message.field === field ? message.text : null;

  const toggleGate = (id: string, on: boolean) =>
    setGates(
      on
        ? [...gates, { equipmentId: id, value: defaultGateValue(gateById.get(id)) }]
        : gates.filter((g) => g.equipmentId !== id),
    );

  const save = async () => {
    setMessage(null);
    setConfirmDelete(false);
    if (!name.trim()) {
      setMessage({ ok: false, field: "name", text: refusalText("name_required") });
      return;
    }
    const check = checkValidity(validity);
    if (check) {
      setMessage({ ok: false, field: check.group, text: validityText(check) });
      return;
    }
    const body = {
      name: name.trim(),
      gates: gatesBody(gates, gateById),
      withCode,
      pluginId: pluginId || null,
      ...validityBody(validity, initialValidity),
    };
    setSaving(true);
    try {
      const saved = profile
        ? await updateSharedAccessProfile(profile.id, body)
        : await createSharedAccessProfile(body);
      await refresh();
      // What the server now holds is the new reference for « changed ».
      setInitialValidity(validityFromView(saved, fmt.tz));
      const isDefault = saved.isDefault;
      setMessage({
        ok: true,
        field: "other",
        text:
          saved.gates.length > 0
            ? t("sharedAccess.profiles.saved")
            : isDefault
              ? t("sharedAccess.profiles.savedNoGateDefault")
              : t("sharedAccess.profiles.savedNoGate"),
      });
      if (!profile) onCreated(saved.id);
    } catch (err) {
      const code = errorCode(err);
      const field = refusalField(code);
      setMessage({ ok: false, field: field === "label" ? "name" : field, text: refusalText(code) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await deleteSharedAccessProfile(profile.id);
      await refresh();
      onDeleted(profile.name);
    } catch (err) {
      setMessage({ ok: false, field: "other", text: refusalText(errorCode(err)) });
      setConfirmDelete(false);
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-[14px] font-semibold text-text mb-3">
        {!profile
          ? t("sharedAccess.profiles.newTitle")
          : profile.isDefault
            ? t("sharedAccess.profiles.defaultTitle")
            : t("sharedAccess.profiles.editTitle")}
      </h3>

      <label className={labelCls} htmlFor="sa-profile-name">
        {t("common.name")}
      </label>
      <input
        id="sa-profile-name"
        className={`${errorFor("name") ? inputBadCls : inputCls} w-full`}
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      {errorFor("name") && <Refusal>{errorFor("name")}</Refusal>}

      <div className="mt-4">
        <span className={labelCls}>{t("sharedAccess.profiles.gates")}</span>
        <div className="flex flex-col gap-1.5">
          {state.gates.map((g) => {
            const draft = gates.find((x) => x.equipmentId === g.equipmentId);
            return (
              <div
                key={g.equipmentId}
                className="flex items-center gap-2 flex-wrap bg-background border border-border rounded-[6px] px-2.5 py-1.5"
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!draft}
                    disabled={!g.hasCommand}
                    onChange={(e) => toggleGate(g.equipmentId, e.target.checked)}
                  />
                  <span className="text-[13.5px] font-semibold text-text">{g.name}</span>
                </label>
                {!g.hasCommand && (
                  <span className="text-[12px] text-text-tertiary">{t("sharedAccess.editor.noCommand")}</span>
                )}
                {draft && g.commandValues.length > 1 && (
                  <>
                    <span className="text-[12px] text-text-tertiary">{t("sharedAccess.editor.sends")}</span>
                    <select
                      className={`${inputCls} py-1`}
                      value={draft.value ?? ""}
                      aria-label={t("sharedAccess.editor.valueFor", { name: g.name })}
                      onChange={(e) =>
                        setGates(
                          gates.map((x) =>
                            x.equipmentId === g.equipmentId ? { ...x, value: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      {g.commandValues.map((v) => (
                        <option key={v} value={v}>
                          {valueLabel(v)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            );
          })}
          {state.gates.length === 0 && (
            <p className="text-[12.5px] text-text-tertiary">{t("sharedAccess.profiles.noGateInHouse")}</p>
          )}
        </div>
        {errorFor("gates") && <Refusal>{errorFor("gates")}</Refusal>}
      </div>

      <ValidityGroups
        value={validity}
        onChange={setValidity}
        datesError={errorFor("dates")}
        hoursError={errorFor("hours")}
      />

      <label className="flex items-center gap-2 mt-3 text-[13.5px] text-text cursor-pointer">
        <input type="checkbox" checked={withCode} onChange={(e) => setWithCode(e.target.checked)} />
        {t("sharedAccess.profiles.withCode")}
      </label>

      <div className="mt-3">
        <label className={labelCls} htmlFor="sa-profile-plugin">
          {t("sharedAccess.profiles.grantedToLabel")}
        </label>
        <select
          id="sa-profile-plugin"
          className={`${inputCls} w-full`}
          value={pluginId}
          onChange={(e) => setPluginId(e.target.value)}
        >
          <option value="">{t("sharedAccess.profiles.noPlugin")}</option>
          {state.plugins.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {pluginId && !state.plugins.some((p) => p.id === pluginId) && (
            <option value={pluginId}>{pluginId}</option>
          )}
        </select>
      </div>

      {message && message.ok && <p className="text-[13px] text-success mt-3">{message.text}</p>}
      {errorFor("other") && <Refusal>{errorFor("other")}</Refusal>}

      {confirmDelete && profile && (
        <div className="mt-3 bg-error/10 rounded-[6px] px-3 py-2.5 text-[13px] text-error">
          {t("sharedAccess.profiles.deleteConfirm", { name: profile.name })}
          <div className="flex gap-2 mt-2">
            <button type="button" className={btnDanger} disabled={saving} onClick={() => void remove()}>
              {t("common.delete")}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mt-5">
        {profile && (
          <button
            type="button"
            className={btnDanger}
            disabled={saving}
            onClick={() => {
              if (profile.isDefault) {
                setConfirmDelete(false);
                setMessage({ ok: false, field: "other", text: t("sharedAccess.profiles.defaultRefused") });
                return;
              }
              setMessage(null);
              setConfirmDelete(true);
            }}
          >
            {t("common.delete")}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
