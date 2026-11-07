import { describe, expect, it } from "vitest";
import { render, screen } from "../../test-utils";
import { Panel, SliceHeader } from "./Panel";

// Spec 196, slice 7c — a Maison panel is a detached lid over a stack of slices.

describe("Panel", () => {
  it("puts the title at 16 px semibold in a lid, with the count beside it at 14 px tertiary", () => {
    render(
      <Panel title="Équipements" count={9} headerRight={<button type="button">+</button>}>
        <div>Thermostat</div>
      </Panel>,
    );
    const title = screen.getByRole("heading", { level: 2, name: "Équipements" });
    expect(title.className).toMatch(/\btext-lead\b/);
    expect(title.className).toMatch(/\bfont-semibold\b/);

    const lid = title.parentElement!;
    expect(lid.className).toMatch(/\bpanel-lid\b/);
    // No tinted header band any more.
    expect(lid.className).not.toMatch(/bg-primary-light|border-b/);

    const count = screen.getByText("9");
    expect(count.parentElement).toBe(lid);
    expect(count.className).toMatch(/\btext-body\b/);
    expect(count.className).toMatch(/\btext-text-tertiary\b/);
    expect(screen.getByRole("button", { name: "+" }).closest(".panel-lid")).toBe(lid);
  });

  it("makes each child a slice of the body, 12 px below the lid", () => {
    const { container } = render(
      <Panel title="Comportements">
        <div>Modes</div>
        <div>Recettes</div>
      </Panel>,
    );
    const section = container.querySelector("section")!;
    expect(section.className).toMatch(/\bgap-3\b/);
    const body = section.querySelector(".slices")!;
    expect(body.previousElementSibling?.className).toMatch(/\bpanel-lid\b/);
    expect([...body.children].map((c) => c.textContent)).toEqual(["Modes", "Recettes"]);
  });

  it("shows no count when none is given", () => {
    render(
      <Panel title="Activité" subtitle="dernières 24 h">
        <div />
      </Panel>,
    );
    const lid = screen.getByRole("heading", { name: "Activité" }).parentElement!;
    expect([...lid.children].map((c) => c.textContent)).toEqual(["Activité", "dernières 24 h"]);
  });
});

describe("SliceHeader", () => {
  it("draws the label in text colour 14 px semibold and the count at the right, 13 px tertiary", () => {
    render(<SliceHeader icon={<svg data-testid="ico" />} label="Thermostat" count={1} />);
    const label = screen.getByText("Thermostat");
    expect(label.className).toMatch(/\btext-body\b.*\bfont-semibold\b.*\btext-text\b/);
    const count = screen.getByText("1");
    expect(count.className).toMatch(/\bml-auto\b/);
    expect(count.className).toMatch(/\btext-small\b/);
    expect(count.className).toMatch(/\btext-text-tertiary\b/);
    expect(screen.getByTestId("ico").parentElement!.className).toMatch(/\btext-text-secondary\b/);
    // No n-25 category band.
    expect(label.parentElement!.className).not.toMatch(/n-25|border-b/);
  });
});
