import type { BodyState } from "../../types/body";
import type { MapData } from "../../types/map";
import type { Portal, PortalPair } from "../../types/portal";
import type { SimulationEvent } from "../../types/simulation";
import { add, scale, sub } from "../../math/vec2";
import type { Vec2 } from "../../math/vec2";
import {
  isPointWithinPortalAperture,
  portalNormal,
  signedDistanceToPortalPlane,
  transformPointBetweenPortals,
  transformVectorBetweenPortals
} from "../proxies/portalTransforms";

/**
 * Commits center-line portal crossings after collision feedback has settled.
 */
export function commitPortalTransitions(
  bodies: BodyState[],
  mapData: MapData,
  step: number,
  previousPositions: ReadonlyMap<string, Vec2> = new Map()
): readonly SimulationEvent[] {
  const events: SimulationEvent[] = [];

  for (const body of bodies) {
    if (!body.alive) {
      continue;
    }

    const previousPosition = previousPositions.get(body.id) ?? body.position;
    const transition = findPortalTransition(body, previousPosition, mapData.portals);
    if (!transition) {
      continue;
    }

    const { pair, from, to, crossingPoint, exitSide } = transition;
    body.position = offsetExitPosition(
      transformPointBetweenPortals(body.position, from, to),
      to,
      body.radius,
      exitSide
    );
    body.velocity = transformVectorBetweenPortals(body.velocity, from, to);
    body.sleep = false;
    body.portalCooldown = {
      portalPairId: pair.id,
      exitPortalId: to.id,
      remainingSteps: 2
    };

    events.push({
      type: "portal_transition",
      step,
      bodyIds: [body.id],
      data: {
        portalPairId: pair.id,
        fromPortalId: from.id,
        toPortalId: to.id,
        crossingPoint
      }
    });
  }

  decrementPortalCooldowns(bodies);
  return events;
}

interface PortalTransition {
  readonly pair: PortalPair;
  readonly from: Portal;
  readonly to: Portal;
  readonly crossingPoint: Vec2;
  readonly exitSide: number;
}

function findPortalTransition(
  body: BodyState,
  previousPosition: Vec2,
  portalPairs: readonly PortalPair[]
): PortalTransition | undefined {
  for (const pair of portalPairs) {
    if (pair.enabled === false) {
      continue;
    }

    const aToB = portalTransitionForDirection(body, previousPosition, pair, pair.a, pair.b);
    if (aToB) {
      return aToB;
    }

    const bToA = portalTransitionForDirection(body, previousPosition, pair, pair.b, pair.a);
    if (bToA) {
      return bToA;
    }
  }

  return undefined;
}

function portalTransitionForDirection(
  body: BodyState,
  previousPosition: Vec2,
  pair: PortalPair,
  from: Portal,
  to: Portal
): PortalTransition | undefined {
  if (isPortalCooldownActive(body, pair.id, from.id)) {
    return undefined;
  }

  const previousDistance = signedDistanceToPortalPlane(previousPosition, from);
  const currentDistance = signedDistanceToPortalPlane(body.position, from);
  if (!crossedPortalPlane(previousDistance, currentDistance)) {
    return undefined;
  }

  const crossingPoint = planeCrossingPoint(
    previousPosition,
    body.position,
    previousDistance,
    currentDistance
  );
  if (!isPointWithinPortalAperture(crossingPoint, from)) {
    return undefined;
  }

  return {
    pair,
    from,
    to,
    crossingPoint,
    exitSide: previousDistance >= 0 ? 1 : -1
  };
}

function crossedPortalPlane(previousDistance: number, currentDistance: number): boolean {
  const epsilon = 0.000001;
  return (
    (previousDistance > epsilon && currentDistance <= epsilon) ||
    (previousDistance < -epsilon && currentDistance >= -epsilon)
  );
}

function planeCrossingPoint(
  previousPosition: Vec2,
  currentPosition: Vec2,
  previousDistance: number,
  currentDistance: number
): Vec2 {
  const denominator = previousDistance - currentDistance;
  if (Math.abs(denominator) <= 0.000001) {
    return { ...currentPosition };
  }
  const t = Math.max(0, Math.min(1, previousDistance / denominator));
  return add(previousPosition, scale(sub(currentPosition, previousPosition), t));
}

function offsetExitPosition(
  exitPosition: Vec2,
  exitPortal: Portal,
  radius: number,
  exitSide: number
): Vec2 {
  const exitDistance = signedDistanceToPortalPlane(exitPosition, exitPortal);
  if (Math.abs(exitDistance) > 0.000001) {
    return exitPosition;
  }
  return add(
    exitPosition,
    scale(portalNormal(exitPortal), exitSide * Math.max(1, radius * 0.02))
  );
}

function isPortalCooldownActive(
  body: BodyState,
  portalPairId: string,
  entryPortalId: string
): boolean {
  return (
    body.portalCooldown?.portalPairId === portalPairId &&
    body.portalCooldown.exitPortalId === entryPortalId &&
    body.portalCooldown.remainingSteps > 0
  );
}

function decrementPortalCooldowns(bodies: BodyState[]): void {
  for (const body of bodies) {
    if (!body.portalCooldown) {
      continue;
    }
    body.portalCooldown.remainingSteps -= 1;
    if (body.portalCooldown.remainingSteps <= 0) {
      body.portalCooldown = undefined;
    }
  }
}
