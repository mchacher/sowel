import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { SegmentedControl } from "./SegmentedControl";

// Spec 197 (FR-E6.4) — one segmented control for Wh / €, Total / By usage,
// the period tabs and the forecast window chips.

const OPTIONS = [
  { value: "wh", label: "Wh" },
  { value: "eur", label: "€" },
] as const;

describe("SegmentedControl", () => {
  it("marks the chosen segment pressed and reports a new choice", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="wh" onChange={onChange} label="Unit" />);

    const wh = screen.getByRole("button", { name: "Wh" });
    const eur = screen.getByRole("button", { name: "€" });
    expect(wh.getAttribute("aria-pressed")).toBe("true");
    expect(eur.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("group", { name: "Unit" })).toBeTruthy();

    await userEvent.click(eur);
    expect(onChange).toHaveBeenCalledWith("eur");

    // Pressing the chosen segment again is not a change.
    await userEvent.click(wh);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("draws one shape: outlined group, primary fill on the chosen segment, 44 px taps", () => {
    render(<SegmentedControl options={OPTIONS} value="eur" onChange={() => {}} label="Unit" />);
    const group = screen.getByRole("group");
    expect(group.className).toMatch(/\bborder border-border\b/);
    expect(group.className).toMatch(/\bhit-group\b/);
    const eur = screen.getByRole("button", { name: "€" });
    expect(eur.className).toMatch(/\bbg-primary-fill text-white\b/);
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toMatch(/\bhit-44\b/);
      expect(b.className).toMatch(/\bpx-3 py-1\.5 text-caption font-medium\b/);
    }
  });

  it("does nothing while disabled", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={OPTIONS}
        value="wh"
        onChange={onChange}
        disabled
        title="Set a tariff first"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "€" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("group").getAttribute("title")).toBe("Set a tariff first");
  });
});
