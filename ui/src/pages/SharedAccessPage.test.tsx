/**
 * Spec 181 R7 — the owner's page: tabs per gate, « Tous » once there are two,
 * « Profils » last, `?gate=` honoured, and the default profile not deletable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, userEvent, within } from "../test-utils";
import { SharedAccessPage } from "./SharedAccessPage";
import * as api from "../api";
import type { SharedAccessState, SharedAccessView } from "../types";

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  getSettings: vi.fn(),
  getSharedAccessState: vi.fn(),
  deleteSharedAccessProfile: vi.fn(),
}));

function access(over: Partial<SharedAccessView>): SharedAccessView {
  return {
    id: "a",
    kind: "manual",
    label: "Léa",
    code: "4K7M-9QT2",
    invitationUrl: null,
    gates: [{ equipmentId: "entree", name: "Portail d'entrée", value: null }],
    validFrom: null,
    validUntil: null,
    timeWindows: [],
    status: "live",
    suspendedAt: null,
    revokedAt: null,
    source: null,
    phones: 2,
    useCount: 0,
    lastUsedAt: null,
    createdAt: "2026-09-27T10:00:00.000Z",
    ...over,
  };
}

const state: SharedAccessState = {
  enabled: true,
  publicUrl: null,
  accesses: [
    access({ id: "a1" }),
    access({
      id: "a2",
      kind: "external",
      label: "Martin",
      gates: [{ equipmentId: "garage", name: "Garage", value: "open" }],
      source: {
        pluginId: "guestflow",
        externalId: "stay-8841",
        profileId: "p1",
        profileName: "Par défaut",
        from: "2026-10-03T14:00:00.000Z",
        until: "2026-10-07T09:00:00.000Z",
        earlyOpenAt: null,
        extendedUntil: null,
      },
    }),
  ],
  gates: [
    { equipmentId: "entree", name: "Portail d'entrée", armed: true, people: 1, commandValues: [], hasCommand: true },
    { equipmentId: "garage", name: "Garage", armed: false, people: 1, commandValues: ["open", "close"], hasCommand: true },
  ],
  profiles: [
    {
      id: "p1",
      name: "Par défaut",
      pluginId: "guestflow",
      isDefault: true,
      gates: [{ equipmentId: "entree", name: "Portail d'entrée", value: null }],
      validFrom: null,
      validUntil: null,
      timeWindows: [],
      withCode: true,
    },
  ],
  plugins: [{ id: "guestflow", name: "guestFlow" }],
};

function renderPage(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <SharedAccessPage />
    </MemoryRouter>,
  );
}

describe("SharedAccessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSettings).mockResolvedValue({ "sharedAccess.enabled": "true" });
    vi.mocked(api.getSharedAccessState).mockResolvedValue(state);
  });

  it("says it is off, with a way to Settings, when the setting is off", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ "sharedAccess.enabled": "false" });
    renderPage("/shared-access");
    expect(await screen.findByText("Shared access is turned off.")).toBeTruthy();
    expect(api.getSharedAccessState).not.toHaveBeenCalled();
  });

  it("treats a /state answer that is not the JSON state as off", async () => {
    vi.mocked(api.getSharedAccessState).mockRejectedValue(new SyntaxError("Unexpected token <"));
    renderPage("/shared-access");
    expect(await screen.findByText("Shared access is turned off.")).toBeTruthy();
  });

  it("does not read a failed settings read as « off »: neutral message, retry, state kept", async () => {
    const { useSharedAccess } = await import("../store/useSharedAccess");
    useSharedAccess.setState({ enabled: null, state: null, error: null });
    vi.mocked(api.getSettings).mockRejectedValueOnce(new Error("HTTP 429: Too Many Requests"));
    renderPage("/shared-access");
    expect(await screen.findByText("Could not read the state of shared access.")).toBeTruthy();
    expect(screen.queryByText("Shared access is turned off.")).toBeNull();
    expect(useSharedAccess.getState().enabled).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("tab", { name: "Profiles" })).toBeTruthy();
    expect(useSharedAccess.getState().enabled).toBe(true);

    // Once known on, a transient failure (settings or state) hides nothing.
    vi.mocked(api.getSharedAccessState).mockRejectedValueOnce(new Error("HTTP 429: Too Many Requests"));
    await useSharedAccess.getState().refresh();
    expect(useSharedAccess.getState().enabled).toBe(true);
    expect(useSharedAccess.getState().state).not.toBeNull();
    vi.mocked(api.getSettings).mockRejectedValueOnce(new Error("HTTP 429: Too Many Requests"));
    await useSharedAccess.getState().refresh();
    expect(useSharedAccess.getState().enabled).toBe(true);
  });

  it("has a tab per gate, « All » once there are two, « Profiles » last; ?gate= selects one", async () => {
    renderPage("/shared-access?gate=garage");
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Portail d'entrée", "Garage", "All", "Profiles"]);
    expect(screen.getByRole("tab", { name: "Garage" }).getAttribute("aria-selected")).toBe("true");
    // The Garage tab lists the external access with its source, and the gate is disarmed.
    expect(screen.getByText("Martin")).toBeTruthy();
    expect(screen.queryByText("Léa")).toBeNull();
    expect(screen.getByText("guestFlow · profile Par défaut")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    // No public address: said in the header.
    expect(screen.getAllByText(/Public address not set/).length).toBeGreaterThan(0);
  });

  it("refuses to delete the default profile, inline", async () => {
    renderPage("/shared-access");
    await userEvent.click(await screen.findByRole("tab", { name: "Profiles" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alert").textContent).toMatch(/default profile cannot be deleted/);
    expect(api.deleteSharedAccessProfile).not.toHaveBeenCalled();
    // The default is marked once — by the star — never « Par défaut Par défaut ».
    const list = screen.getByRole("button", { current: true });
    expect(within(list).getByRole("img", { name: "Default profile" })).toBeTruthy();
    expect(within(list).getAllByText("Par défaut")).toHaveLength(1);
  });
});
