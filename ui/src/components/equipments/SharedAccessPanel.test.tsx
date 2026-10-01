/**
 * Spec 181 R8.31 — the panel on a gate's own page: the armed switch, how many
 * people can open it, and « Créer un accès » with this gate listed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { SharedAccessPanel } from "./SharedAccessPanel";
import { useSharedAccess } from "../../store/useSharedAccess";
import * as api from "../../api";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getSharedAccessGatePanel: vi.fn(),
  setSharedAccessArmed: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ "sharedAccess.enabled": "true" }),
  getSharedAccessState: vi.fn().mockResolvedValue({
    enabled: true,
    publicUrl: null,
    accesses: [],
    gates: [],
    profiles: [],
    plugins: [],
  }),
}));

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/equipments/g1"]}>
      <Routes>
        <Route path="/equipments/:id" element={<SharedAccessPanel equipmentId="g1" />} />
        <Route path="/shared-access" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SharedAccessPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSharedAccess.setState({ enabled: true, state: null });
  });

  it("renders nothing while the feature is off", () => {
    useSharedAccess.setState({ enabled: false });
    const { container } = renderPanel();
    expect(container.textContent).toBe("");
    expect(api.getSharedAccessGatePanel).not.toHaveBeenCalled();
  });

  it("with no access: says nobody can open it, and offers to create one on this gate", async () => {
    vi.mocked(api.getSharedAccessGatePanel).mockResolvedValue({ armed: true, people: 0 });
    renderPanel();

    expect(await screen.findByText(/Nobody can open this gate/)).toBeTruthy();
    expect(screen.queryByText(/See the accesses/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Create an access" }));
    expect(screen.getByTestId("where").textContent).toBe("/shared-access?gate=g1&new=1");
  });

  it("with accesses: gives the count, links to the gate's tab, and the switch is armed", async () => {
    vi.mocked(api.getSharedAccessGatePanel).mockResolvedValue({ armed: true, people: 3 });
    renderPanel();

    expect(await screen.findByText("3 people can open this gate with a code or a link.")).toBeTruthy();
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("link", { name: /See the accesses/ }).getAttribute("href")).toBe(
      "/shared-access?gate=g1",
    );
  });

  it("disarmed: the accesses are kept, and every press is refused", async () => {
    vi.mocked(api.getSharedAccessGatePanel).mockResolvedValue({ armed: true, people: 3 });
    vi.mocked(api.setSharedAccessArmed).mockResolvedValue({ armed: false, people: 3 });
    renderPanel();

    await userEvent.click(await screen.findByRole("switch"));

    expect(api.setSharedAccessArmed).toHaveBeenCalledWith("g1", false);
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByText("Disarmed.")).toBeTruthy();
    expect(screen.getByText(/The 3 accesses are kept, but every press is refused/)).toBeTruthy();
  });
});
