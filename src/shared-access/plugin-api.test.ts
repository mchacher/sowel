import { describe, it, expect, afterEach } from "vitest";
import {
  buildSharedAccessHarness,
  type SharedAccessHarness,
} from "../test-helpers/shared-access.js";
import { createSharedAccessApi } from "./plugin-api.js";
import {
  NoEndError,
  ProfileIncompleteError,
  SETTING_ENABLED,
  SharedAccessDisabledError,
  UnknownProfileError,
} from "./shared-access-manager.js";

let h: SharedAccessHarness;

afterEach(() => h?.manager.stop());

/** A typical house: the default profile opens the entrance gate, 08:00–22:00, granted to guestFlow. */
function setup() {
  h = buildSharedAccessHarness();
  h.manager.ensureDefaultProfile();
  const def = h.manager.getState().profiles[0];
  h.manager.updateProfile(def.id, {
    pluginId: "guestflow",
    gates: [{ equipmentId: h.gates.entree }],
    timeWindows: [{ from: "08:00", to: "22:00" }],
  });
  return {
    def,
    guestflow: createSharedAccessApi(h.manager, "guestflow"),
    other: createSharedAccessApi(h.manager, "other-plugin"),
  };
}

const stay = { label: "Martin", from: "2026-10-03T16:00", until: "2026-10-07T11:00" };

describe("deps.sharedAccess (R9)", () => {
  it("makes a stay an access on the default profile, taking the profile's gates and hours", () => {
    const { guestflow } = setup();
    const inv = guestflow.upsert("stay-8841", stay);
    expect(inv.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(inv.invitationUrl).toMatch(/#i=/);
    const access = h.manager.getAccess(inv.id);
    expect(access.kind).toBe("external");
    expect(access.gates.map((g) => g.equipmentId)).toEqual([h.gates.entree]);
    expect(access.timeWindows).toEqual([{ from: "08:00", to: "22:00" }]);
    expect(access.validFrom).toBe(new Date(h.at(2026, 10, 3, 16)).toISOString());
    expect(access.validUntil).toBe(new Date(h.at(2026, 10, 7, 11)).toISOString());
  });

  it("is idempotent: a replayed upsert makes no new code and no duplicate", () => {
    const { guestflow } = setup();
    const first = guestflow.upsert("stay-8841", stay);
    const again = guestflow.upsert("stay-8841", stay);
    expect(again).toEqual(first);
    expect(h.manager.getState().accesses).toHaveLength(1);
  });

  it("keeps the owner's widening through a later update of the stay", () => {
    const { guestflow } = setup();
    const inv = guestflow.upsert("stay-8841", stay);
    h.manager.updateAccess(inv.id, { extendedUntil: "2026-10-07T15:00" }, "admin");
    guestflow.upsert("stay-8841", { ...stay, label: "Martin (2 pers.)" });
    const access = h.manager.getAccess(inv.id);
    expect(access.label).toBe("Martin (2 pers.)");
    expect(access.validUntil).toBe(new Date(h.at(2026, 10, 7, 15)).toISOString());
  });

  it("refuses a key without an end", () => {
    const { guestflow } = setup();
    expect(() =>
      guestflow.upsert("stay-1", { label: "X", from: "2026-10-03T16:00", until: "" }),
    ).toThrow(NoEndError);
    expect(h.manager.getState().accesses).toHaveLength(0);
  });

  it("refuses a profile not granted to it, and creates nothing", () => {
    const { guestflow, other } = setup();
    const artisans = h.manager.createProfile({
      name: "Artisans",
      gates: [{ equipmentId: h.gates.entree }],
    });
    expect(() => guestflow.upsert("stay-1", { ...stay, profileId: artisans.id })).toThrow(
      UnknownProfileError,
    );
    // The default profile is granted to guestflow, not to this one.
    expect(() => other.upsert("stay-1", stay)).toThrow(UnknownProfileError);
    expect(h.manager.getState().accesses).toHaveLength(0);
  });

  it("refuses while the profile lists no gate (profile_incomplete)", () => {
    const { guestflow, def } = setup();
    h.manager.updateProfile(def.id, { gates: [] });
    expect(() => guestflow.upsert("stay-1", stay)).toThrow(ProfileIncompleteError);
  });

  it("never lets a plugin see or touch another plugin's accesses or profiles", () => {
    const { guestflow, other } = setup();
    guestflow.upsert("stay-8841", stay);
    expect(other.list()).toEqual([]);
    expect(other.profiles()).toEqual([]);
    other.revoke("stay-8841");
    expect(guestflow.list()[0].state).not.toBe("revoked");
    expect(guestflow.profiles()).toEqual([
      expect.objectContaining({ name: "Par défaut", isDefault: true, complete: true }),
    ]);
  });

  it("gives a returning guest a new key, and the first one stops at its own end", async () => {
    const { guestflow } = setup();
    const first = guestflow.upsert("stay-8841", stay);
    const second = guestflow.upsert("stay-9033", {
      label: "Martin",
      from: "2026-10-20T16:00",
      until: "2026-10-22T11:00",
    });
    expect(second.code).not.toBe(first.code);
    expect(second.invitationUrl).not.toBe(first.invitationUrl);

    const phone = await h.manager.enrol({ code: first.code! }, "ua");
    if (!phone.ok) throw new Error("enrol");
    h.clock.now = h.at(2026, 10, 21, 10);
    // guestFlow is not involved: the core ends the first key on its own.
    expect(await h.manager.open(phone.token, h.gates.entree)).toMatchObject({ reason: "expired" });
  });

  it("revokes a cancelled stay", async () => {
    const { guestflow } = setup();
    const inv = guestflow.upsert("stay-8907", stay);
    const phone = await h.manager.enrol({ code: inv.code! }, "ua");
    if (!phone.ok) throw new Error("enrol");
    guestflow.revoke("stay-8907");
    h.clock.now = h.at(2026, 10, 4, 12);
    // A revoked access no longer knows its phones: the page asks for a code again.
    expect(await h.manager.open(phone.token, h.gates.entree)).toBeNull();
    expect(h.dispatches).toHaveLength(0);
  });

  it("answers `disabled` while the setting is off", () => {
    const { guestflow } = setup();
    h.settings.set(SETTING_ENABLED, "false");
    expect(() => guestflow.upsert("stay-1", stay)).toThrow(SharedAccessDisabledError);
    expect(() => guestflow.profiles()).toThrow(SharedAccessDisabledError);
  });

  // Review of 2026-09-27 — blocker: a stay the owner cut off must stay cut off.
  it("never brings back a stay the owner revoked and deleted: the replay answers revoked", () => {
    const { guestflow } = setup();
    const inv = guestflow.upsert("stay-8841", stay);
    h.manager.revoke(inv.id, "admin");
    expect(() => guestflow.upsert("stay-8841", stay)).toThrow(
      expect.objectContaining({ code: "revoked", statusCode: 409 }),
    );
    h.manager.deleteAccess(inv.id, "admin");
    expect(() => guestflow.upsert("stay-8841", stay)).toThrow(
      expect.objectContaining({ code: "revoked" }),
    );
    expect(h.manager.getState().accesses).toHaveLength(0);
    // Another stay of the same plugin is not affected.
    expect(guestflow.upsert("stay-9000", stay).code).not.toBeNull();
  });

  it("keeps an update on the access's own profile, even once the profile is taken back", () => {
    const { guestflow, def } = setup();
    const inv = guestflow.upsert("stay-8841", stay);
    h.manager.updateProfile(def.id, { pluginId: null });
    guestflow.upsert("stay-8841", { ...stay, label: "Martin (2 pers.)" });
    expect(h.manager.getAccess(inv.id).label).toBe("Martin (2 pers.)");
    expect(() => guestflow.upsert("stay-new", stay)).toThrow(
      expect.objectContaining({ code: "unknown_profile" }),
    );
  });

  it("drops a widening the stay has overtaken instead of locking the owner out", () => {
    const { guestflow } = setup();
    const inv = guestflow.upsert("stay-8841", stay);
    h.manager.updateAccess(inv.id, { extendedUntil: "2026-10-07T15:00" }, "admin");
    guestflow.upsert("stay-8841", { ...stay, until: "2026-10-07T18:00" });
    const renamed = h.manager.updateAccess(inv.id, { label: "Martin, famille" }, "admin");
    expect(renamed.label).toBe("Martin, famille");
    expect(renamed.validUntil).toBe(new Date(h.at(2026, 10, 7, 18)).toISOString());
    // A widening sent now is still checked.
    expect(() =>
      h.manager.updateAccess(inv.id, { extendedUntil: "2026-10-07T17:00" }, "admin"),
    ).toThrow(expect.objectContaining({ code: "shorten_refused" }));
  });
});
