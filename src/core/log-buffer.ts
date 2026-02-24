import type { LogEntry } from "../shared/types.js";

const LEVEL_ORDER: Record<string, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

export class LogRingBuffer {
  private buffer: (LogEntry | undefined)[];
  private head = 0;
  private count = 0;
  private listeners = new Set<(entry: LogEntry) => void>();
  private modules = new Set<string>();

  constructor(private capacity: number = 2000) {
    this.buffer = new Array(capacity);
  }

  push(entry: LogEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;

    if (entry.module) this.modules.add(entry.module);

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Never let a listener error break the logger
      }
    }
  }

  query(options?: {
    limit?: number;
    level?: string;
    module?: string;
    search?: string;
    since?: string;
  }): LogEntry[] {
    const { limit = 100, level, module, search, since } = options ?? {};
    const minLevel = level ? (LEVEL_ORDER[level] ?? 0) : 0;
    const sinceTime = since ? new Date(since).getTime() : 0;

    // Walk from oldest to newest, collect matching entries
    const result: LogEntry[] = [];
    const start = (this.head - this.count + this.capacity) % this.capacity;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const entry = this.buffer[idx];
      if (!entry) continue;

      if (minLevel > 0 && (LEVEL_ORDER[entry.level] ?? 0) < minLevel) continue;
      if (module && entry.module !== module) continue;
      if (search && !entry.msg.toLowerCase().includes(search.toLowerCase())) continue;
      if (sinceTime && new Date(entry.time).getTime() < sinceTime) continue;

      result.push(entry);
    }

    // Return the last `limit` entries (most recent)
    return result.slice(-limit);
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getModules(): string[] {
    return [...this.modules].sort();
  }

  getCount(): number {
    return this.count;
  }

  getCapacity(): number {
    return this.capacity;
  }
}
