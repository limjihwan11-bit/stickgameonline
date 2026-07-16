import { describe, expect, it } from "vitest";
import { rules } from "./ui";

describe("rules ui", () => {
  it("shows item mode in shared rule choices", () => {
    expect(rules).toContainEqual({
      id: "items",
      label: "아이템전",
      desc: "미션을 깨서 랜덤 아이템을 얻고 원하는 때 사용"
    });
  });
});
