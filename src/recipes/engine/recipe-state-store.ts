import type Database from "better-sqlite3";

// ============================================================
// RecipeStateStore — key-value persistence per recipe instance
// ============================================================

export class RecipeStateStore {
  private stmts: ReturnType<typeof this.prepareStatements>;
  private dirty = false;

  constructor(
    private db: Database.Database,
    private instanceId: string,
    private onChanged?: () => void,
  ) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      get: this.db.prepare("SELECT value FROM recipe_state WHERE instance_id = ? AND key = ?"),
      set: this.db.prepare(
        `INSERT INTO recipe_state (instance_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(instance_id, key) DO UPDATE SET value = excluded.value`,
      ),
      delete: this.db.prepare("DELETE FROM recipe_state WHERE instance_id = ? AND key = ?"),
      clear: this.db.prepare("DELETE FROM recipe_state WHERE instance_id = ?"),
    };
  }

  private scheduleNotify(): void {
    if (!this.onChanged || this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      this.onChanged!();
    });
  }

  get(key: string): unknown | null {
    const row = this.stmts.get.get(this.instanceId, key) as { value: string | null } | undefined;
    if (!row || row.value === null) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  set(key: string, value: unknown): void {
    const serialized = value === undefined ? null : JSON.stringify(value);
    this.stmts.set.run(this.instanceId, key, serialized);
    this.scheduleNotify();
  }

  delete(key: string): void {
    this.stmts.delete.run(this.instanceId, key);
    this.scheduleNotify();
  }

  clear(): void {
    this.stmts.clear.run(this.instanceId);
    this.scheduleNotify();
  }
}
