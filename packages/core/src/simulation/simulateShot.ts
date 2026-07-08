import { runEffectsForHook } from "../effects/effectRunner";
import { stepWorld } from "../physics/stepWorld";
import { allBodiesSleeping } from "../physics/systems/sleep";
import {
  createOutOfBoundsTracker,
  updateOutOfBoundsBodies
} from "../rules/outOfBounds";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { ShotIntent } from "../types/shot";
import type {
  SimulationBodySnapshot,
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
  const mapState = cloneMapData(mapData);
  const events: SimulationEvent[] = [];
  const frames: SimulationFrame[] = [];

  state.phase = "simulating";

  events.push(
    ...runEffectsForHook(state.effects, "onBeforeShot", {
      state,
      mapData: mapState,
      step: 0,
      bodyIds: [shotIntent.actorBodyId]
    }).events
  );
  events.push(...applyShotIntentToState(state, shotIntent, 0));
  events.push(
    ...runEffectsForHook(state.effects, "onAfterShotApplied", {
      state,
      mapData: mapState,
      step: 0,
      bodyIds: [shotIntent.actorBodyId]
    }).events
  );

  runMotionUntilStopped(state, mapState, options, 1, options.maxSteps, events, frames);

  const result: SimulationResult = {
    initialState,
    finalState: state,
    finalMapData: mapState,
    events,
    resultHash: hashGameState(state, options.quantize ?? false)
  };

  if (options.recordFrames) {
    return { ...result, frames };
  }

  return result;
}

export function continueSimulation(
  gameState: GameState,
  mapData: MapData,
  options: SimulationOptions,
  startStep: number
): SimulationResult {
  const initialState = cloneGameState(gameState);
  const state = cloneGameState(gameState);
  const mapState = cloneMapData(mapData);
  const events: SimulationEvent[] = [];
  const frames: SimulationFrame[] = [];

  state.phase = "simulating";
  runMotionUntilStopped(
    state,
    mapState,
    options,
    startStep + 1,
    startStep + options.maxSteps,
    events,
    frames
  );

  const result: SimulationResult = {
    initialState,
    finalState: state,
    finalMapData: mapState,
    events,
    resultHash: hashGameState(state, options.quantize ?? false)
  };

  if (options.recordFrames) {
    return { ...result, frames };
  }

  return result;
}

function runMotionUntilStopped(
  state: GameState,
  mapState: MapData,
  options: SimulationOptions,
  firstStep: number,
  lastStep: number,
  events: SimulationEvent[],
  frames: SimulationFrame[]
): void {
  const outOfBoundsTracker = createOutOfBoundsTracker();

  for (let step = firstStep; step <= lastStep; step += 1) {
    const stepResult = stepWorld(state, mapState, options, step);
    events.push(...withBodySnapshots(stepResult.events, state));
    const outOfBoundsEvents = updateOutOfBoundsBodies(
      state.bodies,
      mapState,
      outOfBoundsTracker,
      options.fixedDt,
      step
    );
    events.push(...withBodySnapshots(outOfBoundsEvents, state));

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
      mapData: mapState,
      step: events.at(-1)?.step ?? firstStep
    }).events
  );
  const finalStep = events.at(-1)?.step ?? firstStep;
  if (
    options.recordFrames &&
    (frames.length === 0 || frames.at(-1)?.step !== finalStep)
  ) {
    frames.push({ step: finalStep, state: cloneGameState(state) });
  }
}

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function cloneMapData(mapData: MapData): MapData {
  return JSON.parse(JSON.stringify(mapData)) as MapData;
}

function withBodySnapshots(
  events: readonly SimulationEvent[],
  state: GameState
): readonly SimulationEvent[] {
  return events.map((event) => {
    if (!shouldSnapshotEvent(event) || !event.bodyIds?.length) {
      return event;
    }

    return {
      ...event,
      bodySnapshots: event.bodyIds
        .map((bodyId) => state.bodies.find((body) => body.id === bodyId))
        .filter((body): body is GameState["bodies"][number] => body !== undefined)
        .map(snapshotBody)
    };
  });
}

function shouldSnapshotEvent(event: SimulationEvent): boolean {
  return (
    event.type === "collision" ||
    event.type === "wall_collision" ||
    event.type === "body_out_of_bounds"
  );
}

function snapshotBody(body: GameState["bodies"][number]): SimulationBodySnapshot {
  return {
    id: body.id,
    position: { ...body.position },
    velocity: { ...body.velocity },
    spin: body.spin,
    alive: body.alive,
    sleep: body.sleep,
    radius: body.radius,
    mass: body.mass
  };
}
