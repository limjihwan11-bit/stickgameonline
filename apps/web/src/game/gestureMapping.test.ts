import { describe, expect, it } from "vitest";
import { CAMERA_HIT_MARGIN, CAMERA_READY_Y, isPointInExpandedRect, mapCameraPointToStage } from "./gestureMapping";

describe("camera to stage mapping", () => {
  it("maps the comfortable camera range to almost the full board", () => {
    expect(mapCameraPointToStage({ x: .12, y: .24 })).toEqual({ x: .04, y: .05 });
    expect(mapCameraPointToStage({ x: .88, y: .86 })).toEqual({ x: .96, y: .92 });
  });

  it("clamps points outside the calibrated range", () => {
    expect(mapCameraPointToStage({ x: -1, y: -1 })).toEqual({ x: .04, y: .05 });
    expect(mapCameraPointToStage({ x: 2, y: 2 })).toEqual({ x: .96, y: .92 });
  });

  it("makes a comfortable raised hand reach the opponent band", () => {
    expect(mapCameraPointToStage({ x: .5, y: .35 }).y).toBeLessThan(.25);
    expect(mapCameraPointToStage({ x: .5, y: .6 }).y).toBeGreaterThan(CAMERA_READY_Y);
  });

  it("adds camera-only hit slop around a hand card", () => {
    const rect = { left: 100, right: 200, top: 50, bottom: 130 };
    expect(CAMERA_HIT_MARGIN).toBe(64);
    expect(isPointInExpandedRect({ x: 36, y: 45 }, rect)).toBe(true);
    expect(isPointInExpandedRect({ x: 35, y: 45 }, rect)).toBe(false);
  });
});
