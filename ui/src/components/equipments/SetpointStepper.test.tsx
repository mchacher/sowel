import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../test-utils";
import { SetpointStepper } from "./SetpointStepper";

// Spec 196, slice 8a — the one setpoint control.

function renderStepper(props: Partial<React.ComponentProps<typeof SetpointStepper>> = {}) {
  const onCommit = props.onCommit ?? vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <SetpointStepper
      value={20}
      min={16}
      max={30}
      unit="°C"
      size="md"
      label="Setpoint"
      debounceMs={50}
      {...props}
      onCommit={onCommit}
    />,
  );
  return { ...utils, onCommit };
}

const down = () => screen.getByRole("button", { name: "Lower the setpoint" });
const up = () => screen.getByRole("button", { name: "Raise the setpoint" });

describe("SetpointStepper", () => {
  it("sends one order with the final value after four taps", async () => {
    const { onCommit } = renderStepper();
    for (let i = 0; i < 4; i++) fireEvent.click(up());
    expect(screen.getByText("22.0 °C")).toBeTruthy();
    expect(screen.getByTestId("setpoint-pending")).toBeTruthy();
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith(22);
  });

  it("commits the pending value when it unmounts during the delay", async () => {
    const { onCommit, unmount } = renderStepper({ debounceMs: 10_000 });
    fireEvent.click(down());
    fireEvent.click(down());
    unmount();
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(19));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("disables a button at its bound", () => {
    renderStepper({ value: 30 });
    expect((up() as HTMLButtonElement).disabled).toBe(true);
    expect((down() as HTMLButtonElement).disabled).toBe(false);
  });

  it("waits for a value unless it has a start value", () => {
    const { unmount } = renderStepper({ value: null });
    expect((up() as HTMLButtonElement).disabled).toBe(true);
    unmount();
    renderStepper({ value: null, startValue: 6, min: 6, max: 32, step: 1, unit: "A" });
    expect((up() as HTMLButtonElement).disabled).toBe(false);
  });

  it("draws 28 px buttons with a 44 px touch area (sm), 44 px (md) and 56 px (lg)", () => {
    const sizes = { sm: ["hit-44", "w-7", "h-7"], md: ["min-w-11", "min-h-11"], lg: ["w-14", "h-14"] } as const;
    for (const [size, classes] of Object.entries(sizes)) {
      const { unmount } = renderStepper({ size: size as "sm" | "md" | "lg" });
      for (const c of classes) expect(up().classList.contains(c)).toBe(true);
      expect(up().parentElement?.classList.contains("hit-group")).toBe(true);
      unmount();
    }
  });

  it("names its buttons from the given labels", () => {
    renderStepper({ decreaseLabel: "Lower the charge current", increaseLabel: "Raise the charge current" });
    expect(screen.getByRole("button", { name: "Raise the charge current" })).toBeTruthy();
  });

  it("reverts and says so when the order fails", async () => {
    renderStepper({ onCommit: vi.fn().mockRejectedValue(new Error("nope")) });
    fireEvent.click(up());
    await waitFor(() => expect(screen.getByText("Setpoint not applied")).toBeTruthy());
    expect(screen.getByText("20.0 °C")).toBeTruthy();
  });
});

describe("SetpointStepper error line (#1129)", () => {
  it("writes the failure under the control unless the parent says it", async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error("refused"));
    const { unmount } = renderStepper({ onCommit });
    fireEvent.click(up());
    expect(await screen.findByText("Setpoint not applied")).toBeTruthy();
    unmount();
    renderStepper({ onCommit, errorLine: false });
    fireEvent.click(up());
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Setpoint not applied")).toBeNull();
  });
});

describe("SetpointStepper value style (#1129, decision pr3-degre)", () => {
  it("writes the full unit by default above sm, the tile form when asked", () => {
    const { unmount } = renderStepper();
    expect(screen.getByText("20.0 °C")).toBeTruthy();
    unmount();
    renderStepper({ valueStyle: "compact" });
    expect(screen.getByText("20.0°")).toBeTruthy();
  });
});
