import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { iconBtn } from "./ui";

/** A value with a copy button that says « Copié » for a moment. */
export function CopyButton({
  text,
  label,
  icon,
}: {
  text: string;
  label: string;
  icon?: ReactNode;
}) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={iconBtn}
      aria-label={label}
      title={done ? t("sharedAccess.copied") : label}
      onClick={async () => {
        if (await copyToClipboard(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? (
        <Check size={16} strokeWidth={1.5} className="text-success" />
      ) : (
        (icon ?? <Copy size={16} strokeWidth={1.5} />)
      )}
    </button>
  );
}

/** The invitation: the link (R5.18) and the code when the access has one (R3.8). */
export function Invitation({ link, code }: { link: string | null; code: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 border border-dashed border-border rounded-[10px] px-3 py-2.5 text-[13px]">
      <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest mb-1.5">
        {t("sharedAccess.invitation.title")}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-text-secondary shrink-0">{t("sharedAccess.invitation.link")}</span>
        {link ? (
          <>
            <code className="font-mono text-[12px] text-text break-all min-w-0">{link}</code>
            <CopyButton text={link} label={t("sharedAccess.actions.copyLink")} />
          </>
        ) : (
          <span className="text-warning">
            {t("sharedAccess.header.noPublicUrl")}{" "}
            <Link to="/settings?tab=general" className="text-primary hover:underline">
              {t("sharedAccess.header.setIt")}
            </Link>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-text-secondary">{t("sharedAccess.invitation.code")}</span>
        {code ? (
          <>
            <span className="font-mono font-semibold text-[17px] tracking-[0.08em] text-text">{code}</span>
            <CopyButton text={code} label={t("sharedAccess.actions.copyCode")} />
          </>
        ) : (
          <span className="text-text-tertiary">{t("sharedAccess.invitation.noCode")}</span>
        )}
      </div>
    </div>
  );
}
