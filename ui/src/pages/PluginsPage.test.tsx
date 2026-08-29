import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "../test-utils";
import i18n from "../i18n";
import { PluginsPage } from "./PluginsPage";
import * as api from "../api";
import type { PluginInfo, PluginManifest } from "../types";

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  getPlugins: vi.fn(),
  getPluginStore: vi.fn().mockResolvedValue([]),
  getPluginSources: vi.fn().mockResolvedValue([]),
  refreshPluginStore: vi.fn().mockResolvedValue(undefined),
  updatePlugin: vi.fn().mockResolvedValue({ success: true }),
}));

/**
 * Issue #749 — on a 390px viewport the row laid out its badges and its six
 * controls before the name, whose `truncate` let it shrink to zero width, so
 * the plugin name vanished entirely.
 *
 * jsdom has no layout engine and cannot measure that collapse. What these tests
 * lock is the structural contract that removed it: the row carries identity
 * only, and everything that used to compete with the name for width now lives
 * in the detail sheet.
 */

function installed(over: Partial<PluginInfo> = {}, manifest: Partial<PluginManifest> = {}) {
  return {
    manifest: {
      id: "zigbee2mqtt",
      name: "Zigbee2MQTT",
      version: "2.4.0",
      description: "Zigbee to MQTT bridge.",
      icon: "Cpu",
      type: "integration",
      author: "mchacher",
      ...manifest,
    },
    enabled: true,
    installedAt: "2026-01-01T00:00:00.000Z",
    status: "connected",
    deviceCount: 42,
    offlineDeviceCount: 0,
    ...over,
  } as PluginInfo;
}

const recipe = (over: Partial<PluginInfo> = {}) =>
  installed(over, {
    id: "solar-water-heater",
    name: "Solar water heater",
    version: "0.1.2",
    type: "recipe",
    description:
      "Heats the water tank on the solar surplus through its dedicated contact, coordinated by the energy arbiter.",
  });

describe("PluginsPage (#749)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void i18n.changeLanguage("en");
    vi.mocked(api.getPluginStore).mockResolvedValue([]);
    vi.mocked(api.getPluginSources).mockResolvedValue([]);
  });

  it("keeps the name readable next to an available update", async () => {
    vi.mocked(api.getPlugins).mockResolvedValue([installed({ latestVersion: "2.5.0" })]);
    render(<PluginsPage />);

    // The name and the update marker coexist instead of competing for width.
    expect(await screen.findByText("Zigbee2MQTT")).toBeTruthy();
    expect(screen.getByText("2.5.0")).toBeTruthy();
  });

  it("keeps the installed version and the description out of the row", async () => {
    vi.mocked(api.getPlugins).mockResolvedValue([recipe()]);
    render(<PluginsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /Recipes/ }));

    expect(await screen.findByText("Solar water heater")).toBeTruthy();
    // The unclamped description was what made one card fill the whole screen.
    expect(screen.queryByText(/Heats the water tank/)).toBeNull();
  });

  it("opens the detail sheet from the row, uninstall included", async () => {
    vi.mocked(api.getPlugins).mockResolvedValue([installed()]);
    render(<PluginsPage />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Open details for Zigbee2MQTT" }),
    );

    const sheet = screen.getByRole("dialog", { name: "Zigbee2MQTT" });
    expect(sheet).toBeTruthy();
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeTruthy();
    expect(screen.getByText("Zigbee to MQTT bridge.")).toBeTruthy();
  });

  it("never puts uninstall next to the enable toggle in the list", async () => {
    vi.mocked(api.getPlugins).mockResolvedValue([installed()]);
    render(<PluginsPage />);

    await screen.findByText("Zigbee2MQTT");
    // Disable stays as a desktop shortcut; uninstall is reachable only from the
    // sheet, so a mis-tap on a phone cannot destroy an install.
    expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Uninstall" })).toBeNull();
  });

  it("marks a disabled plugin in the list", async () => {
    vi.mocked(api.getPlugins).mockResolvedValue([installed({ enabled: false })]);
    render(<PluginsPage />);
    expect(await screen.findByText("Disabled")).toBeTruthy();
  });

  it("offers a single bulk update when several packages are behind", async () => {
    vi.mocked(api.getPlugins).mockResolvedValue([
      installed({ latestVersion: "2.5.0" }),
      installed({ latestVersion: "1.4.0" }, { id: "netatmo", name: "Netatmo" }),
    ]);
    render(<PluginsPage />);

    expect(await screen.findByText("2 plugin updates available")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Update all" }));
    await waitFor(() => expect(api.updatePlugin).toHaveBeenCalledTimes(2));
  });
});
