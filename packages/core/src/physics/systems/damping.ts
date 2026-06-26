import { length, scale } from "../../math/vec2";
import type { BodyState } from "../../types/body";

export interface DampingOptions {
  readonly speedZeroThreshold: number;
  readonly spinZeroThreshold: number;
}

export const DEFAULT_DAMPING_OPTIONS: DampingOptions = {
  speedZeroThreshold: 0.01,
  spinZeroThreshold: 0.001
};

/**
 * Applies per-body damping to velocity and spin, then zeros tiny residuals.
 */
export function applyDamping(
  bodies: BodyState[],
  fixedDt: number,
  options: DampingOptions = DEFAULT_DAMPING_OPTIONS
): void {
  for (const body of bodies) {
    if (!body.alive) {
      body.velocity = { x: 0, y: 0 };
      body.spin = 0;
      continue;
    }

    const dampingFactor = Math.max(0, 1 - body.damping * fixedDt);
    body.velocity = scale(body.velocity, dampingFactor);
    body.spin *= dampingFactor;

    if (length(body.velocity) < options.speedZeroThreshold) {
      body.velocity = { x: 0, y: 0 };
    }

    if (Math.abs(body.spin) < options.spinZeroThreshold) {
      body.spin = 0;
    }
  }
}
