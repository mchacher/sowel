import { describe, it, expect } from "vitest";
import { doorState, isDoorOpenForCount, type DoorStateBinding } from "./door-state.js";

const word = (value: unknown): DoorStateBinding => ({ alias: "state", category: "generic", value });
const position = (value: unknown): DoorStateBinding => ({
  alias: "position",
  category: "shutter_position",
  value,
});

describe("doorState (spec 190 FR3)", () => {
  it("reads the end-state word, in any case", () => {
    expect(doorState([word("CLOSED")])).toBe("closed");
    expect(doorState([word("closed")])).toBe("closed");
    expect(doorState([word("OPEN")])).toBe("open");
    expect(doorState([word("OPENING")])).toBe("moving");
    expect(doorState([word("CLOSING")])).toBe("moving");
    expect(doorState([word("FAULT")])).toBe("fault");
  });

  it("lets the word win over the position", () => {
    expect(doorState([word("CLOSED"), position(40)])).toBe("closed");
  });

  it("falls back to the position on a word it does not know", () => {
    expect(doorState([word("UNKNOWN"), position(40)])).toBe("open");
    expect(doorState([word("UNKNOWN")])).toBe("unknown");
  });

  it("reads the position alone", () => {
    expect(doorState([position(0)])).toBe("closed");
    expect(doorState([position(100)])).toBe("open");
  });

  it("finds a position bound under another alias by its category", () => {
    expect(doorState([{ alias: "pos", category: "shutter_position", value: 0 }])).toBe("closed");
  });

  it("is unknown with nothing usable", () => {
    expect(doorState([])).toBe("unknown");
    expect(doorState([word(null), position(null)])).toBe("unknown");
  });
});

describe("isDoorOpenForCount", () => {
  it("counts anything not proven closed, but not the unknown", () => {
    expect(isDoorOpenForCount("open")).toBe(true);
    expect(isDoorOpenForCount("moving")).toBe(true);
    expect(isDoorOpenForCount("fault")).toBe(true);
    expect(isDoorOpenForCount("closed")).toBe(false);
    expect(isDoorOpenForCount("unknown")).toBe(false);
  });
});
