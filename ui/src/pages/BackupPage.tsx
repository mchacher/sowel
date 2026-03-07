import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DatabaseBackup, Download, Upload, Loader2 } from "lucide-react";
import { exportBackup, importBackup } from "../api";

export function BackupPage() {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setError("");
    setSuccess("");
    setExporting(true);
    try {
      const resp = await exportBackup();
      const url = URL.createObjectURL(resp.blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `sowel-backup-${dateStr}.${resp.isZip ? "zip" : "json"}`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(t("backup.exported"));
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setSuccess("");
    setImporting(true);
    try {
      await importBackup(file);
      setSuccess(t("backup.imported"));
      // Reload the page after a short delay to let the user see the success message
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <DatabaseBackup size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("backup.title")}
          </h1>
        </div>
        <p className="text-[13px] text-text-tertiary mt-1">
          {t("backup.description")}
        </p>
      </div>

      {/* Backup card */}
      <div className="max-w-xl">
        <section className="bg-surface rounded-[10px] border border-border p-5">
          <h2 className="text-[14px] font-semibold text-text mb-4">
            {t("backup.title")}
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-[6px]">
              <p className="text-[13px] text-error">{error}</p>
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-success/10 border border-success/30 rounded-[6px]">
              <p className="text-[13px] text-success">{success}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
            >
              {exporting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {t("backup.export")}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
            >
              {importing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {t("backup.import")}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.zip"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
