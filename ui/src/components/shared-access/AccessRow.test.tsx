/**
 * Spec 181 R7.28 — a revoked or ended access is faded, but only its content:
 * an opacity on the <li> faded the « ⋯ » menu and the dialogs opened from it,
 * and let a later faded row paint over them.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { AccessRow } from "./AccessRow";
import { useTimezone } from "../../store/useTimezone";
import type { SharedAccessState, SharedAccessView } from "../../types";

const state: SharedAccessState = {
  enabled: true,
  publicUrl: "https://acces.example.org/access/",
  accesses: [],
  gates: [],
  profiles: [],
  plugins: [],
};

const revoked: SharedAccessView = {
  id: "a1",
  kind: "manual",
  label: "Plombier",
  code: null,
  invitationUrl: null,
  gates: [],
  validFrom: null,
  validUntil: null,
  timeWindows: [],
  status: "revoked",
  suspendedAt: null,
  revokedAt: "2026-09-27T10:00:00.000Z",
  source: null,
  phones: 0,
  useCount: 0,
  lastUsedAt: null,
  createdAt: "2026-09-20T10:00:00.000Z",
};

function renderRow(access: SharedAccessView) {
  return render(
    <ul>
      <AccessRow access={access} state={state} showGates={false} onEdit={() => {}} />
    </ul>,
  );
}

describe("AccessRow, revoked or ended", () => {
  beforeEach(() => {
    useTimezone.setState({ tz: "Europe/Paris", loaded: true });
  });

  it("fades the content, not the row", () => {
    const { container } = renderRow(revoked);
    const li = container.querySelector("li") as HTMLElement;
    expect(li.className).not.toMatch(/opacity/);
    expect(screen.getByText("Plombier").closest(".opacity-70")).not.toBeNull();
  });

  it("leaves the « ⋯ » menu unfaded, and opens its dialogs outside the row", async () => {
    const { container } = renderRow({ ...revoked, status: "ended", revokedAt: null });
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = screen.getByRole("menu");
    expect(menu.closest(".opacity-70")).toBeNull();

    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(container.querySelector("li")?.contains(dialog)).toBe(false);
    expect(dialog.closest(".opacity-70")).toBeNull();
  });

  it("is not faded while it is live", () => {
    renderRow({ ...revoked, status: "live", revokedAt: null });
    expect(screen.getByText("Plombier").closest(".opacity-70")).toBeNull();
  });
});
