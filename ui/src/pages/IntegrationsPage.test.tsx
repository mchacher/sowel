import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../test-utils";
import i18n from "../i18n";
import { IntegrationsPage } from "./IntegrationsPage";
import * as api from "../api";
import type { IntegrationInfo } from "../types";

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  getIntegrations: vi.fn(),
}));

const tesla = {
  id: "tesla",
  name: "Tesla",
  description: "",
  icon: "Car",
  status: "connected",
  configured: true,
  settings: [],
  settingValues: {},
  deviceCount: 1,
  offlineDeviceCount: 0,
  supportsOAuth: true,
} as IntegrationInfo;

/** Spec 212 — the OAuth success banner names the plugin the callback came from. */
describe("IntegrationsPage OAuth banner", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.mocked(api.getIntegrations).mockResolvedValue([tesla]);
  });

  it("names the plugin given by the callback", async () => {
    window.history.replaceState({}, "", "/settings/integrations?oauth_success=1&plugin=tesla");
    render(<IntegrationsPage />);
    expect(await screen.findByText("Tesla account connected.")).toBeTruthy();
    expect(screen.queryByText(/Samsung/)).toBeNull();
  });

  it("falls back to a generic message without a plugin", async () => {
    window.history.replaceState({}, "", "/settings/integrations?oauth_success=1");
    render(<IntegrationsPage />);
    expect(await screen.findByText("Account connected.")).toBeTruthy();
  });
});
