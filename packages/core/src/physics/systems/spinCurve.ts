import { add, length, normalize, rotate, scale } from "../../math/vec2";
import type { BodyState } from "../../types/body";

const SPIN_CURVE_ACCELERATION = 0.015;

/**
 * Game-feel spin model: spin bends velocity by applying a small side
 * acceleration. It is not intended to be physically exact.
 */
export function applySpinCurve(bodies: BodyState[], fixedDt: number): void {
  for (const body of bodies) {
    if (!body.alive || body.sleep) {
      continue;
    }

    const speed = length(body.velocity);
    if (speed === 0 || body.spin === 0) {
      continue;
    }

    const side = body.spin > 0 ? 1 : -1;
    const direction = rotate(normalize(body.velocity), side * Math.PI * 0.5);
    const spinStrength = Math.abs(body.spin);
    const acceleration =
      spinStrength * spinStrength * body.spinControl * SPIN_CURVE_ACCELERATION;

    body.velocity = add(body.velocity, scale(direction, acceleration * fixedDt));
    body.spin *= Math.max(0, 1 - body.damping * fixedDt * 0.5);
  }
}
