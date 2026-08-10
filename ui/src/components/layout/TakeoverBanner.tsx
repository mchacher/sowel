// Issue #401 — Sticky banner shown when the server reports
// `takeoverPending === true`: the database was restored from another
// deployment and every outbound subsystem is inert. Admins get a
// confirm button that adopts the data and restarts the engine;
// other roles see the explanation only. Non-dismissable on purpose.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShadowMode } from "../../store/useShadowMode";
import { useAuth } from "../../store/useAuth";
import { confirmTakeover } from "../../api";

export function TakeoverBanner() {
  const { t } = useTranslation();
  const takeoverPending = useShadowMode((s) => s.takeoverPending);
  const role = useAuth((s) => s.user?.role);
  const [state, setState] = useState<"idle" | "confirming" | "restarting" | "error">("idle");

  if (!takeoverPending) return null;

  const onConfirm = async () => {
    setState("confirming");
    try {
      await confirmTakeover();
      setState("restarting");
      // The engine exits right after answering; give it time to come
      // back before reloading the app against the armed instance.
      setTimeout(() => window.location.reload(), 8000);
    } catch {
      setState("error");
    }
  };

  return (
    <div
      role="alert"
      className="bg-red-600 text-white text-[12px] sm:text-[13px] font-medium px-4 py-1.5 text-center sticky top-0 z-50 shadow-sm flex items-center justify-center gap-3 flex-wrap"
    >
      <span>{state === "restarting" ? t("takeover.restarting") : t("takeover.banner")}</span>
      {role === "admin" && state !== "restarting" && (
        <button
          onClick={onConfirm}
          disabled={state === "confirming"}
          className="bg-white text-red-700 rounded-md px-2.5 py-0.5 text-[12px] font-semibold hover:bg-red-50 disabled:opacity-60"
        >
          {state === "confirming" ? t("takeover.confirming") : t("takeover.confirm")}
        </button>
      )}
      {state === "error" && <span>{t("takeover.error")}</span>}
    </div>
  );
}
