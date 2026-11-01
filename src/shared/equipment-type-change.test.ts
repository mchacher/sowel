import { describe, it, expect } from "vitest";
import { typesOfferedOnEdit } from "./equipment-type-change.js";

describe("typesOfferedOnEdit (spec 190 FR7)", () => {
  it("offers shutter, awning and door to any of the three", () => {
    expect(typesOfferedOnEdit("shutter")).toEqual(["shutter", "awning", "door"]);
    expect(typesOfferedOnEdit("door")).toEqual(["shutter", "awning", "door"]);
    expect(typesOfferedOnEdit("awning")).toEqual(["shutter", "awning", "door"]);
  });

  it("offers only the current type to anything else", () => {
    expect(typesOfferedOnEdit("light_onoff")).toEqual(["light_onoff"]);
    expect(typesOfferedOnEdit("gate")).toEqual(["gate"]);
    expect(typesOfferedOnEdit("pool_cover")).toEqual(["pool_cover"]);
  });
});
