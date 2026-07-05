import { describe, expect, it } from "vitest";
import { getOpponentSeats } from "./boardSeats";

describe("desktop board seats", () => {
  it("centers the only opponent in a two-player game", () => {
    expect(getOpponentSeats(2)).toEqual(["north"]);
  });

  it("places three players across west, south and east", () => {
    expect(getOpponentSeats(3)).toEqual(["west", "east"]);
  });

  it("uses west, north and east around the local south seat", () => {
    expect(getOpponentSeats(4)).toEqual(["west", "north", "east"]);
  });
});
