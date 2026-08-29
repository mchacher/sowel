import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import i18n from "../../i18n";
import { MissingBindingsModal } from "./MissingBindingsModal";
import * as api from "../../api";
import type { DataBindingWithValue, DeviceWithDetails } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getDevice: vi.fn(),
  addDataBinding: vi.fn().mockResolvedValue(undefined),
  addOrderBinding: vi.fn().mockResolvedValue(undefined),
}));

/** A weather device that gained two points since the equipment was bound. */
const device = {
  id: "dev-1",
  name: "Weather Forecast",
  data: [
    { id: "d1", key: "temp_now", category: "temperature_outdoor", type: "number" },
    { id: "d2", key: "humidity_now", category: "humidity_outdoor", type: "number" },
    { id: "d3", key: "j1_temp_max", category: "temperature_outdoor", type: "number" },
  ],
  orders: [],
} as unknown as DeviceWithDetails;

const boundTempNow = {
  id: "b-1",
  equipmentId: "eq-1",
  deviceDataId: "d1",
  alias: "temp_now",
  deviceId: "dev-1",
} as unknown as DataBindingWithValue;

function renderModal(onAdded = vi.fn()) {
  render(
    <MissingBindingsModal
      equipmentId="eq-1"
      equipmentType="weather"
      dataBindings={[boundTempNow]}
      orderBindings={[]}
      onClose={vi.fn()}
      onAdded={onAdded}
    />,
  );
  return onAdded;
}

describe("MissingBindingsModal (#707)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDevice).mockResolvedValue(device);
    void i18n.changeLanguage("en");
  });

  it("lists only the unbound points, all checked to start with", async () => {
    renderModal();

    await waitFor(() => expect(screen.getByText("humidity_now")).toBeTruthy());
    // Already bound, so it must not be offered again.
    expect(screen.queryByText("temp_now")).toBeNull();
    expect(screen.getByText("j1_temp_max")).toBeTruthy();

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it("adds only what stayed checked", async () => {
    const onAdded = renderModal();
    await waitFor(() => expect(screen.getByText("humidity_now")).toBeTruthy());

    // Uncheck the forecast point: the owner keeps the decision.
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    await userEvent.click(boxes[1]);

    await userEvent.click(screen.getByRole("button", { name: /add 1 binding/i }));

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(api.addDataBinding).toHaveBeenCalledTimes(1);
    expect(api.addDataBinding).toHaveBeenCalledWith("eq-1", {
      deviceDataId: "d2",
      alias: "humidity_now",
    });
  });

  it("says how many of the chosen points will be recorded in history", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("humidity_now")).toBeTruthy());

    // humidity_outdoor is historized by default; the jX_ forecast point is not,
    // so the owner is told about one series, not two.
    expect(screen.getByText(/1 of them will be recorded in history/i)).toBeTruthy();
  });

  it("writes nothing when everything is unchecked", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("humidity_now")).toBeTruthy());

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    await userEvent.click(boxes[0]);
    await userEvent.click(boxes[1]);

    const confirm = screen.getByRole("button", { name: /add .* binding/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(api.addDataBinding).not.toHaveBeenCalled();
  });

  it("keeps the owner's choices when a value update re-renders it", async () => {
    // The page hands fresh binding arrays on every value refetch. An effect
    // keyed on their identity would re-run, re-check the boxes, and bind on
    // confirm exactly what the owner had just declined.
    const onAdded = vi.fn();
    const { rerender } = render(
      <MissingBindingsModal
        equipmentId="eq-1"
        equipmentType="weather"
        dataBindings={[boundTempNow]}
        orderBindings={[]}
        onClose={vi.fn()}
        onAdded={onAdded}
      />,
    );
    await waitFor(() => expect(screen.getByText("humidity_now")).toBeTruthy());

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    await userEvent.click(boxes[1]);
    expect(boxes[1].checked).toBe(false);

    // Same content, new array identity — what a value update produces.
    rerender(
      <MissingBindingsModal
        equipmentId="eq-1"
        equipmentType="weather"
        dataBindings={[{ ...boundTempNow }]}
        orderBindings={[]}
        onClose={vi.fn()}
        onAdded={onAdded}
      />,
    );

    await waitFor(() => expect(screen.getByText("humidity_now")).toBeTruthy());
    const after = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(after[1].checked).toBe(false);
    // And it did not re-issue the device reads either.
    expect(vi.mocked(api.getDevice)).toHaveBeenCalledTimes(1);
  });

  it("stays open and reports when nothing could be added", async () => {
    vi.mocked(api.addDataBinding).mockRejectedValue(new Error("409"));
    const onAdded = renderModal();
    await waitFor(() => expect(screen.getByText("humidity_now")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /add 2 bindings/i }));

    await waitFor(() => expect(screen.getByText(/nothing could be added/i)).toBeTruthy());
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("says so when the equipment is already bound to everything", async () => {
    render(
      <MissingBindingsModal
        equipmentId="eq-1"
        equipmentType="weather"
        dataBindings={[
          boundTempNow,
          { ...boundTempNow, id: "b-2", deviceDataId: "d2", alias: "humidity_now" },
          { ...boundTempNow, id: "b-3", deviceDataId: "d3", alias: "j1_temp_max" },
        ]}
        orderBindings={[]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/nothing to add/i)).toBeTruthy(),
    );
  });
});
