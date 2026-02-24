import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ScrollText,
  Play,
  Pause,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { fetchLogs, setLogLevel } from "../api";
import { useAuth } from "../store/useAuth";
import type { LogEntry, LogLevel } from "../types";

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];

const LEVEL_COLORS: Record<string, string> = {
  fatal: "text-error font-semibold",
  error: "text-error",
  warn: "text-accent",
  info: "text-text-secondary",
  debug: "text-text-tertiary",
  trace: "text-text-tertiary",
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  } catch {
    return iso;
  }
}

function formatLevel(level: string): string {
  return level.toUpperCase().padEnd(5);
}

export function LogsPage() {
  const { t } = useTranslation();
  const accessToken = useAuth((s) => s.accessToken);
  const isAuthenticated = useAuth((s) => s.isAuthenticated);

  // State
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [currentLevel, setCurrentLevel] = useState<string>("info");
  const [live, setLive] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>("");
  const [filterModule, setFilterModule] = useState<string>("");
  const [filterSearch, setFilterSearch] = useState<string>("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  // Auto-scroll to top when live and new entries arrive
  useEffect(() => {
    if (live && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries, live]);

  // Fetch initial entries
  useEffect(() => {
    fetchLogs({ limit: 500 })
      .then((res) => {
        setEntries(res.entries.reverse());
        setModules(res.modules);
        setCurrentLevel(res.currentLevel);
      })
      .catch(() => {
        // Ignore fetch errors
      });
  }, []);

  // WebSocket connection for live logs (wait for session to be verified)
  useEffect(() => {
    if (!accessToken || !isAuthenticated) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // In dev mode, connect directly to backend to avoid Vite proxy EPIPE issues
    const wsHost = import.meta.env.DEV ? `${window.location.hostname}:3000` : window.location.host;
    const ws = new WebSocket(`${protocol}//${wsHost}/ws?token=${encodeURIComponent(accessToken)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", topics: ["logs"] }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Log entries come as { type: "log.entry", level, time, msg, ... }
        if (data.type === "log.entry") {
          if (!liveRef.current) return;
          const entry: LogEntry = data;
          setEntries((prev) => {
            const next = [entry, ...prev];
            // Keep most recent 2000 entries in UI
            return next.length > 2000 ? next.slice(0, 2000) : next;
          });
          if (entry.module) {
            setModules((prev) =>
              prev.includes(entry.module!) ? prev : [...prev, entry.module!].sort(),
            );
          }
        }
      } catch {
        // Ignore non-JSON
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [accessToken, isAuthenticated]);

  // Filter entries client-side
  const filtered = entries.filter((e) => {
    if (filterLevel && e.level !== filterLevel) return false;
    if (filterModule && e.module !== filterModule) return false;
    if (filterSearch && !e.msg.toLowerCase().includes(filterSearch.toLowerCase()))
      return false;
    return true;
  });

  const handleClear = useCallback(() => {
    setEntries([]);
    setExpandedIdx(null);
  }, []);

  const handleLevelChange = useCallback(
    async (newLevel: LogLevel) => {
      try {
        await setLogLevel(newLevel);
        setCurrentLevel(newLevel);
      } catch {
        // Ignore errors
      }
    },
    [],
  );

  const toggleExpand = useCallback((idx: number) => {
    setExpandedIdx((prev) => (prev === idx ? null : idx));
  }, []);

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2.5 mb-1">
          <ScrollText size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("logs.title")}
          </h1>
        </div>
        <p className="text-[13px] text-text-tertiary">{t("logs.subtitle")}</p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {/* Level filter */}
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
        >
          <option value="">{t("logs.allLevels")}</option>
          {LOG_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>

        {/* Module filter */}
        <select
          value={filterModule}
          onChange={(e) => setFilterModule(e.target.value)}
          className="px-3 py-1.5 text-[13px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
        >
          <option value="">{t("logs.allModules")}</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {/* Text search */}
        <input
          type="text"
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          placeholder={t("logs.search")}
          className="px-3 py-1.5 text-[13px] bg-background border border-border rounded-[6px] text-text placeholder:text-text-tertiary focus:outline-none focus:border-primary w-48"
        />

        <div className="flex-1" />

        {/* Entry count */}
        <span className="text-[12px] text-text-tertiary">
          {t("logs.entries", { count: filtered.length })}
        </span>

        {/* Engine level control */}
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-text-tertiary">{t("logs.engineLevel")}:</span>
          <select
            value={currentLevel}
            onChange={(e) => handleLevelChange(e.target.value as LogLevel)}
            className="px-2 py-1 text-[12px] bg-background border border-border rounded-[6px] text-text focus:outline-none focus:border-primary"
          >
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {/* Live / Pause toggle */}
        <button
          onClick={() => setLive(!live)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-[6px] border transition-colors cursor-pointer ${
            live
              ? "bg-success/10 text-success border-success/30"
              : "bg-accent/10 text-accent border-accent/30"
          }`}
        >
          {live ? <Play size={14} /> : <Pause size={14} />}
          {live ? t("logs.live") : t("logs.paused")}
        </button>

        {/* Clear */}
        <button
          onClick={handleClear}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors cursor-pointer"
        >
          <Trash2 size={14} />
          {t("logs.clear")}
        </button>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto bg-background border border-border rounded-[10px] font-mono text-[12px] leading-[18px]"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary text-[13px]">
            {t("logs.noEntries")}
          </div>
        ) : (
          <div className="p-2">
            {filtered.map((entry, idx) => {
              const isExpanded = expandedIdx === idx;
              const levelClass = LEVEL_COLORS[entry.level] ?? "text-text-secondary";
              // Build extra context keys (exclude standard fields)
              const extraKeys = Object.keys(entry).filter(
                (k) => !["level", "time", "module", "msg", "type", "pid", "hostname"].includes(k),
              );

              return (
                <div key={idx}>
                  <div
                    className={`flex items-start gap-2 px-2 py-0.5 rounded hover:bg-border-light/50 cursor-pointer ${levelClass}`}
                    onClick={() => extraKeys.length > 0 && toggleExpand(idx)}
                  >
                    {extraKeys.length > 0 ? (
                      isExpanded ? (
                        <ChevronDown size={12} className="mt-[3px] flex-shrink-0 opacity-50" />
                      ) : (
                        <ChevronRight size={12} className="mt-[3px] flex-shrink-0 opacity-50" />
                      )
                    ) : (
                      <span className="w-3 flex-shrink-0" />
                    )}
                    <span className="text-text-tertiary flex-shrink-0">
                      {formatTime(entry.time)}
                    </span>
                    <span className={`flex-shrink-0 w-[44px] ${levelClass}`}>
                      {formatLevel(entry.level)}
                    </span>
                    <span className="text-primary/70 flex-shrink-0 w-[140px] truncate">
                      {entry.module ?? ""}
                    </span>
                    <span className="text-text break-all">{entry.msg}</span>
                  </div>
                  {isExpanded && extraKeys.length > 0 && (
                    <div className="ml-[22px] pl-4 py-1 mb-1 border-l border-border-light text-[11px] text-text-tertiary">
                      {extraKeys.map((k) => (
                        <div key={k}>
                          <span className="text-text-secondary">{k}</span>:{" "}
                          {typeof entry[k] === "object"
                            ? JSON.stringify(entry[k])
                            : String(entry[k])}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
