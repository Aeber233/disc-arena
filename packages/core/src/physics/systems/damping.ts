import { length, scale } from "../../math/vec2";
import type { BodyState } from "../../types/body";
import { PHYSICS_UNIT_SCALE } from "../units";

export interface DampingOptions {
  readonly speedZeroThreshold: number;
  readonly spinZeroThreshold: number;
  readonly quickStopSpeedThreshold: number;
  readonly quickStopDeceleration: number;
  readonly quickStopMaxFractionPerStep: number;
}

export type DampingMultiplierForBody = (body: BodyState) => number;

export const DEFAULT_DAMPING_OPTIONS: DampingOptions = {
  speedZeroThreshold: 0.5 * PHYSICS_UNIT_SCALE,
  spinZeroThreshold: 0.02,
  quickStopSpeedThreshold: 40 * PHYSICS_UNIT_SCALE,
  quickStopDeceleration: 220 * PHYSICS_UNIT_SCALE,
  quickStopMaxFractionPerStep: 0.65
};

/**
 * Applies per-body damping. Low-speed bodies enter a strong braking band so
 * they settle quickly without snapping to zero the instant they cross it.
 */
export function applyDamping(
  bodies: BodyState[],
  fixedDt: number,
  options: DampingOptions = DEFAULT_DAMPING_OPTIONS,
  dampingMultiplierForBody?: DampingMultiplierForBody
): void {
  for (const body of bodies) {
    if (!body.alive) {
      body.velocity = { x: 0, y: 0 };
      body.spin = 0;
      continue;
    }

    const dampingMultiplier = Math.max(0, dampingMultiplierForBody?.(body) ?? 1);
    const dampingFactor = Math.max(0, 1 - body.damping * dampingMultiplier * fixedDt);
    body.velocity = scale(body.velocity, dampingFactor);
    body.spin *= dampingFactor;

    body.velocity = applyQuickStopBraking(body.velocity, fixedDt, options);

    if (length(body.velocity) <= options.speedZeroThreshold) {
      body.velocity = { x: 0, y: 0 };
    }

    if (Math.abs(body.spin) < options.spinZeroThreshold) {
      body.spin = 0;
    }
  }
}

function applyQuickStopBraking(
  velocity: { readonly x: number; readonly y: number },
  fixedDt: number,
  options: DampingOptions
) {
  const speed = length(velocity);
  if (speed === 0 || speed > options.quickStopSpeedThreshold) {
    return velocity;
  }

  const brakingAmount = Math.min(
    options.quickStopDeceleration * fixedDt,
    speed * options.quickStopMaxFractionPerStep
  );
  const nextSpeed = Math.max(0, speed - brakingAmount);
  return scale(velocity, nextSpeed / speed);
}
