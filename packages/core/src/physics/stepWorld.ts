import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { BodyProxy } from "../types/portal";
import type { SimulationEvent, SimulationOptions } from "../types/simulation";
import { add, length, scale, sub } from "../math/vec2";
import { terrainDampingMultiplierAtPoint } from "../map/editableMap";
import { solveCollisions } from "./collisions/solveCollisions";
import { commitPortalTransitions } from "./portals/commitPortalTransitions";
import { buildBodyProxies } from "./proxies/buildBodyProxies";
import { transformVector } from "./proxies/portalTransforms";
import { applyContinuousEffects } from "./systems/continuousEffects";
import { applyDamping } from "./systems/damping";
import { integratePosition, integrateVelocity } from "./systems/integrate";
import { updateSleepState } from "./systems/sleep";
import { applySpinCurve } from "./systems/spinCurve";
import { resolveTriggers } from "./triggers/resolveTriggers";

export interface StepWorldResult {
  readonly events: readonly SimulationEvent[];
}

export interface ProxySnapshot {
  readonly position: BodyProxy["position"];
  readonly velocity: BodyProxy["velocity"];
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

  const previousPositions = snapshotBodyPositions(state.bodies);
  events.push(...applyContinuousEffects(state, mapData, step));
  applySpinCurve(state.bodies, options.fixedDt);
  integrateVelocity(state.bodies, options.fixedDt);
  integratePosition(state.bodies, options.fixedDt);

  const proxies = buildBodyProxies(state.bodies, mapData);
  const proxySnapshots = snapshotProxies(proxies);
  const collisionResult = solveCollisions(
    proxies,
    state.bodies,
    mapData,
    options.collisionIterations,
    options.fixedDt,
    step
  );
  events.push(...collisionResult.events);

  mapProxyImpulsesBackToBodies(collisionResult.proxies, state.bodies, proxySnapshots);
  events.push(...resolveTriggers(state.bodies, mapData, options.fixedDt, step));
  applyDamping(
    state.bodies,
    options.fixedDt,
    undefined,
    (body) => terrainDampingMultiplierAtPoint(mapData, body.position)
  );
  updateSleepState(state.bodies);
  events.push(...commitPortalTransitions(state.bodies, mapData, step, previousPositions));
  events.push(...collectEvents(state.bodies, step));

  return { events };
}

export function mapProxyImpulsesBackToBodies(
  proxies: readonly BodyProxy[],
  bodies: BodyState[],
  proxySnapshots?: ReadonlyMap<string, ProxySnapshot>
): void {
  if (!proxySnapshots) {
    mapPrimaryProxiesBackToBodies(proxies, bodies);
    return;
  }

  for (const body of bodies) {
    const bodyProxies = proxies.filter((proxy) => proxy.bodyId === body.id);
    if (bodyProxies.length === 0) {
      continue;
    }

    let velocityDelta = { x: 0, y: 0 };
    let positionDelta = { x: 0, y: 0 };
    let positionDeltaCount = 0;

    for (const proxy of bodyProxies) {
      const baseline = proxySnapshots.get(proxy.proxyId);
      if (!baseline) {
        continue;
      }

      const proxyPositionDelta = sub(proxy.position, baseline.position);
      const proxyVelocityDelta = sub(proxy.velocity, baseline.velocity);
      const bodyPositionDelta =
        proxy.kind === "portal_shadow"
          ? transformVector(proxyPositionDelta, proxy.transformToBody)
          : proxyPositionDelta;
      const bodyVelocityDelta =
        proxy.kind === "portal_shadow"
          ? transformVector(proxyVelocityDelta, proxy.transformToBody)
          : proxyVelocityDelta;

      if (length(bodyPositionDelta) > 0) {
        positionDelta = add(positionDelta, bodyPositionDelta);
        positionDeltaCount += 1;
      }
      velocityDelta = add(velocityDelta, bodyVelocityDelta);
    }

    if (positionDeltaCount > 0) {
      body.position = add(body.position, scale(positionDelta, 1 / positionDeltaCount));
    }
    body.velocity = add(body.velocity, velocityDelta);
  }
}

function mapPrimaryProxiesBackToBodies(
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

function snapshotBodyPositions(
  bodies: readonly BodyState[]
): ReadonlyMap<string, BodyState["position"]> {
  const positions = new Map<string, BodyState["position"]>();
  for (const body of bodies) {
    positions.set(body.id, { ...body.position });
  }
  return positions;
}

function snapshotProxies(proxies: readonly BodyProxy[]): ReadonlyMap<string, ProxySnapshot> {
  const snapshots = new Map<string, ProxySnapshot>();
  for (const proxy of proxies) {
    snapshots.set(proxy.proxyId, {
      position: { ...proxy.position },
      velocity: { ...proxy.velocity }
    });
  }
  return snapshots;
}

function collectEvents(
  _bodies: readonly BodyState[],
  _step: number
): readonly SimulationEvent[] {
  return [];
}
