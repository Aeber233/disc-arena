import { PHYSICS_POWER_SCALE } from "../physics/units";
import type { SimulationOptions } from "../types/simulation";

/**
 * Bot search limits and simple candidate tuning.
 */
export interface BotOptions {
  readonly maxCandidates: number;
  readonly maxThinkTimeMs: number;
  readonly powers: readonly number[];
  readonly spinOffsets: readonly number[];
  readonly rngSeed: number;
  readonly simulationOptions: SimulationOptions;
}

export const DEFAULT_BOT_OPTIONS: BotOptions = {
  maxCandidates: 24,
  maxThinkTimeMs: 25,
  powers: [20, 45, 70].map((power) => power * PHYSICS_POWER_SCALE),
  spinOffsets: [-0.5, 0, 0.5],
  rngSeed: 1,
  simulationOptions: {
    mode: "fast_eval",
    fixedDt: 1 / 30,
    maxSteps: 180,
    collisionIterations: 2,
    recordFrames: false,
    frameIntervalSteps: 5,
    quantize: true
  }
};

export function resolveBotOptions(options: Partial<BotOptions> = {}): BotOptions {
  return {
    ...DEFAULT_BOT_OPTIONS,
    ...options,
    simulationOptions: {
      ...DEFAULT_BOT_OPTIONS.simulationOptions,
      ...options.simulationOptions,
      mode: "fast_eval"
    }
  };
}
