import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { ZoneCommands } from "./ZoneCommands";

// Spec 196, slice 1b — the five zone commands are 36 px wide with a 1 px gap,
// so their 44 px touch areas overlap. The toolbar is a `hit-group`: the areas
// paint under the buttons, and a tap on a visible button always reaches it.

describe("ZoneCommands touch areas", () => {
  it("gives every command a 44 px area inside one hit-group", async () => {
    const onCommand = vi.fn();
    render(<ZoneCommands hasLights hasShutters loading={null} onCommand={onCommand} />);
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.classList.contains("hit-group")).toBe(true);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      expect(button.classList.contains("hit-44")).toBe(true);
      expect(button.parentElement).toBe(toolbar);
    }
    await userEvent.click(buttons[1]);
    expect(onCommand).toHaveBeenCalledWith("allLightsOff");
  });
});
