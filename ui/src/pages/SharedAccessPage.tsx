import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Globe, KeyRound, Loader2, Plus } from "lucide-react";
import { setSharedAccessArmed } from "../api";
import type { SharedAccessState, SharedAccessView } from "../types";
import { useSharedAccess } from "../store/useSharedAccess";
import { AccessEditor, type EditorMode } from "../components/shared-access/AccessEditor";
import { AccessRow } from "../components/shared-access/AccessRow";
import { ProfilesTab } from "../components/shared-access/ProfilesTab";
import {
  Refusal,
  Switch,
  btnPrimary,
  btnSecondary,
  errorCode,
  useRefusalText,
} from "../components/shared-access/ui";

type Tab = string; // a gate's equipment id, "all" or "profiles"
const ALL = "all";
const PROFILES = "profiles";

/** Ended and revoked lines sink below the ones that can still open. */
function rank(a: SharedAccessView): number {
  return a.status === "revoked" ? 2 : a.status === "ended" ? 1 : 0;
}

/**
 * Spec 181 R7 — the owner's page: a tab per gate listed on at least one
 * access, « Tous » once there are two, « Profils » last, and « + portail ».
 * `?gate=<id>` selects that gate's tab, `&new=1` opens a new access on it
 * (the gate panel's « Créer un accès », R8.31).
 */
export function SharedAccessPage() {
  const { t } = useTranslation();
  const enabled = useSharedAccess((s) => s.enabled);
  const state = useSharedAccess((s) => s.state);
  const refresh = useSharedAccess((s) => s.refresh);
  const error = useSharedAccess((s) => s.error);
  const loading = useSharedAccess((s) => s.loading);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <KeyRound size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1>{t("sharedAccess.title")}</h1>
        </div>
        <p className="text-[13px] text-text-secondary mt-1">{t("sharedAccess.subtitle")}</p>
      </div>
      {enabled === false ? (
        <p className="text-[13px] text-text-secondary">
          {t("sharedAccess.off")}{" "}
          <Link to="/settings?tab=general" className="text-primary hover:underline">
            {t("sharedAccess.openSettings")}
          </Link>
        </p>
      ) : !state && error && !loading ? (
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[13px] text-text-secondary">{t("sharedAccess.unreadable")}</p>
          <button type="button" className={btnSecondary} onClick={() => void refresh()}>
            {t("common.retry")}
          </button>
        </div>
      ) : !state ? (
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      ) : (
        <SharedAccessBody state={state} params={params} setParams={setParams} />
      )}
    </div>
  );
}

function SharedAccessBody({
  state,
  params,
  setParams,
}: {
  state: SharedAccessState;
  params: URLSearchParams;
  setParams: ReturnType<typeof useSearchParams>[1];
}) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [picking, setPicking] = useState(false);
  const gateParam = params.get("gate");

  // The gate tabs: every gate listed on at least one access, in the house's
  // order — plus the one the URL names, so the gate panel's link always lands.
  const gateTabs = useMemo(() => {
    const listed = new Set(state.accesses.flatMap((a) => a.gates.map((g) => g.equipmentId)));
    if (gateParam && state.gates.some((g) => g.equipmentId === gateParam)) listed.add(gateParam);
    const known = state.gates.filter((g) => listed.has(g.equipmentId));
    const orphans = [...listed].filter((id) => !state.gates.some((g) => g.equipmentId === id));
    return [
      ...known.map((g) => ({ id: g.equipmentId, name: g.name })),
      ...orphans.map((id) => ({
        id,
        name:
          state.accesses.flatMap((a) => a.gates).find((g) => g.equipmentId === id)?.name ?? id,
      })),
    ];
  }, [state, gateParam]);

  const [tab, setTab] = useState<Tab>(() =>
    gateParam && gateTabs.some((g) => g.id === gateParam) ? gateParam : (gateTabs[0]?.id ?? ALL),
  );
  const showAll = gateTabs.length >= 2;
  const validTab =
    tab === PROFILES ||
    gateTabs.some((g) => g.id === tab) ||
    (tab === ALL && (showAll || gateTabs.length === 0));
  const activeTab = validTab ? tab : (gateTabs[0]?.id ?? ALL);

  // `?new=1` — open the editor once, with the named gate listed.
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current) return;
    if (params.get("new") === "1") {
      openedFromUrl.current = true;
      const gate = gateParam && state.gates.some((g) => g.equipmentId === gateParam) ? gateParam : null;
      setEditor({ kind: "create", gateIds: gate ? [gate] : [] });
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  }, [params, setParams, gateParam, state.gates]);

  const selectTab = (id: Tab) => {
    setTab(id);
    const next = new URLSearchParams(params);
    if (id !== ALL && id !== PROFILES) next.set("gate", id);
    else next.delete("gate");
    setParams(next, { replace: true });
  };

  const openNewOn = (gateId: string | null) => {
    setPicking(false);
    if (gateId) selectTab(gateId);
    setEditor({ kind: "create", gateIds: gateId ? [gateId] : [] });
  };

  const lines = state.accesses
    .filter((a) =>
      activeTab === ALL ? true : a.gates.some((g) => g.equipmentId === activeTab),
    )
    .sort((a, b) => rank(a) - rank(b));

  const tabCls = (on: boolean) =>
    `px-3 py-2 text-[13px] font-medium transition-colors duration-150 border-b-2 -mb-px cursor-pointer whitespace-nowrap ${
      on
        ? "border-primary text-primary"
        : "border-transparent text-text-tertiary hover:text-text-secondary hover:border-border"
    }`;

  return (
    <>
      <HeaderLine state={state} />

      <div className="flex items-center gap-1 mb-4 border-b border-border overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
        {gateTabs.map((g) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={activeTab === g.id}
            className={tabCls(activeTab === g.id)}
            onClick={() => selectTab(g.id)}
          >
            {g.name}
          </button>
        ))}
        {showAll && (
          <button
            role="tab"
            aria-selected={activeTab === ALL}
            className={tabCls(activeTab === ALL)}
            onClick={() => selectTab(ALL)}
          >
            {t("sharedAccess.tabs.all")}
          </button>
        )}
        <button
          role="tab"
          aria-selected={activeTab === PROFILES}
          className={tabCls(activeTab === PROFILES)}
          onClick={() => selectTab(PROFILES)}
        >
          {t("sharedAccess.tabs.profiles")}
        </button>
        <button
          type="button"
          className={`${tabCls(false)} inline-flex items-center gap-1`}
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          <Plus size={14} strokeWidth={1.5} />
          {t("sharedAccess.tabs.addGate")}
        </button>
      </div>

      {picking && (
        <div className="mb-4 bg-surface border border-border rounded-[10px] p-3">
          <p className="text-[12.5px] text-text-secondary mb-2">{t("sharedAccess.tabs.pickGateHint")}</p>
          {state.gates.length === 0 ? (
            <p className="text-[13px] text-text-tertiary">{t("sharedAccess.profiles.noGateInHouse")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {state.gates.map((g) => (
                <button
                  key={g.equipmentId}
                  type="button"
                  disabled={!g.hasCommand}
                  title={g.hasCommand ? undefined : t("sharedAccess.editor.noCommand")}
                  onClick={() => openNewOn(g.equipmentId)}
                  className="px-3 py-1.5 text-[13px] border border-border rounded-[6px] hover:border-primary hover:text-primary disabled:opacity-50 cursor-pointer disabled:cursor-default"
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === PROFILES ? (
        <ProfilesTab state={state} />
      ) : (
        <>
          {activeTab !== ALL && <GateBar state={state} gateId={activeTab} onCreate={() => openNewOn(activeTab)} />}
          {lines.length === 0 ? (
            <div className="bg-surface border border-border rounded-[10px] p-5 text-center">
              <p className="text-[13px] text-text-secondary mb-3">{t("sharedAccess.empty")}</p>
              <button
                type="button"
                className={`${btnPrimary} inline-flex items-center gap-1`}
                onClick={() =>
                  activeTab === ALL ? setPicking(true) : openNewOn(activeTab)
                }
              >
                <Plus size={14} strokeWidth={1.5} />
                {t("sharedAccess.create")}
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((a) => (
                <AccessRow
                  key={a.id}
                  access={a}
                  state={state}
                  showGates={activeTab === ALL}
                  onEdit={() => setEditor({ kind: "edit", access: a })}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {editor && (
        <AccessEditor
          key={editor.kind === "edit" ? editor.access.id : `new-${editor.gateIds.join(",")}`}
          mode={editor}
          state={state}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}

/**
 * R7.30 — what the owner cannot otherwise know: whether each gate is armed and
 * whether the public page can be reached (a base URL is set).
 */
function HeaderLine({ state }: { state: SharedAccessState }) {
  const { t } = useTranslation();
  const listed = state.gates.filter((g) =>
    state.accesses.some((a) => a.gates.some((x) => x.equipmentId === g.equipmentId)),
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-4 text-[12.5px]">
      <span className="inline-flex items-center gap-1.5">
        <Globe size={14} strokeWidth={1.5} className="text-text-tertiary" />
        {state.publicUrl ? (
          <span className="text-text-secondary">
            {t("sharedAccess.header.publicAt")}{" "}
            <code className="font-mono text-[12px] text-text">{state.publicUrl}</code>
          </span>
        ) : (
          <span className="text-warning">
            {t("sharedAccess.header.noPublicUrl")}{" "}
            <Link to="/settings?tab=general" className="text-primary hover:underline">
              {t("sharedAccess.header.setIt")}
            </Link>
          </span>
        )}
      </span>
      {listed.map((g) => (
        <span
          key={g.equipmentId}
          className={`rounded-full px-2 py-0.5 ${
            g.armed ? "bg-success/15 text-success" : "bg-error/10 text-error"
          }`}
        >
          {g.name} · {g.armed ? t("sharedAccess.armed") : t("sharedAccess.disarmed")}
        </span>
      ))}
    </div>
  );
}

/** R2.4 — the gate's armed switch on its tab, and « Créer un accès » on it. */
function GateBar({
  state,
  gateId,
  onCreate,
}: {
  state: SharedAccessState;
  gateId: string;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const refresh = useSharedAccess((s) => s.refresh);
  const refusalText = useRefusalText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = state.gates.find((g) => g.equipmentId === gateId);
  if (!gate) {
    return <Refusal>{t("sharedAccess.gateGone")}</Refusal>;
  }
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2.5 flex-wrap">
        <Switch
          checked={gate.armed}
          disabled={busy}
          label={t("sharedAccess.armed")}
          onChange={async (next) => {
            setBusy(true);
            setError(null);
            try {
              await setSharedAccessArmed(gateId, next);
              await refresh();
            } catch (err) {
              setError(refusalText(errorCode(err)));
            } finally {
              setBusy(false);
            }
          }}
        />
        <span className="text-[13px] text-text">
          {gate.armed ? t("sharedAccess.armed") : t("sharedAccess.disarmed")}
        </span>
        {!gate.armed && (
          <span className="text-[12.5px] text-error">{t("sharedAccess.disarmedShort")}</span>
        )}
        <span className="flex-1" />
        <button type="button" className={`${btnPrimary} inline-flex items-center gap-1`} onClick={onCreate}>
          <Plus size={14} strokeWidth={1.5} />
          {t("sharedAccess.create")}
        </button>
      </div>
      {error && <Refusal>{error}</Refusal>}
    </div>
  );
}
