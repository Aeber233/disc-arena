import { runEffectsForHook } from "../../effects/effectRunner";
import type { GameState } from "../../types/game";
import type { MapData } from "../../types/map";
import type { SimulationEvent } from "../../types/simulation";

/**
 * Dispatches continuous physics-step effects without embedding rule behavior
 * into the physics loop.
 */
export function applyContinuousEffects(
  state: GameState,
  mapData: MapData,
  step: number
): readonly SimulationEvent[] {
  return runEffectsForHook(state.effects, "onPhysicsStep", {
    state,
    mapData,
    step
  }).events;
}
