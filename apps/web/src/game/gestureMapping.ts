export interface UnitPoint { x: number; y: number }
export interface PixelRect { left: number; right: number; top: number; bottom: number }

export const CAMERA_HIT_MARGIN = 64;
export const CAMERA_READY_Y = .54;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function mapCameraPointToStage(point: UnitPoint): UnitPoint {
  const cameraX = clamp((point.x - .12) / (.88 - .12));
  const cameraY = clamp((point.y - .24) / (.86 - .24));
  return {
    x: .04 + cameraX * (.96 - .04),
    y: .05 + cameraY * (.92 - .05)
  };
}

export function isPointInExpandedRect(point: { x: number; y: number }, rect: PixelRect, margin = CAMERA_HIT_MARGIN) {
  return point.x >= rect.left - margin && point.x <= rect.right + margin
    && point.y >= rect.top - margin && point.y <= rect.bottom + margin;
}
