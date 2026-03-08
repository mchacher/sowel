import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, RefreshCw } from "lucide-react";
import { createMyToken } from "../../api";

type Expiry = "7d" | "30d" | "never";

function expiryToDate(expiry: Expiry): string | undefined {
  if (expiry === "never") return undefined;
  const days = expiry === "7d" ? 7 : 30;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function MobileSection() {
  const { t } = useTranslation();
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<Expiry>("30d");
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const name = `Mobile - ${new Date().toLocaleDateString()}`;
      const result = await createMyToken(name, expiryToDate(expiry));
      const url = `${window.location.origin}/qr-login?token=${encodeURIComponent(result.token)}`;
      setQrUrl(url);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-[10px] p-5">
      <div className="flex items-center gap-2 mb-1">
        <Smartphone size={16} strokeWidth={1.5} className="text-text-secondary" />
        <h2 className="text-[15px] font-semibold text-text">{t("settings.mobile")}</h2>
      </div>
      <p className="text-[12px] text-text-secondary mb-4">{t("settings.mobileDescription")}</p>

      {/* Expiry selector */}
      <div className="mb-4">
        <label className="text-[12px] font-medium text-text-secondary mb-1 block">
          {t("settings.qrExpiry")}
        </label>
        <select
          value={expiry}
          onChange={(e) => setExpiry(e.target.value as Expiry)}
          className="text-[13px] text-text bg-background border border-border rounded-[6px] px-3 py-1.5 w-full"
        >
          <option value="7d">{t("settings.qrExpiry7d")}</option>
          <option value="30d">{t("settings.qrExpiry30d")}</option>
          <option value="never">{t("settings.qrExpiryNever")}</option>
        </select>
      </div>

      {/* Generate / Regenerate button */}
      <button
        onClick={generate}
        disabled={generating}
        className="flex items-center gap-2 text-[13px] font-medium text-white bg-primary hover:bg-primary-hover disabled:opacity-50 px-4 py-2 rounded-[6px] transition-colors cursor-pointer mb-4"
      >
        {qrUrl ? (
          <>
            <RefreshCw size={14} strokeWidth={1.5} className={generating ? "animate-spin" : ""} />
            {t("settings.regenerateQr")}
          </>
        ) : (
          t("settings.generateQr")
        )}
      </button>

      {/* QR Code display */}
      {qrUrl && (
        <div className="flex flex-col items-center gap-4">
          <div className="bg-white p-4 rounded-[10px]">
            <QRCodeSVG value={qrUrl} size={200} />
          </div>
          <p className="text-[11px] text-text-tertiary text-center whitespace-pre-line">
            {t("settings.qrInstructions")}
          </p>
        </div>
      )}
    </div>
  );
}
