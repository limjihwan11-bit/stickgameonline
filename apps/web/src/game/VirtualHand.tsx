import type { CSSProperties } from "react";
import type { TrackedHand } from "./useHandCamera";
import { mapCameraPointToStage } from "./gestureMapping";

const fingers = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

export function virtualHandPosition(hand: TrackedHand) {
  const palm = hand.landmarks[9] || hand.landmarks[0];
  return mapCameraPointToStage({ x: 1 - palm.x, y: palm.y });
}

export function VirtualHand({ hand }: { hand: TrackedHand }) {
  const palm = hand.landmarks[9] || hand.landmarks[0];
  const centerX = 1 - palm.x; const centerY = palm.y;
  const point = (index: number) => {
    const landmark = hand.landmarks[index];
    return `${50 + ((1 - landmark.x) - centerX) * 360},${62 + (landmark.y - centerY) * 360}`;
  };
  const position = virtualHandPosition(hand);
  const ready = position.y > .62;
  const striking = hand.speed > .72 && hand.vy < -.28;
  const style = { left: `${position.x * 100}%`, top: `${position.y * 100}%` } as CSSProperties;

  return <div className={`virtual-hand ${ready ? "ready" : ""} ${striking ? "striking" : ""}`} style={style} aria-hidden="true">
    <svg viewBox="0 0 100 124" role="presentation">
      <rect className="glove-cuff" x="34" y="88" width="32" height="22" rx="9" />
      <ellipse className="glove-palm-base" cx="50" cy="64" rx="22" ry="27" />
      <polygon className="hand-palm" points={[0, 5, 9, 13, 17].map(point).join(" ")} />
      <polyline className="finger-outline" points={[0, 1, 2, 3, 4].map(point).join(" ")} />
      <polyline className="finger-fill" points={[0, 1, 2, 3, 4].map(point).join(" ")} />
      {fingers.map((indices) => <g key={indices[0]}>
        <polyline className="finger-outline" points={indices.map(point).join(" ")} />
        <polyline className="finger-fill" points={indices.map(point).join(" ")} />
        <circle className="finger-tip" cx={point(indices[3]).split(",")[0]} cy={point(indices[3]).split(",")[1]} r="5.2" />
      </g>)}
      <circle className="finger-tip" cx={point(4).split(",")[0]} cy={point(4).split(",")[1]} r="5.2" />
      <g className="glove-face">
        <circle cx="44" cy="62" r="2" />
        <circle cx="56" cy="62" r="2" />
        <path d="M43 70 Q50 77 57 70" />
      </g>
    </svg>
    <b>{hand.fingers}</b><small>{ready ? "READY" : striking ? "STRIKE" : ""}</small>
  </div>;
}
