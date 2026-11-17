import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { IntegrationDrawer } from "./IntegrationDrawer";
import * as api from "../../api";
import type { IntegrationInfo } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  getPluginOAuthUrl: vi.fn().mockResolvedValue({ url: "https://auth.example/authorize" }),
  startIntegration: vi.fn().mockResolvedValue(undefined),
  restartIntegration: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Spec 212 — seen on 2026-11-17 while setting up the Tesla plugin: the Connect
 * button said "Connect with Samsung", Start turned into "Fill required fields"
 * without naming the field, and Connect ignored unsaved edits.
 */
function tesla(over: Partial<IntegrationInfo> = {}): IntegrationInfo {
  return {
    id: "tesla",
    name: "Tesla",
    description: "Tesla through the official Fleet API",
    icon: "Car",
    status: "not_configured",
    configured: false,
    enabled: true,
    supportsOAuth: true,
    deviceCount: 0,
    offlineDeviceCount: 0,
    settings: [
      { key: "client_id", label: "Client ID", type: "text", required: true },
      { key: "domain", label: "Domain", type: "text", required: true },
      { key: "charger", label: "Charger", type: "text", required: false },
    ],
    settingValues: { client_id: "abc", domain: "", charger: "" },
    ...over,
  };
}

function open(integration: IntegrationInfo = tesla()) {
  const onRefresh = vi.fn();
  render(<IntegrationDrawer integration={integration} onClose={() => {}} onRefresh={onRefresh} />);
  return { onRefresh };
}

let assigned: string | null;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.mocked(api.updateSettings)
    .mockClear()
    .mockResolvedValue(undefined as never);
  vi.mocked(api.getPluginOAuthUrl).mockClear();
  assigned = null;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      assign: (v: string) => {
        assigned = v;
      },
    },
  });
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("IntegrationDrawer — Connect button (spec 212)", () => {
  it("names the plugin, not Samsung", () => {
    open(tesla({ settingValues: { client_id: "abc", domain: "d.example", charger: "" } }));
    expect(screen.getByRole("button", { name: "Connect to Tesla" })).toBeTruthy();
    expect(screen.queryByText(/Samsung/)).toBeNull();
  });

  it("keeps Start's name and names the missing field, which focuses it", async () => {
    open();
    const start = screen.getByRole("button", { name: "Start" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Fill required fields")).toBeNull();
    expect(screen.getByText("Missing:")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Domain" }));
    expect(document.activeElement).toBe(screen.getByLabelText(/^Domain/));
    // The optional empty field is never listed.
    expect(screen.queryByRole("button", { name: "Charger" })).toBeNull();
    expect(screen.getByText("Fill in first: Domain.")).toBeTruthy();
  });

  it("marks an empty required field only once left, never on open", async () => {
    open();
    const domain = screen.getByLabelText(/^Domain/);
    expect(domain.hasAttribute("aria-invalid")).toBe(false);
    expect(screen.queryByText("Required to start and connect.")).toBeNull();
    await userEvent.click(domain);
    await userEvent.tab();
    expect(domain.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(domain.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Required to start and connect.",
    );
    // The optional field, left empty, stays unmarked.
    await userEvent.click(screen.getByLabelText(/^Charger/));
    await userEvent.tab();
    expect(screen.getByLabelText(/^Charger/).hasAttribute("aria-invalid")).toBe(false);
  });

  it("marks every empty required field after a save", async () => {
    open();
    await userEvent.type(screen.getByLabelText(/^Charger/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByLabelText(/^Domain/).getAttribute("aria-invalid")).toBe("true"),
    );
  });

  it("keeps the marks when the list reloads the same integration after a save", async () => {
    const view = render(
      <IntegrationDrawer integration={tesla()} onClose={() => {}} onRefresh={() => {}} />,
    );
    await userEvent.type(screen.getByLabelText(/^Charger/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByLabelText(/^Domain/).getAttribute("aria-invalid")).toBe("true"),
    );
    // What IntegrationsPage does after a save: a new object, same id.
    view.rerender(
      <IntegrationDrawer
        integration={tesla({ settingValues: { client_id: "abc", domain: "", charger: "x" } })}
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByLabelText(/^Domain/).getAttribute("aria-invalid")).toBe("true");
    // Another integration starts clean.
    view.rerender(
      <IntegrationDrawer
        integration={tesla({ id: "other", name: "Other" })}
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByLabelText(/^Domain/).hasAttribute("aria-invalid")).toBe(false);
  });

  it("Reconnect on a connected plugin never saves the form", async () => {
    open(
      tesla({
        status: "connected",
        configured: true,
        settingValues: { client_id: "abc", domain: "d.example", charger: "" },
      }),
    );
    await userEvent.clear(screen.getByLabelText(/^Client ID/));
    await userEvent.click(screen.getByRole("button", { name: "Re-authorize" }));
    await waitFor(() => expect(assigned).toBe("https://auth.example/authorize"));
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("saves unsaved edits before reaching the provider", async () => {
    open();
    await userEvent.type(screen.getByLabelText(/^Domain/), "d.example");
    const connect = screen.getByRole("button", { name: "Save and connect to Tesla" });
    await userEvent.click(connect);
    await waitFor(() => expect(assigned).toBe("https://auth.example/authorize"));
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ "integration.tesla.domain": "d.example" }),
    );
    const saved = vi.mocked(api.updateSettings).mock.invocationCallOrder[0];
    const asked = vi.mocked(api.getPluginOAuthUrl).mock.invocationCallOrder[0];
    expect(saved).toBeLessThan(asked);
  });

  it("does not leave when the save fails", async () => {
    vi.mocked(api.updateSettings).mockRejectedValueOnce(new Error("disk full"));
    open();
    await userEvent.type(screen.getByLabelText(/^Domain/), "d.example");
    await userEvent.click(screen.getByRole("button", { name: "Save and connect to Tesla" }));
    expect(await screen.findByText("disk full")).toBeTruthy();
    expect(api.getPluginOAuthUrl).not.toHaveBeenCalled();
    expect(assigned).toBeNull();
  });

  it("speaks French", async () => {
    await i18n.changeLanguage("fr");
    open(tesla({ settingValues: { client_id: "abc", domain: "d.example", charger: "" } }));
    expect(screen.getByRole("button", { name: "Connecter à Tesla" })).toBeTruthy();
  });
});
