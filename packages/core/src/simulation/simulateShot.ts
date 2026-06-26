import { runEffectsForHook } from "../effects/effectRunner";
import { stepWorld } from "../physics/stepWorld";
import { allBodiesSleeping } from "../physics/systems/sleep";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { ShotIntent } from "../types/shot";
import type {
  SimulationEvent,
  SimulationFrame,
  SimulationOptions,
  SimulationResult
} from "../types/simulation";
import { hashGameState } from "./hash";
import { applyShotIntentToState } from "./shotPhysics";

/**
 * Simulates a single turn shot with the shared core pipeline.
 */
export function simulateShot(
  gameState: GameState,
  mapData: MapData,
  shotIntent: ShotIntent,
  options: SimulationOptions
): SimulationResult {
  const initialState = cloneGameState(gameState);
  const state = cloneGameState(gameState);
  const events: SimulationEvent[] = [];
  const frames: SimulationFrame[] = [];

  state.phase = "simulating";

  events.push(
    ...runEffectsForHook(state.effects, "onBeforeShot", {
      state,
      mapData,
      step: 0,
      bodyIds: [shotIntent.actorBodyId]
    }).events
  );
  events.push(...applyShotIntentToState(state, shotIntent, 0));
  events.push(
    ...runEffectsForHook(state.effects, "onAfterShotApplied", {
      state,
      mapData,
      step: 0,
      bodyIds: [shotIntent.actorBodyId]
    }).events
  );

  for (let step = 1; step <= options.maxSteps; step += 1) {
    const stepResult = stepWorld(state, mapData, options, step);
    events.push(...stepResult.events);

    if (
      options.recordFrames &&
      options.frameIntervalSteps > 0 &&
      step % options.frameIntervalSteps === 0
    ) {
      frames.push({ step, state: cloneGameState(state) });
    }

    if (allBodiesSleeping(state.bodies)) {
      events.push({ type: "simulation_stopped", step, data: { reason: "sleep" } });
      break;
    }
  }

  state.phase = state.winnerTeamId ? "finished" : "turn_ending";
  events.push(
    ...runEffectsForHook(state.effects, "onSimulationEnd", {
      state,
      mapData,
      step: events.at(-1)?.step ?? 0
    }).events
  );

  const result: SimulationResult = {
    initialState,
    finalState: state,
    events,
    resultHash: hashGameState(state, options.quantize ?? false)
  };

  if (options.recordFrames) {
    return { ...result, frames };
  }

  return result;
}

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
