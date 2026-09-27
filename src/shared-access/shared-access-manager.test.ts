import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildSharedAccessHarness,
  type SharedAccessHarness,
} from "../test-helpers/shared-access.js";
import { SETTING_ENABLED, SharedAccessDisabledError } from "./shared-access-manager.js";
import { deriveLinkToken } from "./codes.js";

let h: SharedAccessHarness;

afterEach(() => {
  h?.manager.stop();
  vi.useRealTimers();
});

/** Create, enrol one phone from the code, and return what the tests need. */
async function withPhone(input: Record<string, unknown> = {}) {
  const access = h.manager.createAccess(
    { label: "Plombier", gates: [{ equipmentId: h.gates.entree }], ...input },
    "admin",
  );
  const enrol = await h.manager.enrol({ code: access.code ?? "" }, "test-agent");
  if (!enrol.ok) throw new Error(`enrol failed: ${enrol.error}`);
  return { access, token: enrol.token };
}

describe("creating accesses (R2, R3)", () => {
  it("refuses an access with no gate, an unknown gate, and a non-gate equipment", () => {
    h = buildSharedAccessHarness();
    expect(() => h.manager.createAccess({ label: "X", gates: [] }, "admin")).toThrow(
      expect.objectContaining({ code: "no_gate" }),
    );
    expect(() =>
      h.manager.createAccess({ label: "X", gates: [{ equipmentId: "nope" }] }, "admin"),
    ).toThrow(expect.objectContaining({ code: "unknown_gate" }));
    expect(() =>
      h.manager.createAccess({ label: "X", gates: [{ equipmentId: h.gates.volet }] }, "admin"),
    ).toThrow(expect.objectContaining({ code: "unsupported_equipment" }));
  });

  it("stores which value opens a gate whose command has values, and nothing on an impulse gate", () => {
    h = buildSharedAccessHarness();
    const a = h.manager.createAccess(
      { label: "X", gates: [{ equipmentId: h.gates.entree }, { equipmentId: h.gates.garage }] },
      "admin",
    );
    expect(a.gates).toEqual([
      expect.objectContaining({ equipmentId: h.gates.entree, value: null }),
      expect.objectContaining({ equipmentId: h.gates.garage, value: "open" }),
    ]);
    expect(() =>
      h.manager.createAccess(
        { label: "X", gates: [{ equipmentId: h.gates.garage, value: "explode" }] },
        "admin",
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_value" }));
  });

  it("makes a code by default, and none when asked; the link is always there", () => {
    h = buildSharedAccessHarness();
    const withCode = h.manager.createAccess(
      { label: "A", gates: [{ equipmentId: h.gates.entree }] },
      "admin",
    );
    const linkOnly = h.manager.createAccess(
      { label: "B", gates: [{ equipmentId: h.gates.entree }], withCode: false },
      "admin",
    );
    expect(withCode.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(linkOnly.code).toBeNull();
    expect(linkOnly.invitationUrl).toMatch(/^https:\/\/acces\.example\.org\/access\/#i=[\w-]{22}$/);
  });

  it("refuses an end before the start", () => {
    h = buildSharedAccessHarness();
    expect(() =>
      h.manager.createAccess(
        {
          label: "X",
          gates: [{ equipmentId: h.gates.entree }],
          validFrom: "2026-10-10T12:00",
          validUntil: "2026-10-05T12:00",
        },
        "admin",
      ),
    ).toThrow(expect.objectContaining({ code: "end_before_start" }));
  });

  it("answers `disabled` to everything while the setting is off", async () => {
    h = buildSharedAccessHarness({ enabled: false });
    expect(() =>
      h.manager.createAccess({ label: "X", gates: [{ equipmentId: h.gates.entree }] }, "admin"),
    ).toThrow(SharedAccessDisabledError);
    await expect(h.manager.enrol({ code: "AAAA-AAAA" }, "ua")).rejects.toBeInstanceOf(
      SharedAccessDisabledError,
    );
  });
});

describe("changing, holding, deleting (R3.9, R3.11)", () => {
  it("changes the code and the link, keeping the phones or cutting them", async () => {
    h = buildSharedAccessHarness();
    const { access, token } = await withPhone();
    const kept = h.manager.changeCode(access.id, false, "admin");
    expect(kept.code).not.toBe(access.code);
    expect(kept.invitationUrl).not.toBe(access.invitationUrl);
    expect(h.manager.session(token)).not.toBeNull();
    expect((await h.manager.enrol({ code: access.code! }, "ua")).ok).toBe(false);

    h.manager.changeCode(access.id, true, "admin");
    expect(h.manager.session(token)).toBeNull();
  });

  it("refuses to delete a live access, deletes it once revoked, and the journal outlives it", () => {
    h = buildSharedAccessHarness();
    const a = h.manager.createAccess(
      { label: "Léa", gates: [{ equipmentId: h.gates.entree }] },
      "admin",
    );
    expect(() => h.manager.deleteAccess(a.id, "admin")).toThrow(
      expect.objectContaining({ code: "still_live" }),
    );
    h.manager.revoke(a.id, "admin");
    h.manager.deleteAccess(a.id, "admin");
    expect(h.manager.getState().accesses).toHaveLength(0);
    const kinds = h.manager.listJournal(a.id).map((e) => e.kind);
    expect(kinds).toEqual(["deleted", "revoked", "created"]);
  });

  it("widens an external access earlier and later, and refuses to shorten it", () => {
    h = buildSharedAccessHarness();
    h.manager.ensureDefaultProfile();
    const def = h.manager.getState().profiles[0];
    h.manager.updateProfile(def.id, {
      pluginId: "guestflow",
      gates: [{ equipmentId: h.gates.entree }],
    });
    const inv = h.manager.pluginUpsert("guestflow", "stay-1", {
      label: "Martin",
      from: "2026-10-03T16:00",
      until: "2026-10-07T11:00",
    });
    const widened = h.manager.updateAccess(
      inv.id,
      { earlyOpenAt: "2026-10-03T12:00", extendedUntil: "2026-10-07T14:00" },
      "admin",
    );
    expect(widened.validFrom).toBe(new Date(h.at(2026, 10, 3, 12)).toISOString());
    expect(widened.validUntil).toBe(new Date(h.at(2026, 10, 7, 14)).toISOString());
    expect(() =>
      h.manager.updateAccess(inv.id, { extendedUntil: "2026-10-06T11:00" }, "admin"),
    ).toThrow(expect.objectContaining({ code: "shorten_refused" }));
  });
});

describe("gates and their arming (R2.4, R2.6)", () => {
  it("disarming one gate of an access listing two leaves the other opening", async () => {
    h = buildSharedAccessHarness();
    const { token } = await withPhone({
      gates: [{ equipmentId: h.gates.entree }, { equipmentId: h.gates.garage }],
    });
    h.manager.setArmed(h.gates.garage, false, "admin");
    expect(await h.manager.open(token, h.gates.garage)).toMatchObject({
      ok: false,
      reason: "refused_by_house",
    });
    expect(await h.manager.open(token, h.gates.entree)).toEqual({ ok: true });
    expect(h.dispatches.map((d) => d.equipmentId)).toEqual([h.gates.entree]);
  });

  it("deleting the equipment removes it from every access and profile, and its arming row", () => {
    h = buildSharedAccessHarness();
    const a = h.manager.createAccess(
      { label: "X", gates: [{ equipmentId: h.gates.entree }, { equipmentId: h.gates.garage }] },
      "admin",
    );
    const p = h.manager.createProfile({ name: "P", gates: [{ equipmentId: h.gates.garage }] });
    h.manager.setArmed(h.gates.garage, false, "admin");
    h.equipments.delete(h.gates.garage);
    expect(h.manager.getAccess(a.id).gates.map((g) => g.equipmentId)).toEqual([h.gates.entree]);
    expect(h.manager.getProfile(p.id).gates).toEqual([]);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM shared_access_disarmed").get()).toEqual({
      n: 0,
    });
  });
});

describe("the default profile (R9.33)", () => {
  it("is created once on enablement, and cannot be deleted while others can", () => {
    h = buildSharedAccessHarness({ enabled: false });
    h.manager.start();
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM shared_access_profiles").get()).toEqual({
      n: 0,
    });
    h.settings.set(SETTING_ENABLED, "true");
    h.eventBus.emit({ type: "settings.changed", keys: [SETTING_ENABLED] });
    h.eventBus.emit({ type: "settings.changed", keys: [SETTING_ENABLED] });
    const profiles = h.manager.getState().profiles;
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ name: "Par défaut", isDefault: true, pluginId: null });
    // Two gates in the house: none is picked for the owner.
    expect(profiles[0].gates).toEqual([]);
    expect(() => h.manager.deleteProfile(profiles[0].id)).toThrow(
      expect.objectContaining({ code: "default_profile" }),
    );
    const other = h.manager.createProfile({ name: "Artisans" });
    h.manager.deleteProfile(other.id);
    expect(h.manager.getState().profiles).toHaveLength(1);
  });

  it("lists the house's gate when it has only one", () => {
    h = buildSharedAccessHarness();
    h.equipments.delete(h.gates.garage);
    h.manager.ensureDefaultProfile();
    expect(h.manager.getState().profiles[0].gates).toEqual([
      expect.objectContaining({ equipmentId: h.gates.entree, value: null }),
    ]);
  });
});

describe("guessing codes (R6)", () => {
  it("enrols a correct code after forty wrong ones, without delay", async () => {
    vi.useFakeTimers();
    h = buildSharedAccessHarness();
    const a = h.manager.createAccess(
      { label: "X", gates: [{ equipmentId: h.gates.entree }] },
      "admin",
    );
    const wrong: Promise<unknown>[] = [];
    for (let i = 0; i < 40; i++) wrong.push(h.manager.enrol({ code: "0000-0000" }, "ua"));
    let done = false;
    const right = h.manager.enrol({ code: a.code! }, "ua").then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect((await right).ok).toBe(true);
    h.manager.guessing.releaseAll();
    await Promise.all(wrong);
  });

  it("alerts the owner past 25 wrong codes, and counts a wrong link token as a failure", async () => {
    vi.useFakeTimers();
    h = buildSharedAccessHarness();
    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < 25; i++) pending.push(h.manager.enrol({ code: "0000-0000" }, "ua"));
    pending.push(h.manager.enrol({ link: "not-a-real-token-000000" }, "ua"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.manager.guessing.count()).toBe(26);
    const alarms = h.events.filter((e) => e.type === "system.alarm.raised");
    expect(alarms).toHaveLength(1);
    h.manager.guessing.releaseAll();
    await Promise.all(pending);
  });

  it("enrols from the link alone an access made without a code", async () => {
    h = buildSharedAccessHarness();
    const a = h.manager.createAccess(
      { label: "Voisin", gates: [{ equipmentId: h.gates.entree }], withCode: false },
      "admin",
    );
    const token = a.invitationUrl!.split("#i=")[1];
    const r = await h.manager.enrol({ link: token }, "ua");
    expect(r.ok).toBe(true);
  });

  it("answers `ended` to the right code of an ended access, without counting it", async () => {
    h = buildSharedAccessHarness();
    const a = h.manager.createAccess(
      {
        label: "X",
        gates: [{ equipmentId: h.gates.entree }],
        validFrom: "2026-10-01T00:00",
        validUntil: "2026-10-02T00:00",
      },
      "admin",
    );
    expect(await h.manager.enrol({ code: a.code! }, "ua")).toEqual({ ok: false, error: "ended" });
    expect(h.manager.guessing.count()).toBe(0);
  });
});

describe("pressing (R4)", () => {
  it("sends the gate's own command through executeOrder once, attributed to the access", async () => {
    h = buildSharedAccessHarness();
    const { access, token } = await withPhone({
      gates: [{ equipmentId: h.gates.entree }, { equipmentId: h.gates.garage }],
    });
    expect(await h.manager.open(token, h.gates.entree)).toEqual({ ok: true });
    expect(await h.manager.open(token, h.gates.garage)).toEqual({ ok: true });
    expect(h.dispatches).toEqual([
      {
        equipmentId: h.gates.entree,
        alias: "command",
        value: null,
        source: { kind: "shared_access", accessId: access.id, label: "Plombier" },
      },
      {
        equipmentId: h.gates.garage,
        alias: "command",
        value: "open",
        source: { kind: "shared_access", accessId: access.id, label: "Plombier" },
      },
    ]);
  });

  it("sends nothing and says why for a gate not listed, a suspended access, and past the ceiling", async () => {
    h = buildSharedAccessHarness();
    const { access, token } = await withPhone();
    expect(await h.manager.open(token, h.gates.garage)).toMatchObject({ reason: "not_this_gate" });
    h.manager.suspend(access.id, "admin");
    expect(await h.manager.open(token, h.gates.entree)).toMatchObject({ reason: "suspended" });
    h.manager.resume(access.id, "admin");
    for (let i = 0; i < 12; i++) {
      h.clock.now += 3000;
      expect(await h.manager.open(token, h.gates.entree)).toEqual({ ok: true });
    }
    h.clock.now += 3000;
    expect(await h.manager.open(token, h.gates.entree)).toMatchObject({ reason: "too_many_opens" });
    expect(h.dispatches).toHaveLength(12);
  });

  it("counts two presses within two seconds as one dispatch", async () => {
    h = buildSharedAccessHarness();
    const { token } = await withPhone();
    await h.manager.open(token, h.gates.entree);
    h.clock.now += 1500;
    expect(await h.manager.open(token, h.gates.entree)).toEqual({ ok: true, duplicate: true });
    expect(h.dispatches).toHaveLength(1);
  });

  it("answers gate_error and journals it when the gate's order fails", async () => {
    h = buildSharedAccessHarness();
    const { access, token } = await withPhone();
    h.setOutcome({ success: false, error: "device offline" });
    expect(await h.manager.open(token, h.gates.entree)).toMatchObject({ reason: "gate_error" });
    h.setOutcome({ success: true });
    h.setThrows(new Error("Integration not connected"));
    h.clock.now += 3000;
    expect(await h.manager.open(token, h.gates.entree)).toMatchObject({ reason: "gate_error" });
    const refused = h.manager.listJournal(access.id).filter((e) => e.kind === "refused");
    expect(refused.map((e) => e.reason)).toEqual(["gate_error", "gate_error"]);
  });

  it("never gives the phone the gate's state, and shows only this phone's presses", async () => {
    h = buildSharedAccessHarness();
    const { access, token } = await withPhone();
    const other = await h.manager.enrol({ code: access.code! }, "other-phone");
    if (!other.ok) throw new Error("second phone");
    await h.manager.open(token, h.gates.entree);
    const mine = h.manager.session(token)!;
    const theirs = h.manager.session(other.token)!;
    expect(mine.presses).toHaveLength(1);
    expect(theirs.presses).toHaveLength(0);
    const json = JSON.stringify(mine);
    expect(json).not.toMatch(/"(state|open|closed|gate_state)"/);
    expect(Object.keys(mine).sort()).toEqual(
      [
        "activeAt",
        "gates",
        "label",
        "nextOpeningAt",
        "presses",
        "status",
        "travelS",
        "validUntil",
      ].sort(),
    );
  });

  it("raises an alarm past six phones on one access, never a block", async () => {
    h = buildSharedAccessHarness();
    const { access } = await withPhone();
    for (let i = 0; i < 6; i++) {
      expect((await h.manager.enrol({ code: access.code! }, `phone-${i}`)).ok).toBe(true);
    }
    const alarms = h.events.filter(
      (e) => e.type === "system.alarm.raised" && e.alarmId.startsWith("shared-access:phones:"),
    );
    expect(alarms).toHaveLength(1);
  });
});

describe("housekeeping (R10)", () => {
  it("nulls a code seven days after its access ended, and keeps the journal a year", () => {
    h = buildSharedAccessHarness();
    const a = h.manager.createAccess(
      { label: "X", gates: [{ equipmentId: h.gates.entree }], validUntil: "2026-10-04T00:00" },
      "admin",
    );
    h.clock.now = h.at(2026, 10, 10, 0);
    h.manager.purge();
    expect(h.manager.getAccess(a.id).code).not.toBeNull();
    h.clock.now = h.at(2026, 10, 11, 1);
    h.manager.purge();
    expect(h.manager.getAccess(a.id).code).toBeNull();
    h.clock.now = h.at(2027, 10, 20, 0);
    h.manager.purge();
    expect(h.manager.listJournal(a.id)).toHaveLength(0);
  });
});

describe("the link token", () => {
  it("is derived from the house's secret, so the owner can copy it again", () => {
    h = buildSharedAccessHarness();
    const a = h.manager.createAccess(
      { label: "X", gates: [{ equipmentId: h.gates.entree }] },
      "admin",
    );
    const secret = h.settings.get("sharedAccess.linkSecret")!;
    expect(a.invitationUrl).toContain(`#i=${deriveLinkToken(secret, a.id, 1)}`);
    expect(h.manager.getAccess(a.id).invitationUrl).toBe(a.invitationUrl);
    const stored = h.db.prepare("SELECT link_token_hash FROM shared_accesses").get() as {
      link_token_hash: string;
    };
    expect(stored.link_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
