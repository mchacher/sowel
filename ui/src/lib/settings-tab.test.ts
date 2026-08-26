import { describe, it, expect } from "vitest";
import { initialSettingsTab } from "./settings-tab";

describe("initialSettingsTab", () => {
  it("lands an admin on the tab the link names", () => {
    expect(initialSettingsTab("energy", true)).toBe("energy");
    expect(initialSettingsTab("admin", true)).toBe("admin");
    expect(initialSettingsTab("account", true)).toBe("account");
  });

  it("falls a non-admin back to account instead of an empty pane", () => {
    // Every tab but "account" is admin-only; landing there would render
    // nothing at all.
    expect(initialSettingsTab("energy", false)).toBe("account");
    expect(initialSettingsTab("general", false)).toBe("account");
    expect(initialSettingsTab("account", false)).toBe("account");
  });

  it("ignores an unknown or absent param", () => {
    expect(initialSettingsTab("nonsense", true)).toBe("general");
    expect(initialSettingsTab(null, true)).toBe("general");
    expect(initialSettingsTab(null, false)).toBe("account");
  });
});
