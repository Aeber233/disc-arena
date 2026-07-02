import type { GameState } from "./game";
import type { MapData } from "./map";
import type { Vec2 } from "../math/vec2";

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

export interface SimulationBodySnapshot {
  readonly id: string;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly spin: number;
  readonly alive: boolean;
  readonly sleep: boolean;
  readonly radius: number;
  readonly mass: number;
}

export interface SimulationEvent {
  readonly type: string;
  readonly step: number;
  readonly bodyIds?: readonly string[];
  readonly bodySnapshots?: readonly SimulationBodySnapshot[];
  readonly data?: Record<string, unknown>;
}

export interface SimulationFrame {
  readonly step: number;
  readonly state: GameState;
}

export interface SimulationResult {
  readonly initialState: GameState;
  readonly finalState: GameState;
  readonly finalMapData?: MapData;
  readonly events: readonly SimulationEvent[];
  readonly frames?: readonly SimulationFrame[];
  readonly resultHash: string;
}
