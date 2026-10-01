/**
 * Spec 181 R9.32–33 — the « Profils » tab. The message after creating a
 * profile (above all « no gate yet ») must survive the profile getting its id,
 * and editing a profile must not fill in a date bound it does not hold.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { ProfilesTab } from "./ProfilesTab";
import { useTimezone } from "../../store/useTimezone";
import { useSharedAccess } from "../../store/useSharedAccess";
import * as api from "../../api";
import type { SharedAccessProfileView, SharedAccessState } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  createSharedAccessProfile: vi.fn(),
  updateSharedAccessProfile: vi.fn(),
  deleteSharedAccessProfile: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ "sharedAccess.enabled": "true" }),
  getSharedAccessState: vi.fn(),
}));

const fromOnly: SharedAccessProfileView = {
  id: "p1",
  name: "Séjours",
  pluginId: null,
  isDefault: true,
  gates: [{ equipmentId: "entree", name: "Portail d'entrée", value: null }],
  validFrom: "2026-10-03T14:20:00.000Z",
  validUntil: null,
  timeWindows: [],
  withCode: true,
};

const base: SharedAccessState = {
  enabled: true,
  publicUrl: null,
  accesses: [],
  gates: [
    {
      equipmentId: "entree",
      name: "Portail d'entrée",
      armed: true,
      people: 0,
      commandValues: [],
      hasCommand: true,
    },
  ],
  profiles: [fromOnly],
  plugins: [],
};

/** The page reads the tab's state from the store; so does this harness. */
function Harness() {
  const state = useSharedAccess((s) => s.state);
  return state ? <ProfilesTab state={state} /> : null;
}

describe("ProfilesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTimezone.setState({ tz: "Europe/Paris", loaded: true });
    useSharedAccess.setState({ enabled: true, state: base });
    vi.mocked(api.getSharedAccessState).mockResolvedValue(base);
  });

  it("keeps the « no gate yet » warning once a new profile gets its id", async () => {
    const created: SharedAccessProfileView = {
      ...fromOnly,
      id: "p2",
      name: "Voisins",
      isDefault: false,
      gates: [],
      validFrom: null,
    };
    vi.mocked(api.createSharedAccessProfile).mockResolvedValueOnce(created);
    vi.mocked(api.getSharedAccessState).mockResolvedValue({
      ...base,
      profiles: [fromOnly, created],
    });
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "profile" }));
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Voisins");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        screen.getByText("Saved, but without a gate this profile opens nothing."),
      ).toBeTruthy(),
    );
    // The editor now edits the created profile: selected in the list, deletable.
    expect(screen.getByRole("button", { name: /Voisins/, current: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("keeps a profile « from » a date only through a name-only edit", async () => {
    vi.mocked(api.updateSharedAccessProfile).mockResolvedValueOnce({
      ...fromOnly,
      name: "Séjours bis",
    });
    render(<Harness />);
    expect(screen.getByText("no end date")).toBeTruthy();

    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Séjours bis");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateSharedAccessProfile).toHaveBeenCalled());
    const body = vi.mocked(api.updateSharedAccessProfile).mock.calls[0][1];
    expect(body.name).toBe("Séjours bis");
    expect(body).not.toHaveProperty("validFrom");
    expect(body).not.toHaveProperty("validUntil");
  });
});
