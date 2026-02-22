import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import type Database from "better-sqlite3";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { ModeManager } from "./mode-manager.js";
import type { Logger } from "../core/logger.js";
import { toISOUtc } from "../core/database.js";
import type { CalendarProfile, CalendarSlot } from "../shared/types.js";

const ACTIVE_PROFILE_KEY = "calendar.activeProfileId";
const DEFAULT_PROFILE_ID = "travail";

export class CalendarManager {
  private readonly log;
  private readonly stmts;
  private cronJobs: Cron[] = [];

  constructor(
    private readonly db: Database.Database,
    private readonly eventBus: EventBus,
    private readonly settingsManager: SettingsManager,
    private readonly modeManager: ModeManager,
    logger: Logger,
  ) {
    this.log = logger.child({ module: "calendar-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      listProfiles: this.db.prepare(`SELECT * FROM calendar_profiles ORDER BY built_in DESC, name`),
      getProfile: this.db.prepare(`SELECT * FROM calendar_profiles WHERE id = ?`),
      // Slots
      listSlots: this.db.prepare(`SELECT * FROM calendar_slots WHERE profile_id = ? ORDER BY time`),
      getSlot: this.db.prepare(`SELECT * FROM calendar_slots WHERE id = ?`),
      insertSlot: this.db.prepare(
        `INSERT INTO calendar_slots (id, profile_id, days, time, mode_ids) VALUES (?, ?, ?, ?, ?)`,
      ),
      updateSlot: this.db.prepare(
        `UPDATE calendar_slots SET days = ?, time = ?, mode_ids = ? WHERE id = ?`,
      ),
      deleteSlot: this.db.prepare(`DELETE FROM calendar_slots WHERE id = ?`),
    };
  }

  // ── Init ──────────────────────────────────────────────────

  init(): void {
    const profile = this.getActiveProfile();
    this.scheduleProfile(profile.id);
    this.log.info(
      { profileId: profile.id, profileName: profile.name },
      "Calendar initialized with active profile",
    );
  }

  // ── Profiles ──────────────────────────────────────────────

  listProfiles(): CalendarProfile[] {
    const rows = this.stmts.listProfiles.all() as CalendarProfileRow[];
    return rows.map(rowToProfile);
  }

  getActiveProfile(): CalendarProfile {
    const activeId = this.settingsManager.get(ACTIVE_PROFILE_KEY) ?? DEFAULT_PROFILE_ID;
    const row = this.stmts.getProfile.get(activeId) as CalendarProfileRow | undefined;
    if (row) return rowToProfile(row);

    // Fallback to default if stored profile was deleted
    const fallback = this.stmts.getProfile.get(DEFAULT_PROFILE_ID) as CalendarProfileRow;
    return rowToProfile(fallback);
  }

  setActiveProfile(profileId: string): void {
    const row = this.stmts.getProfile.get(profileId) as CalendarProfileRow | undefined;
    if (!row) throw new CalendarError(`Profile not found: ${profileId}`, 404);

    this.settingsManager.set(ACTIVE_PROFILE_KEY, profileId);
    this.scheduleProfile(profileId);

    const profile = rowToProfile(row);
    this.eventBus.emit({
      type: "calendar.profile.changed",
      profileId: profile.id,
      profileName: profile.name,
    });
    this.log.info({ profileId, profileName: profile.name }, "Active calendar profile changed");
  }

  // ── Slots ─────────────────────────────────────────────────

  listSlots(profileId: string): CalendarSlot[] {
    const rows = this.stmts.listSlots.all(profileId) as CalendarSlotRow[];
    return rows.map(rowToSlot);
  }

  addSlot(profileId: string, days: number[], time: string, modeIds: string[]): CalendarSlot {
    const row = this.stmts.getProfile.get(profileId) as CalendarProfileRow | undefined;
    if (!row) throw new CalendarError(`Profile not found: ${profileId}`, 404);

    const id = randomUUID();
    this.stmts.insertSlot.run(id, profileId, JSON.stringify(days), time, JSON.stringify(modeIds));

    this.log.info({ slotId: id, profileId, days, time, modeIds }, "Calendar slot added");

    // Reschedule if this is the active profile
    const activeProfile = this.getActiveProfile();
    if (activeProfile.id === profileId) {
      this.scheduleProfile(profileId);
    }

    return { id, profileId, days, time, modeIds };
  }

  updateSlot(
    slotId: string,
    updates: { days?: number[]; time?: string; modeIds?: string[] },
  ): CalendarSlot {
    const existing = this.stmts.getSlot.get(slotId) as CalendarSlotRow | undefined;
    if (!existing) throw new CalendarError(`Slot not found: ${slotId}`, 404);

    const days = updates.days ?? JSON.parse(existing.days);
    const time = updates.time ?? existing.time;
    const modeIds = updates.modeIds ?? JSON.parse(existing.mode_ids);

    this.stmts.updateSlot.run(JSON.stringify(days), time, JSON.stringify(modeIds), slotId);

    this.log.info({ slotId, days, time, modeIds }, "Calendar slot updated");

    // Reschedule if this is the active profile
    const activeProfile = this.getActiveProfile();
    if (activeProfile.id === existing.profile_id) {
      this.scheduleProfile(existing.profile_id);
    }

    return { id: slotId, profileId: existing.profile_id, days, time, modeIds };
  }

  removeSlot(slotId: string): void {
    const existing = this.stmts.getSlot.get(slotId) as CalendarSlotRow | undefined;
    if (!existing) throw new CalendarError(`Slot not found: ${slotId}`, 404);

    this.stmts.deleteSlot.run(slotId);
    this.log.info({ slotId }, "Calendar slot removed");

    // Reschedule if this is the active profile
    const activeProfile = this.getActiveProfile();
    if (activeProfile.id === existing.profile_id) {
      this.scheduleProfile(existing.profile_id);
    }
  }

  // ── Scheduling ────────────────────────────────────────────

  private scheduleProfile(profileId: string): void {
    // Stop all existing cron jobs
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.cronJobs = [];

    // Load slots for this profile
    const slots = this.listSlots(profileId);

    for (const slot of slots) {
      const cronExpr = buildCronExpression(slot.time, slot.days);
      try {
        const job = new Cron(cronExpr, () => {
          this.log.info(
            { slotId: slot.id, time: slot.time, modeIds: slot.modeIds },
            "Calendar slot fired",
          );
          for (const modeId of slot.modeIds) {
            try {
              this.modeManager.activateMode(modeId);
            } catch (err) {
              this.log.warn(
                { err, modeId, slotId: slot.id },
                "Failed to activate mode from calendar",
              );
            }
          }
        });
        this.cronJobs.push(job);
      } catch (err) {
        this.log.error({ err, slotId: slot.id, cronExpr }, "Failed to schedule calendar slot");
      }
    }

    this.log.info({ profileId, jobCount: this.cronJobs.length }, "Calendar cron jobs scheduled");
  }
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Build a cron expression from HH:MM time and day numbers.
 * days: 0=Sun, 1=Mon, ..., 6=Sat
 * Result: "MM HH * * d1,d2,..."
 */
function buildCronExpression(time: string, days: number[]): string {
  const [hours, minutes] = time.split(":").map(Number);
  const dayStr = days.join(",");
  return `${minutes} ${hours} * * ${dayStr}`;
}

// ── Row types & mappers ──────────────────────────────────────

interface CalendarProfileRow {
  id: string;
  name: string;
  built_in: number;
  created_at: string;
}

function rowToProfile(row: CalendarProfileRow): CalendarProfile {
  return {
    id: row.id,
    name: row.name,
    builtIn: row.built_in === 1,
    createdAt: toISOUtc(row.created_at),
  };
}

interface CalendarSlotRow {
  id: string;
  profile_id: string;
  days: string;
  time: string;
  mode_ids: string;
}

function rowToSlot(row: CalendarSlotRow): CalendarSlot {
  return {
    id: row.id,
    profileId: row.profile_id,
    days: JSON.parse(row.days) as number[],
    time: row.time,
    modeIds: JSON.parse(row.mode_ids) as string[],
  };
}

// ── Error ────────────────────────────────────────────────────

export class CalendarError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CalendarError";
  }
}
