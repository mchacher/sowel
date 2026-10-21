import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { EvCarGauge } from "./EvCarGauge";

describe("EvCarGauge", () => {
  it("draws the charging post and its cable while plugged in", () => {
    render(<EvCarGauge level={62} tone="ok" plugged />);
    expect(screen.getByTestId("ev-charging-post")).toBeTruthy();
    expect(screen.getByTestId("ev-cable")).toBeTruthy();
  });

  it("draws the car alone when unplugged", () => {
    render(<EvCarGauge level={9} tone="low" plugged={false} />);
    expect(screen.queryByTestId("ev-charging-post")).toBeNull();
    expect(screen.queryByTestId("ev-cable")).toBeNull();
  });

  it("carries the class that brightens widget icons in dark mode", () => {
    const { container } = render(<EvCarGauge level={null} tone="ok" plugged={false} />);
    expect(container.querySelector("svg.widget-icon")).toBeTruthy();
  });
});
