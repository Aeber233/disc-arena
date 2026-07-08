import type { SimulationOptions } from "../types/simulation";
import type { ShrinkCircleState } from "../rules/shrinkCircle";

/**
 * Bot search limits and simple candidate tuning.
 */
export interface BotOptions {
  /**
   * Number of random shots to sample. Direct ring-out opportunities are added
   * on top of this count.
   */
  readonly maxCandidates: number;
  readonly maxThinkTimeMs: number;
  readonly rngSeed: number;
  readonly simulationOptions: SimulationOptions;
  readonly shrinkCircle?: ShrinkCircleState;
}

export const DEFAULT_BOT_OPTIONS: BotOptions = {
  maxCandidates: 40,
  maxThinkTimeMs: 80,
  rngSeed: 1,
  simulationOptions: {
    mode: "fast_eval",
    fixedDt: 1 / 30,
    maxSteps: 240,
    collisionIterations: 1,
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
