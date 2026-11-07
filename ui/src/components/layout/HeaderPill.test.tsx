import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { render, screen, userEvent } from "../../test-utils";
import { HeaderPill } from "./HeaderPill";

// Spec 196, slice 1b — the header pills are ≈ 26 px tall. They get the
// invisible 44 px touch area (`hit-44`) and their title as accessible name,
// since on a phone they show an icon and a number only.

describe("HeaderPill", () => {
  it("names the button after its title and gives it a 44 px touch area", async () => {
    const onClick = vi.fn();
    render(
      <HeaderPill icon={<AlertTriangle size={14} />} count={2} tone="warning" title="2 alertes" onClick={onClick} />,
    );
    const pill = screen.getByRole("button", { name: "2 alertes" });
    expect(pill.classList.contains("hit-44")).toBe(true);
    await userEvent.click(pill);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does the same when it is a link, an in-app one without a pulsing dot", () => {
    // Spec 196, FR-6 — the restart pill used a plain <a> that reloaded the
    // whole app, and a dot that pulsed for as long as the restart was pending.
    render(
      <MemoryRouter>
        <HeaderPill icon={<AlertTriangle size={14} />} tone="info" title="Redémarrage requis" href="/settings" />
      </MemoryRouter>,
    );
    const pill = screen.getByRole("link", { name: "Redémarrage requis" });
    expect(pill.classList.contains("hit-44")).toBe(true);
    expect(pill.getAttribute("href")).toBe("/settings");
    expect(pill.innerHTML).not.toMatch(/animate-/);
  });
});
