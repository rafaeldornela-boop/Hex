export interface ScreenPoint {
  x: number;
  y: number;
}

export const TOUCH_TAP_MAX_MOVEMENT_PX = 12;
export const TOUCH_TAP_MAX_DURATION_MS = 380;
export const PINCH_MIN_DISTANCE_PX = 12;
export const TWIST_DEADZONE_RAD = 0.015;

export function pointDistance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pointMidpoint(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  };
}

export function pointAngle(a: ScreenPoint, b: ScreenPoint): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Shortest signed angular difference in [-PI, PI].
 */
export function normalizeAngleDelta(deltaRad: number): number {
  let d = deltaRad;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function isCleanTap(
  start: ScreenPoint,
  end: ScreenPoint,
  elapsedMs: number,
  hadMultiTouch: boolean
): boolean {
  if (hadMultiTouch) return false;
  if (elapsedMs > TOUCH_TAP_MAX_DURATION_MS) return false;
  return pointDistance(start, end) <= TOUCH_TAP_MAX_MOVEMENT_PX;
}

export interface TwoFingerGestureDelta {
  zoomDelta: number;
  yawDeltaRad: number;
  panScreenDx: number;
  panScreenDy: number;
}

/**
 * Computes simultaneous pinch zoom, two-finger twist rotation, and midpoint pan
 * from previous and current two-finger positions.
 */
export function computeTwoFingerGestureDelta(
  prevA: ScreenPoint,
  prevB: ScreenPoint,
  currA: ScreenPoint,
  currB: ScreenPoint,
  currentCamDistance: number
): TwoFingerGestureDelta {
  const prevDist = Math.max(pointDistance(prevA, prevB), PINCH_MIN_DISTANCE_PX);
  const currDist = Math.max(pointDistance(currA, currB), PINCH_MIN_DISTANCE_PX);
  const scaleRatio = prevDist / currDist;

  // Positive zoomDelta moves camera further away; negative zooms in
  const rawZoomDelta = (scaleRatio - 1) * currentCamDistance * 1.15;
  const zoomDelta = Math.max(-2.2, Math.min(2.2, rawZoomDelta));

  const prevAngle = pointAngle(prevA, prevB);
  const currAngle = pointAngle(currA, currB);
  const rawAngleDelta = normalizeAngleDelta(currAngle - prevAngle);
  const yawDeltaRad =
    Math.abs(rawAngleDelta) >= TWIST_DEADZONE_RAD ? -rawAngleDelta * 0.85 : 0;

  const prevMid = pointMidpoint(prevA, prevB);
  const currMid = pointMidpoint(currA, currB);

  return {
    zoomDelta,
    yawDeltaRad,
    panScreenDx: currMid.x - prevMid.x,
    panScreenDy: currMid.y - prevMid.y,
  };
}

/**
 * Converts a screen drag delta (in CSS pixels) into a world XZ ground pan delta
 * aligned with the current camera yaw and scaled cleanly to camera distance and viewport size.
 */
export function screenPanToWorldDelta(
  screenDx: number,
  screenDy: number,
  viewportHeight: number,
  camDistance: number,
  camYaw: number
): { dx: number; dz: number } {
  const safeHeight = Math.max(viewportHeight, 320);
  // Dragging finger right pulls world right -> camera target moves left
  const worldUnitsPerPixel = (camDistance * 0.78) / safeHeight;
  const localX = -screenDx * worldUnitsPerPixel;
  const localZ = -screenDy * worldUnitsPerPixel * 1.32;

  const cosY = Math.cos(camYaw);
  const sinY = Math.sin(camYaw);

  return {
    dx: localX * cosY + localZ * sinY,
    dz: -localX * sinY + localZ * cosY,
  };
}
