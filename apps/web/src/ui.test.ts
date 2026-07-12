import { describe, expect, it } from "vitest";
import { rules } from "./ui";

describe("rules ui", () => {
  it("shows item mode in shared rule choices", () => {
    expect(rules).toContainEqual({
      id: "items",
      label: "아이템전",
      desc: "매 턴 랜덤 아이템이 터지는 난장판 모드"
    });
  });
});
