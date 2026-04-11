import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { DatabaseBackup, Download, Upload, Loader2, RotateCcw, HardDrive } from "lucide-react";
import {
  exportBackup,
  importBackup,
  listLocalBackups,
  restoreLocalBackup,
} from "../api";
import type { LocalBackup } from "../api";

export function BackupPage() {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [localBackups, setLocalBackups] = useState<LocalBackup[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [restoringLocal, setRestoringLocal] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<LocalBackup | null>(null);

  const loadLocalBackups = useCallback(async () => {
    setLoadingLocal(true);
    try {
      const data = await listLocalBackups();
      setLocalBackups(data.backups);
    } catch {
      // ignore — section just stays empty
    } finally {
      setLoadingLocal(false);
    }
  }, []);

  useEffect(() => {
    loadLocalBackups();
  }, [loadLocalBackups]);

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
      a.download = `sowel-backup-${dateStr}.zip`;
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
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRestoreLocal = async (backup: LocalBackup) => {
    setError("");
    setSuccess("");
    setRestoringLocal(backup.filename);
    try {
      await restoreLocalBackup(backup.filename);
      setSuccess(t("backup.restored"));
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setRestoringLocal(null);
      setConfirmRestore(null);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const formatDate = (iso: string): string => {
    return new Date(iso).toLocaleString();
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
        <p className="text-[13px] text-text-tertiary mt-1">{t("backup.description")}</p>
      </div>

      <div className="max-w-xl space-y-6">
        {/* Manual export / import */}
        <section className="bg-surface rounded-[10px] border border-border p-5">
          <h2 className="text-[14px] font-semibold text-text mb-4">{t("backup.title")}</h2>

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
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("backup.export")}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {t("backup.import")}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </section>

        {/* Local backups (auto-created before updates) */}
        <section className="bg-surface rounded-[10px] border border-border p-5">
          <div className="flex items-center gap-2 mb-1">
            <HardDrive size={16} className="text-text-secondary" />
            <h2 className="text-[14px] font-semibold text-text">{t("backup.localTitle")}</h2>
          </div>
          <p className="text-[12px] text-text-tertiary mb-4">{t("backup.localDescription")}</p>

          {loadingLocal ? (
            <div className="py-4 text-center">
              <Loader2 size={18} className="animate-spin mx-auto text-text-tertiary" />
            </div>
          ) : localBackups.length === 0 ? (
            <p className="text-[13px] text-text-tertiary py-3 text-center">
              {t("backup.localEmpty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {localBackups.map((backup) => (
                <li
                  key={backup.filename}
                  className="flex items-center justify-between gap-3 p-3 bg-background rounded-[6px] border border-border"
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-[13px] font-mono text-text truncate"
                      title={backup.filename}
                    >
                      {backup.filename}
                    </div>
                    <div className="text-[11px] text-text-tertiary mt-0.5">
                      {formatDate(backup.createdAt)} • {formatSize(backup.size)}
                    </div>
                  </div>
                  <button
                    onClick={() => setConfirmRestore(backup)}
                    disabled={restoringLocal !== null}
                    className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium text-accent border border-accent/30 rounded-[6px] hover:bg-accent/10 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
                  >
                    {restoringLocal === backup.filename ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    {t("backup.restore")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Confirm restore modal */}
      {confirmRestore && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => restoringLocal === null && setConfirmRestore(null)}
        >
          <div
            className="bg-surface rounded-[14px] border border-border p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-semibold text-text mb-2">
              {t("backup.confirmRestoreTitle")}
            </h3>
            <p className="text-[13px] text-text-secondary mb-4">
              {t("backup.confirmRestoreMessage", { filename: confirmRestore.filename })}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmRestore(null)}
                disabled={restoringLocal !== null}
                className="px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => handleRestoreLocal(confirmRestore)}
                disabled={restoringLocal !== null}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-accent text-white rounded-[6px] hover:bg-accent-hover transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                {restoringLocal !== null && <Loader2 size={14} className="animate-spin" />}
                {t("backup.restore")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
