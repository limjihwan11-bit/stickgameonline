import { describe,expect,it } from "vitest";
import { calculateMotion, countFingers, isUpwardStrike } from "./useHandCamera";

describe("hand tracking helpers",()=>{
  it("returns zero fingers for incomplete input",()=>expect(countFingers([],"Right")).toBe(0));
  it("measures a fast upward strike",()=>{const motion=calculateMotion({x:.5,y:.8,time:0},{x:.5,y:.4},200);expect(motion.vy).toBeCloseTo(-2);expect(motion.speed).toBeCloseTo(2)});
  it("accepts gentle raised or sideways movement after arming",()=>{
    expect(isUpwardStrike({speed:.08,vy:-.05},true)).toBe(true);
    expect(isUpwardStrike({speed:.2,vy:.1},true)).toBe(true);
    expect(isUpwardStrike({speed:.2,vy:.1},false)).toBe(false);
    expect(isUpwardStrike({speed:.05,vy:.02},true)).toBe(false);
    expect(isUpwardStrike({speed:.4,vy:.3},true)).toBe(false);
  });
});
