import { length } from "../../math/vec2";
import type { BodyState } from "../../types/body";
import { PHYSICS_UNIT_SCALE } from "../units";

export interface SleepOptions {
  readonly speedSleepThreshold: number;
  readonly spinSleepThreshold: number;
}

export const DEFAULT_SLEEP_OPTIONS: SleepOptions = {
  speedSleepThreshold: 0.5 * PHYSICS_UNIT_SCALE,
  spinSleepThreshold: 0.02
};

export function isBodySleeping(
  body: BodyState,
  options: SleepOptions = DEFAULT_SLEEP_OPTIONS
): boolean {
  return (
    !body.alive ||
    (length(body.velocity) <= options.speedSleepThreshold &&
      Math.abs(body.spin) <= options.spinSleepThreshold)
  );
}

/**
 * Updates sleep flags after damping and trigger resolution.
 */
export function updateSleepState(
  bodies: BodyState[],
  options: SleepOptions = DEFAULT_SLEEP_OPTIONS
): void {
  for (const body of bodies) {
    body.sleep = isBodySleeping(body, options);
  }
}

export function allBodiesSleeping(
  bodies: readonly BodyState[],
  options: SleepOptions = DEFAULT_SLEEP_OPTIONS
): boolean {
  return bodies.every((body) => isBodySleeping(body, options));
}
