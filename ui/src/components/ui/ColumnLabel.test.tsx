import { describe, it, expect } from "vitest";
import { render } from "../../test-utils";
import { hasUnit } from "../../lib/column-units";
import { ColumnLabel } from "./ColumnLabel";

// #1231 — column headers are uppercase, unit symbols are not: « €/KWH » and
// « KWH » were printed for « €/kWh » and « kWh ».

describe("ColumnLabel", () => {
  it("keeps the unit in its own case and leaves the label to the header", () => {
    const { container } = render(
      <table>
        <thead>
          <tr className="uppercase">
            <th>
              <ColumnLabel text="HP €/kWh" />
            </th>
          </tr>
        </thead>
      </table>,
    );
    const th = container.querySelector("th")!;
    expect(th.textContent).toBe("HP €/kWh");
    const unit = th.querySelector("span.normal-case");
    expect(unit?.textContent).toBe("€/kWh");
  });

  it("wraps a header that is only a unit", () => {
    const { container } = render(<ColumnLabel text="kWh" />);
    expect(container.querySelector("span.normal-case")?.textContent).toBe("kWh");
  });

  it("finds unit symbols, not words that hold the same letters", () => {
    expect(hasUnit("Prix €/kWh")).toBe(true);
    expect(hasUnit("Puissance (kVA)")).toBe(true);
    expect(hasUnit("Température °C")).toBe(true);
    expect(hasUnit("Watt")).toBe(false);
    expect(hasUnit("What the load draws")).toBe(false);
    expect(hasUnit("Value")).toBe(false);
    expect(hasUnit("Abonnement")).toBe(false);
  });
});
