import type { GameState } from "./game";

/**
 * Simulation contracts for authoritative settlement, playback, and fast bot
 * evaluation.
 */
export type SimulationMode = "authoritative" | "playback" | "fast_eval";

export interface SimulationOptions {
  readonly mode: SimulationMode;
  readonly fixedDt: number;
  readonly maxSteps: number;
  readonly collisionIterations: number;
  readonly recordFrames: boolean;
  readonly frameIntervalSteps: number;
  readonly quantize?: boolean;
}

export interface SimulationEvent {
  readonly type: string;
  readonly step: number;
  readonly bodyIds?: readonly string[];
  readonly data?: Record<string, unknown>;
}

export interface SimulationFrame {
  readonly step: number;
  readonly state: GameState;
}

export interface SimulationResult {
  readonly initialState: GameState;
  readonly finalState: GameState;
  readonly events: readonly SimulationEvent[];
  readonly frames?: readonly SimulationFrame[];
  readonly resultHash: string;
}
