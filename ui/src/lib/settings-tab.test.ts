import { describe, it, expect } from "vitest";
import { initialSettingsTab, revealScrollLeft } from "./settings-tab";

describe("initialSettingsTab", () => {
  it("lands an admin on the tab the link names", () => {
    expect(initialSettingsTab("energy", true)).toBe("energy");
    expect(initialSettingsTab("solar", true)).toBe("solar");
    expect(initialSettingsTab("admin", true)).toBe("admin");
    expect(initialSettingsTab("account", true)).toBe("account");
  });

  it("falls a non-admin back to account instead of an empty pane", () => {
    // Every tab but "account" is admin-only; landing there would render
    // nothing at all.
    expect(initialSettingsTab("energy", false)).toBe("account");
    expect(initialSettingsTab("solar", false)).toBe("account");
    expect(initialSettingsTab("general", false)).toBe("account");
    expect(initialSettingsTab("account", false)).toBe("account");
  });

  it("ignores an unknown or absent param", () => {
    expect(initialSettingsTab("nonsense", true)).toBe("general");
    expect(initialSettingsTab(null, true)).toBe("general");
    expect(initialSettingsTab(null, false)).toBe("account");
  });
});

describe("revealScrollLeft", () => {
  // A 390 px phone: bar 390 wide, 16 px side padding, five tabs past the edge.
  it("leaves the bar alone when the tab is already in view", () => {
    expect(revealScrollLeft(0, 390, 16, 70, 16)).toBeNull();
  });

  it("scrolls right just enough to show a tab past the edge, padding kept", () => {
    // « Administration » at 360..470: 470 + 16 - 390 = 96.
    expect(revealScrollLeft(0, 390, 360, 110, 16)).toBe(96);
  });

  it("scrolls back left to a tab hidden on the left, never below zero", () => {
    expect(revealScrollLeft(200, 390, 100, 70, 16)).toBe(84);
    expect(revealScrollLeft(200, 390, 10, 70, 16)).toBe(0);
  });
});
