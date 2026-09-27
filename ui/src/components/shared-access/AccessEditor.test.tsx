/**
 * Spec 181 R3 / R7.29 — the access editor. The first attempt crashed when
 * opening an access that carried a period; that is pinned here first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, userEvent, within, waitFor } from "../../test-utils";
import { AccessEditor } from "./AccessEditor";
import { Dialog } from "./ui";
import { useTimezone } from "../../store/useTimezone";
import { useSharedAccess } from "../../store/useSharedAccess";
import * as api from "../../api";
import type { SharedAccessState, SharedAccessView } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  createSharedAccess: vi.fn(),
  updateSharedAccess: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ "sharedAccess.enabled": "true" }),
  getSharedAccessState: vi.fn(),
}));

const state: SharedAccessState = {
  enabled: true,
  publicUrl: "https://acces.example.org/access/",
  accesses: [],
  gates: [
    { equipmentId: "entree", name: "Portail d'entrée", armed: true, people: 1, commandValues: [], hasCommand: true },
    {
      equipmentId: "garage",
      name: "Garage",
      armed: true,
      people: 0,
      commandValues: ["open", "close", "stop"],
      hasCommand: true,
    },
  ],
  profiles: [],
  plugins: [],
};

const withPeriod: SharedAccessView = {
  id: "a1",
  kind: "manual",
  label: "Plombier",
  code: "4K7M-9QT2",
  invitationUrl: "https://acces.example.org/access/#i=abc",
  gates: [{ equipmentId: "garage", name: "Garage", value: "open" }],
  validFrom: "2026-10-03T14:20:00.000Z",
  validUntil: "2026-10-07T09:00:00.000Z",
  timeWindows: [{ from: "08:00", to: "18:00" }],
  status: "not_yet",
  suspendedAt: null,
  revokedAt: null,
  source: null,
  phones: 0,
  useCount: 0,
  lastUsedAt: null,
  createdAt: "2026-09-27T10:00:00.000Z",
};

function renderEditor(mode: Parameters<typeof AccessEditor>[0]["mode"], onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <AccessEditor mode={mode} state={state} onClose={onClose} />
    </MemoryRouter>,
  );
  return onClose;
}

describe("AccessEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTimezone.setState({ tz: "Europe/Paris", loaded: true });
    vi.mocked(api.getSharedAccessState).mockResolvedValue(state);
    useSharedAccess.setState({ enabled: true, state });
  });

  it("opens an access with a period without crashing, on the house's clock", () => {
    renderEditor({ kind: "edit", access: withPeriod });

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("Plombier")).toBeTruthy();
    expect(within(dialog).getByDisplayValue("2026-10-03")).toBeTruthy();
    expect(within(dialog).getByDisplayValue("2026-10-07")).toBeTruthy();
    // 14:20Z is 16:20 in Paris.
    const startHour = screen.getByRole("combobox", { name: "From — hour" }) as HTMLSelectElement;
    expect(startHour.value).toBe("16");
    // The end's day is later: no hour is disabled on it.
    const endHour = screen.getByRole("combobox", { name: "To — hour" }) as HTMLSelectElement;
    expect([...endHour.options].some((o) => o.disabled)).toBe(false);
    expect(within(dialog).getByDisplayValue("08:00")).toBeTruthy();
    expect(within(dialog).getByText("4K7M-9QT2")).toBeTruthy();
  });

  it("disables the end's hours before the start when both fall on the same day", async () => {
    renderEditor({ kind: "edit", access: withPeriod });
    fireEvent.change(screen.getByLabelText("To — day"), { target: { value: "2026-10-03" } });

    const endHour = screen.getByRole("combobox", { name: "To — hour" }) as HTMLSelectElement;
    const disabled = [...endHour.options].filter((o) => o.disabled).map((o) => Number(o.value));
    expect(disabled).toEqual(Array.from({ length: 16 }, (_, h) => h));
    // Snapped to the first slot after the start.
    expect(endHour.value).toBe("16");
    const endMinute = screen.getByRole("combobox", { name: "To — minutes" }) as HTMLSelectElement;
    expect(endMinute.value).toBe("25");
  });

  it("refuses aloud a day typed before the start", () => {
    renderEditor({ kind: "edit", access: withPeriod });
    fireEvent.change(screen.getByLabelText("To — day"), { target: { value: "2026-10-01" } });
    expect(screen.getByRole("alert").textContent).toMatch(/before the start/);
    expect(screen.getByDisplayValue("2026-10-07")).toBeTruthy();
  });

  it("carries the end along when the start moves past it, keeping the length", () => {
    renderEditor({ kind: "edit", access: withPeriod });
    // 3 Oct 16:20 → 7 Oct 11:00; the start moves to 10 Oct.
    fireEvent.change(screen.getByLabelText("From — day"), { target: { value: "2026-10-10" } });
    expect(screen.getByDisplayValue("2026-10-14")).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "To — hour" }) as HTMLSelectElement).value).toBe("11");
  });

  it("lists the gate it was opened on, with « open » for a gate with values", () => {
    renderEditor({ kind: "create", gateIds: ["garage"] });
    const select = screen.getByRole("combobox", { name: "What a press on Garage sends" }) as HTMLSelectElement;
    expect(select.value).toBe("open");
    expect((screen.getByRole("checkbox", { name: /With a code/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("offers no select for a single value (`[\"pulse\"]`) and sends no value", async () => {
    useSharedAccess.setState({ enabled: true });
    const pulse = { ...state, gates: [...state.gates, {
      equipmentId: "portail", name: "Portail LoRa", armed: true, people: 0,
      commandValues: ["pulse"], hasCommand: true,
    }] };
    vi.mocked(api.createSharedAccess).mockResolvedValueOnce({ ...withPeriod, label: "Léa" });
    render(
      <MemoryRouter>
        <AccessEditor mode={{ kind: "create", gateIds: ["portail"] }} state={pulse} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("combobox", { name: /What a press on Portail LoRa sends/ })).toBeNull();
    expect(screen.getByText("impulse: what its own button sends")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Name"), "Léa");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createSharedAccess).toHaveBeenCalled());
    expect(vi.mocked(api.createSharedAccess).mock.calls[0][0].gates).toEqual([{ equipmentId: "portail" }]);
  });

  it("shows the refusal next to the control, before sending", async () => {
    renderEditor({ kind: "create", gateIds: [] });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("The name is required.");

    await userEvent.type(screen.getByLabelText("Name"), "Léa");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toMatch(/at least one gate/);
    expect(api.createSharedAccess).not.toHaveBeenCalled();
  });

  it("refuses a window crossing midnight inline", async () => {
    renderEditor({ kind: "create", gateIds: ["entree"] });
    await userEvent.type(screen.getByLabelText("Name"), "Léa");
    await userEvent.click(screen.getByRole("button", { name: "Time windows" }));
    const to = screen.getByLabelText("Window end");
    await userEvent.clear(to);
    await userEvent.type(to, "06:00");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toMatch(/crosses midnight/);
  });

  it("shows a server refusal translated, and the invitation once created", async () => {
    vi.mocked(api.createSharedAccess).mockRejectedValueOnce(new Error("no_command"));
    renderEditor({ kind: "create", gateIds: ["entree"] });
    await userEvent.type(screen.getByLabelText("Name"), "Léa");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/has no command/);

    vi.mocked(api.createSharedAccess).mockResolvedValueOnce({
      ...withPeriod,
      label: "Léa",
      validFrom: null,
      validUntil: null,
      timeWindows: [],
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText(/« Léa » created/)).toBeTruthy());
    expect(api.createSharedAccess).toHaveBeenLastCalledWith({
      label: "Léa",
      gates: [{ equipmentId: "entree" }],
      withCode: true,
      validFrom: null,
      validUntil: null,
      timeWindows: [],
    });
    expect(screen.getByText("https://acces.example.org/access/#i=abc")).toBeTruthy();
  });
});

describe("Dialog", () => {
  it("keeps margin: auto — the CSS reset zeroes every margin", () => {
    render(
      <Dialog title="T" onClose={() => {}}>
        x
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className.split(/\s+/)).toContain("m-auto");
    // …and sits in a flex overlay that centres it as well.
    expect(dialog.parentElement?.className).toMatch(/\bflex\b/);
    expect(dialog.parentElement?.className).toMatch(/\bjustify-center\b/);
  });
});
