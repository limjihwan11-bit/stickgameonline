import { describe, expect, it } from "vitest";
import { onlinePresets, queuePathForPreset } from "./pages";

describe("online presets", () => {
  it("reduces public matching to five fixed presets", () => {
    expect(onlinePresets.map((preset) => preset.title)).toEqual(["빠른 대전", "아이템전", "전략전", "3인 난투", "4인 파티전"]);
  });

  it("maps presets to stable queue URLs", () => {
    expect(queuePathForPreset(onlinePresets[0])).toBe("/queue?players=2&rule=classic&rules=classic");
    expect(queuePathForPreset(onlinePresets[1])).toBe("/queue?players=2&rule=classic&rules=classic,items");
    expect(queuePathForPreset(onlinePresets[2])).toBe("/queue?players=2&rule=classic&rules=classic,no-repeat,no-opening-split");
    expect(queuePathForPreset(onlinePresets[4])).toBe("/queue?players=4&rule=classic&rules=classic,items");
  });
});
