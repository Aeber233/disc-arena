import type { GameState } from "./game";
import type { ShotIntent } from "./shot";
import type { SimulationEvent } from "./simulation";

/**
 * Future low-bandwidth shot settlement payload.
 */
export interface ShotResolvedPayload {
  readonly shotId: string;
  readonly initialStateHash: string;
  readonly shotIntent: ShotIntent;
  readonly finalState: GameState;
  readonly events: readonly SimulationEvent[];
  readonly resultHash: string;
}
