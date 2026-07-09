import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { VirtualHand, virtualHandPosition } from "./VirtualHand";
import type { TrackedHand } from "./useHandCamera";

const landmarks = Array.from({ length: 21 }, (_, index) => ({
  x: .5 + ((index % 4) - 1.5) * .018,
  y: .62 - Math.floor(index / 4) * .035,
  z: 0,
  visibility: 1
})) as NormalizedLandmark[];

const hand: TrackedHand = { hand: 0, x: .5, y: .62, fingers: 3, vx: 0, vy: 0, speed: 0, landmarks };

describe("virtual hand", () => {
  it("renders a finger token without landmark silhouette details", () => {
    const { container } = render(<VirtualHand hand={hand} />);
    expect(container.querySelectorAll(".finger-icon-3")).toHaveLength(1);
    expect(container.querySelectorAll(".hand-palm")).toHaveLength(0);
    expect(container.querySelectorAll(".finger-fill")).toHaveLength(0);
    expect(container.querySelectorAll(".finger-tip")).toHaveLength(0);
    expect(container.querySelectorAll(".glove-cuff")).toHaveLength(0);
    expect(container.querySelectorAll(".glove-face")).toHaveLength(0);
  });

  it("uses the calibrated palm position", () => {
    const position = virtualHandPosition(hand);
    expect(position.x).toBeGreaterThan(.45);
    expect(position.x).toBeLessThan(.55);
    expect(position.y).toBeGreaterThan(.45);
    expect(position.y).toBeLessThan(.55);
  });
});
