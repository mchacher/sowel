/**
 * Issue #858 — the slide-to-confirm control had to fit a thumb.
 *
 * Full width on a 393 px phone meant a 295 px sweep starting in the
 * bottom-left corner. These pin the two things that fix rests on: the track is
 * capped, and the label never sits under the knob at either end of the travel.
 *
 * The threshold tests are the spec 146 guarantee (#320) that the cap must not
 * have weakened: a partial drag still actuates nothing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "../../test-utils";
import { SlideToConfirm } from "./SlideToConfirm";

/**
 * jsdom lays nothing out, so the track reports the width we give it here.
 * Kept equal to the CSS cap on purpose: the stub stands in for the capped
 * track, and the cap assertion below reads the same number.
 */
const TRACK_WIDTH = 260;
const KNOB_SPAN = 58; // knob 50 + 4 px padding either side
const TRAVEL = TRACK_WIDTH - KNOB_SPAN;

let widthSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(TRACK_WIDTH);
});
afterEach(() => widthSpy.mockRestore());

function setup(onConfirm = vi.fn()) {
  const { container } = render(
    <SlideToConfirm label="Slide to open" confirmedLabel="Actuated" onConfirm={onConfirm} />,
  );
  const knob = screen.getByRole("button", { name: "Slide to open" });
  const track = container.firstElementChild as HTMLElement;
  return { onConfirm, knob, track };
}

/** Drag the knob by `dx` px without releasing. */
function drag(knob: HTMLElement, dx: number) {
  fireEvent.pointerDown(knob, { pointerId: 1, clientX: 0 });
  fireEvent.pointerMove(knob, { pointerId: 1, clientX: dx });
}

describe("SlideToConfirm", () => {
  it("caps the track instead of filling its parent (#858)", () => {
    const { track } = setup();
    // The cap is the fix: without it the track inherits the sheet's full width.
    expect(track.className).toMatch(new RegExp(`max-w-\\[${TRACK_WIDTH}px\\]`));
    expect(track.className).toMatch(/mx-auto/);
  });

  it("keeps the label clear of the knob at rest", () => {
    setup();
    const label = screen.getByText("Slide to open");
    // Centred across the whole track, at this width the text would start
    // underneath the knob.
    expect(label.style.left).toBe(`${KNOB_SPAN}px`);
    expect(label.style.right).toBe("0px");
  });

  it("moves the label to the other side once the slide is done", () => {
    const { knob } = setup();
    drag(knob, TRAVEL);

    const label = screen.getByText("Actuated");
    expect(label.style.left).toBe("0px");
    expect(label.style.right).toBe(`${KNOB_SPAN}px`);
  });

  it("actuates when the knob reaches the end of the capped track", () => {
    const { onConfirm, knob } = setup();
    drag(knob, TRAVEL);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("actuates once, not on every further move", () => {
    const { onConfirm, knob } = setup();
    drag(knob, TRAVEL);
    fireEvent.pointerMove(knob, { pointerId: 1, clientX: TRAVEL + 40 });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not actuate on a partial drag, and snaps back on release", () => {
    const { onConfirm, knob } = setup();
    drag(knob, TRAVEL - 20);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(knob.style.left).toBe(`${4 + TRAVEL - 20}px`);

    fireEvent.pointerUp(knob, { pointerId: 1 });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(knob.style.left).toBe("4px");
  });

  it("never actuates on a track too narrow to have any travel", () => {
    widthSpy.mockReturnValue(0);
    const { onConfirm, knob } = setup();
    drag(knob, 200);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
