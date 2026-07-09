import type { CSSProperties } from "react";
import { FingerIcon } from "./FingerIcon";
import { isUpwardStrike, type TrackedHand } from "./useHandCamera";
import { CAMERA_READY_Y, mapCameraPointToStage } from "./gestureMapping";

export function virtualHandPosition(hand: TrackedHand) {
  const palm = hand.landmarks[9] || hand.landmarks[0];
  return mapCameraPointToStage({ x: 1 - palm.x, y: palm.y });
}

export function VirtualHand({ hand }: { hand: TrackedHand }) {
  const position = virtualHandPosition(hand);
  const ready = position.y > CAMERA_READY_Y;
  const striking = isUpwardStrike(hand, ready);
  const style = { left: `${position.x * 100}%`, top: `${position.y * 100}%` } as CSSProperties;

  return <div className={`virtual-hand ${ready ? "ready" : ""} ${striking ? "striking" : ""}`} style={style} aria-hidden="true">
    <FingerIcon value={hand.fingers} />
    <b>{hand.fingers}</b><small>{ready ? "READY" : striking ? "STRIKE" : ""}</small>
  </div>;
}
