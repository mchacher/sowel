import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Smartphone } from "lucide-react";
import {
  getSharedAccessApp,
  updateSharedAccessApp,
  type SharedAccessAppView,
} from "../../api/sharedAccess";
import { Refusal, btnPrimary, btnSecondary, inputCls, labelCls } from "../shared-access/ui";

const SIZES = [180, 192, 512] as const;
type Icons = Record<"180" | "192" | "512", string>;

/** Crops the image to its centred square and draws it at each size the phones ask for. */
async function resizeToIcons(file: File): Promise<{ icons: Icons; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("unreadable"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("unreadable");
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const icons = {} as Icons;
    let preview = "";
    for (const size of SIZES) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("unreadable");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      const dataUrl = canvas.toDataURL("image/png");
      icons[String(size) as keyof Icons] = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (size === 192) preview = dataUrl;
    }
    return { icons, preview };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Spec 181 R5.24 — the name and the icon the visitors' page takes on a phone's
 * home screen. The image is resized here, in the browser: the backend only
 * checks it receives a PNG of each size.
 */
export function SharedAccessAppSettings() {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<SharedAccessAppView | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<{ icons: Icons | null; preview: string | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSharedAccessApp()
      .then((v) => {
        setView(v);
        setName(v.name);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (!view) return error ? <Refusal>{error}</Refusal> : null;

  const dirty = name.trim() !== view.name || pending !== null;
  const preview = pending?.preview ?? `/access/icon-192.png?v=${view.version}`;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSaved(false);
    try {
      const { icons, preview: p } = await resizeToIcons(file);
      setPending({ icons, preview: p });
    } catch {
      setError(t("sharedAccess.app.iconUnreadable"));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await updateSharedAccessApp({
        name: name.trim(),
        ...(pending ? { icons: pending.icons } : {}),
      });
      setView(next);
      setName(next.name);
      setPending(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const showsCustom = pending ? pending.icons !== null : view.customIcon;

  return (
    <div className="border-t border-border pt-4 mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone size={14} strokeWidth={1.5} className="text-text-tertiary" />
        <h3 className="text-[13px] font-semibold text-text">{t("sharedAccess.app.title")}</h3>
      </div>
      <p className="text-[12px] text-text-tertiary">{t("sharedAccess.app.description")}</p>
      <div>
        <label className={labelCls} htmlFor="sa-app-name">
          {t("sharedAccess.app.name")}
        </label>
        <input
          id="sa-app-name"
          className={`${inputCls} w-full`}
          value={name}
          maxLength={30}
          placeholder={t("sharedAccess.app.namePlaceholder")}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <div>
        <span className={labelCls}>{t("sharedAccess.app.icon")}</span>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {showsCustom ? (
            <img
              src={preview}
              alt={t("sharedAccess.app.icon")}
              className="w-16 h-16 rounded-[14px] border border-border object-cover shrink-0"
            />
          ) : (
            // The page's own mark, as the backend draws it.
            <div
              role="img"
              aria-label={t("sharedAccess.app.iconDefault")}
              className="w-16 h-16 rounded-[14px] bg-[#0a0705] grid place-items-center shrink-0"
            >
              <span className="w-[56%] h-[56%] rounded-full bg-[#e8963c]" />
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" className={btnSecondary} onClick={() => fileRef.current?.click()}>
              {t("sharedAccess.app.iconChoose")}
            </button>
            {showsCustom && (
              <button
                type="button"
                className={btnSecondary}
                onClick={() => {
                  setPending({ icons: null, preview: null });
                  setSaved(false);
                }}
              >
                {t("sharedAccess.app.iconReset")}
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            data-testid="sa-app-icon-file"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </div>
        <p className="text-[11px] text-text-tertiary mt-1">{t("sharedAccess.app.iconHelp")}</p>
      </div>
      {dirty && (
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
      )}
      {saved && !dirty && (
        <p className="text-[12px] text-text-secondary">{t("sharedAccess.app.saved")}</p>
      )}
      {error && <Refusal>{error}</Refusal>}
    </div>
  );
}
