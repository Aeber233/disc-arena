import { add, dot, length, scale, sub } from "../../math/vec2";
import type { Vec2 } from "../../math/vec2";
import type { BodyState } from "../../types/body";
import type { MapData, StaticWallCollider } from "../../types/map";
import type { BodyProxy, ClipMask } from "../../types/portal";
import type { SimulationEvent } from "../../types/simulation";

export interface CollisionSolveResult {
  readonly proxies: BodyProxy[];
  readonly events: readonly SimulationEvent[];
}

/**
 * Collision solver for circle proxies and static wall segments. Portal proxies
 * use clip masks so only their visible half can produce contact feedback.
 */
export function solveCollisions(
  proxies: BodyProxy[],
  _bodies: readonly BodyState[],
  mapData: MapData,
  collisionIterations: number,
  fixedDt: number,
  step: number
): CollisionSolveResult {
  const events: SimulationEvent[] = [];
  const emittedPairs = new Set<string>();
  const emittedWalls = new Set<string>();
  const iterations = Math.max(1, collisionIterations);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let i = 0; i < proxies.length; i += 1) {
      const a = proxies[i];
      if (!a) {
        continue;
      }

      for (let j = i + 1; j < proxies.length; j += 1) {
        const b = proxies[j];
        if (!b || a.bodyId === b.bodyId) {
          continue;
        }

        const pairEvents = solveProxyPair(a, b, step, emittedPairs);
        events.push(...pairEvents);
      }
    }

    for (const proxy of proxies) {
      events.push(...solveWallCollisions(proxy, mapData, fixedDt, step, emittedWalls));
    }
  }

  return { proxies, events };
}

function solveProxyPair(
  a: BodyProxy,
  b: BodyProxy,
  step: number,
  emittedPairs: Set<string>
): readonly SimulationEvent[] {
  const delta = sub(b.position, a.position);
  const distance = length(delta);
  const minDistance = a.radius + b.radius;

  if (distance >= minDistance) {
    return [];
  }

  const normal = distance === 0 ? { x: 1, y: 0 } : scale(delta, 1 / distance);
  const penetration = minDistance - distance;
  const contactPoint = add(a.position, scale(normal, a.radius - penetration / 2));
  if (
    !isPointAllowedByClipMask(contactPoint, a.clipMask) ||
    !isPointAllowedByClipMask(contactPoint, b.clipMask)
  ) {
    return [];
  }
  const inverseMassA = a.mass > 0 ? 1 / a.mass : 0;
  const inverseMassB = b.mass > 0 ? 1 / b.mass : 0;
  const inverseMassTotal = inverseMassA + inverseMassB;

  if (inverseMassTotal > 0) {
    a.position = add(
      a.position,
      scale(normal, (-penetration * inverseMassA) / inverseMassTotal)
    );
    b.position = add(
      b.position,
      scale(normal, (penetration * inverseMassB) / inverseMassTotal)
    );
  }

  const collisionApplied = applyElasticBodyCollision(a, b, normal);

  const pairKey = [a.bodyId, b.bodyId].sort().join(":");
  if (emittedPairs.has(pairKey)) {
    return [];
  }
  emittedPairs.add(pairKey);

  return [
    {
      type: "collision",
      step,
      bodyIds: [a.bodyId, b.bodyId],
      data: {
        penetration,
        collisionModel: "elastic_conservation",
        collisionApplied,
        massA: a.mass,
        massB: b.mass
      }
    }
  ];
}

function applyElasticBodyCollision(
  a: BodyProxy,
  b: BodyProxy,
  normal: Vec2
): boolean {
  if (a.mass <= 0 || b.mass <= 0) {
    return false;
  }

  const tangent = { x: -normal.y, y: normal.x };
  const velocityA = decomposeVelocity(a.velocity, normal, tangent);
  const velocityB = decomposeVelocity(b.velocity, normal, tangent);
  const closingSpeed = velocityA.normal - velocityB.normal;

  if (closingSpeed <= 0) {
    return false;
  }

  const totalMass = a.mass + b.mass;
  const nextNormalA =
    ((a.mass - b.mass) * velocityA.normal + 2 * b.mass * velocityB.normal) /
    totalMass;
  const nextNormalB =
    ((b.mass - a.mass) * velocityB.normal + 2 * a.mass * velocityA.normal) /
    totalMass;

  a.velocity = composeVelocity(nextNormalA, velocityA.tangent, normal, tangent);
  b.velocity = composeVelocity(nextNormalB, velocityB.tangent, normal, tangent);
  return true;
}

function decomposeVelocity(velocity: Vec2, normal: Vec2, tangent: Vec2) {
  return {
    normal: dot(velocity, normal),
    tangent: dot(velocity, tangent)
  };
}

function composeVelocity(
  normalSpeed: number,
  tangentSpeed: number,
  normal: Vec2,
  tangent: Vec2
): Vec2 {
  return add(scale(normal, normalSpeed), scale(tangent, tangentSpeed));
}

function solveWallCollisions(
  proxy: BodyProxy,
  mapData: MapData,
  fixedDt: number,
  step: number,
  emittedWalls: Set<string>
): readonly SimulationEvent[] {
  const events: SimulationEvent[] = [];

  for (const collider of mapData.colliders) {
    if (collider.type !== "static_wall") {
      continue;
    }

    const event = solveWallCollision(proxy, collider, fixedDt, step, emittedWalls);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

function solveWallCollision(
  proxy: BodyProxy,
  wall: StaticWallCollider,
  fixedDt: number,
  step: number,
  emittedWalls: Set<string>
): SimulationEvent | undefined {
  const closest = closestPointOnSegment(proxy.position, wall.start, wall.end);
  if (!isPointAllowedByClipMask(closest, proxy.clipMask)) {
    return undefined;
  }

  const offset = sub(proxy.position, closest);
  const distanceToWall = length(offset);

  if (distanceToWall >= proxy.radius) {
    return undefined;
  }

  const normal = wallNormal(proxy, wall, fixedDt, offset, distanceToWall);
  const signedDistance = dot(offset, normal);
  const penetration = proxy.radius - signedDistance;
  proxy.position = add(proxy.position, scale(normal, penetration));

  const velocityAlongNormal = dot(proxy.velocity, normal);
  if (velocityAlongNormal < 0) {
    const restitution = wall.restitution ?? 1;
    proxy.velocity = sub(
      proxy.velocity,
      scale(normal, (1 + restitution) * velocityAlongNormal)
    );
  }

  const wallKey = `${proxy.proxyId}:${wall.id}`;
  if (emittedWalls.has(wallKey)) {
    return undefined;
  }
  emittedWalls.add(wallKey);

  return {
    type: "wall_collision",
    step,
    bodyIds: [proxy.bodyId],
    data: {
      wallId: wall.id,
      collisionPoint: closest,
      material: wall.material,
      penetration,
      restitution: wall.restitution ?? 1
    }
  };
}

function closestPointOnSegment(point: Vec2, start: Vec2, end: Vec2): Vec2 {
  const segment = sub(end, start);
  const segmentLengthSquared = dot(segment, segment);

  if (segmentLengthSquared === 0) {
    return { ...start };
  }

  const t = clamp(dot(sub(point, start), segment) / segmentLengthSquared, 0, 1);
  return add(start, scale(segment, t));
}

function wallNormal(
  proxy: BodyProxy,
  wall: StaticWallCollider,
  fixedDt: number,
  offset: Vec2,
  distanceToWall: number
): Vec2 {
  const wallVector = sub(wall.end, wall.start);
  const candidate = { x: -wallVector.y, y: wallVector.x };
  const candidateLength = length(candidate);
  const unit =
    candidateLength === 0 ? { x: 1, y: 0 } : scale(candidate, 1 / candidateLength);

  const previousPosition = sub(proxy.position, scale(proxy.velocity, fixedDt));
  const previousClosest = closestPointOnSegment(previousPosition, wall.start, wall.end);
  const previousOffset = sub(previousPosition, previousClosest);
  const previousSignedDistance = dot(previousOffset, unit);

  if (Math.abs(previousSignedDistance) > 0.000001) {
    return previousSignedDistance >= 0 ? unit : scale(unit, -1);
  }

  if (distanceToWall > 0) {
    const currentSide = dot(offset, unit);
    if (Math.abs(currentSide) > 0.000001) {
      return currentSide >= 0 ? unit : scale(unit, -1);
    }
  }

  return dot(proxy.velocity, unit) <= 0 ? unit : scale(unit, -1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isPointAllowedByClipMask(point: Vec2, clipMask?: ClipMask): boolean {
  if (!clipMask?.halfPlanes?.length) {
    return true;
  }

  return clipMask.halfPlanes.every(
    (halfPlane) => dot(sub(point, halfPlane.point), halfPlane.normal) >= -0.000001
  );
}
