import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "../../test-utils";
import i18n from "../../i18n";
import { UpdateAllBanner } from "./UpdateAllBanner";
import * as api from "../../api";
import type { PluginInfo, PackageSource } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  updatePlugin: vi.fn().mockResolvedValue({ success: true }),
}));

// Issue #749 — the old row layout had nowhere to express a bulk update.

function plugin(
  id: string,
  latestVersion?: string,
  source: PackageSource = "registry",
): PluginInfo {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      description: "",
      icon: "Cpu",
      type: "integration",
    },
    enabled: true,
    installedAt: "2026-01-01T00:00:00.000Z",
    status: "connected",
    deviceCount: 0,
    offlineDeviceCount: 0,
    latestVersion,
    source,
  };
}

describe("UpdateAllBanner (#749)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void i18n.changeLanguage("en");
  });

  // The bulk-update tests drive the clock themselves: the component waits
  // 1.5s for the restarted plugins before refreshing, and `waitFor` and
  // `userEvent` both poll on real timers, so they deadlock under fake ones.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays hidden when nothing is pending", () => {
    const { container } = render(
      <UpdateAllBanner plugins={[plugin("a"), plugin("b")]} lang="en" onRefresh={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("stays hidden for a single pending update, which the row already offers", () => {
    const { container } = render(
      <UpdateAllBanner
        plugins={[plugin("a", "2.0.0"), plugin("b")]}
        lang="en"
        onRefresh={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("counts and names the pending packages", () => {
    render(
      <UpdateAllBanner
        plugins={[plugin("zigbee2mqtt", "2.0.0"), plugin("netatmo", "1.4.0"), plugin("mcz")]}
        lang="en"
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByText("2 plugin updates available")).toBeTruthy();
    expect(screen.getByText("zigbee2mqtt, netatmo")).toBeTruthy();
  });

  it("excludes personal sources, whose fingerprint must be confirmed one by one (spec 136)", () => {
    const { container } = render(
      <UpdateAllBanner
        plugins={[plugin("a", "2.0.0"), plugin("mine", "0.3.0", "personal")]}
        lang="en"
        onRefresh={() => {}}
      />,
    );
    // Only one batchable update left, so the banner does not appear at all.
    expect(container.firstChild).toBeNull();
  });

  it("updates every pending package, then refreshes", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    render(
      <UpdateAllBanner
        plugins={[plugin("a", "2.0.0"), plugin("b", "3.0.0"), plugin("mine", "0.3.0", "personal")]}
        lang="en"
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update all" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(api.updatePlugin).toHaveBeenCalledTimes(2);
    expect(api.updatePlugin).toHaveBeenCalledWith("a");
    expect(api.updatePlugin).toHaveBeenCalledWith("b");
    expect(api.updatePlugin).not.toHaveBeenCalledWith("mine");
    expect(onRefresh).toHaveBeenCalled();
  });

  it("keeps going when one package fails", async () => {
    vi.useFakeTimers();
    vi.mocked(api.updatePlugin)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ success: true });
    const onRefresh = vi.fn();

    render(
      <UpdateAllBanner
        plugins={[plugin("a", "2.0.0"), plugin("b", "3.0.0")]}
        lang="en"
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Update all" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(api.updatePlugin).toHaveBeenCalledWith("b");
    expect(onRefresh).toHaveBeenCalled();
  });
});
