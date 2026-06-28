import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { BodyProxy } from "../types/portal";
import type { SimulationEvent, SimulationOptions } from "../types/simulation";
import { terrainDampingMultiplierAtPoint } from "../map/editableMap";
import { solveCollisions } from "./collisions/solveCollisions";
import { commitPortalTransitions } from "./portals/commitPortalTransitions";
import { buildBodyProxies } from "./proxies/buildBodyProxies";
import { applyContinuousEffects } from "./systems/continuousEffects";
import { applyDamping } from "./systems/damping";
import { integratePosition, integrateVelocity } from "./systems/integrate";
import { updateSleepState } from "./systems/sleep";
import { applySpinCurve } from "./systems/spinCurve";
import { resolveTriggers } from "./triggers/resolveTriggers";

export interface StepWorldResult {
  readonly events: readonly SimulationEvent[];
}

/**
 * Runs one fixed simulation step in the core pipeline order.
 */
export function stepWorld(
  state: GameState,
  mapData: MapData,
  options: SimulationOptions,
  step: number
): StepWorldResult {
  const events: SimulationEvent[] = [];

  const proxies = buildBodyProxies(state.bodies, mapData);
  events.push(...applyContinuousEffects(state, mapData, step));
  applySpinCurve(state.bodies, options.fixedDt);
  integrateVelocity(state.bodies, options.fixedDt);
  integratePosition(state.bodies, options.fixedDt);

  syncPrimaryProxiesFromBodies(proxies, state.bodies);
  const collisionResult = solveCollisions(
    proxies,
    state.bodies,
    mapData,
    options.collisionIterations,
    options.fixedDt,
    step
  );
  events.push(...collisionResult.events);

  mapProxyImpulsesBackToBodies(collisionResult.proxies, state.bodies);
  events.push(...resolveTriggers(state.bodies, mapData, options.fixedDt, step));
  applyDamping(
    state.bodies,
    options.fixedDt,
    undefined,
    (body) => terrainDampingMultiplierAtPoint(mapData, body.position)
  );
  updateSleepState(state.bodies);
  events.push(...commitPortalTransitions(state.bodies, mapData, step));
  events.push(...collectEvents(state.bodies, step));

  return { events };
}

function syncPrimaryProxiesFromBodies(
  proxies: BodyProxy[],
  bodies: readonly BodyState[]
): void {
  for (const proxy of proxies) {
    if (proxy.kind !== "primary") {
      continue;
    }
    const body = bodies.find((candidate) => candidate.id === proxy.bodyId);
    if (!body) {
      continue;
    }
    proxy.position = { ...body.position };
    proxy.velocity = { ...body.velocity };
  }
}

export function mapProxyImpulsesBackToBodies(
  proxies: readonly BodyProxy[],
  bodies: BodyState[]
): void {
  for (const proxy of proxies) {
    if (proxy.kind !== "primary") {
      continue;
    }
    const body = bodies.find((candidate) => candidate.id === proxy.bodyId);
    if (!body) {
      continue;
    }
    body.position = { ...proxy.position };
    body.velocity = { ...proxy.velocity };
  }
}

function collectEvents(
  _bodies: readonly BodyState[],
  _step: number
): readonly SimulationEvent[] {
  return [];
}
