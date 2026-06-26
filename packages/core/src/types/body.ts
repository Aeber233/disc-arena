import type { Vec2 } from "../math/vec2";
import type { ActiveModifier } from "./effect";

/**
 * Dynamic physical objects controlled by the simulation.
 */
export type BodyKind =
  | "disc"
  | "bomb"
  | "gravity_bomb"
  | "dynamic_obstacle"
  | "destructible_obstacle";

export interface BodyState {
  readonly id: string;
  readonly kind: BodyKind;
  readonly ownerPlayerId?: string;
  readonly teamId?: string;
  position: Vec2;
  velocity: Vec2;
  readonly radius: number;
  readonly mass: number;
  readonly damping: number;
  spin: number;
  readonly spinControl: number;
  alive: boolean;
  sleep: boolean;
  hp?: number;
  readonly breakThreshold?: number;
  readonly tags: readonly string[];
  readonly modifiers: readonly ActiveModifier[];
}
