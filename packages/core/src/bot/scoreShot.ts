import {
  add,
  distance,
  dot,
  fromAngle,
  scale,
  sub
} from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import { isPointPlayableOnMap } from "../map/editableMap";
import { PIXEL_BODY_UNIT } from "../map/pixelBodySizes";
import type { BodyState } from "../types/body";
import type { MapCollider, MapData } from "../types/map";
import type { SimulationResult } from "../types/simulation";
import type { ShrinkCircleState } from "../rules/shrinkCircle";
import { dangerScore } from "./dangerScore";

const ENEMY_ELIMINATION_SCORE = 1400;
const OWN_ELIMINATION_PENALTY = 1800;
const OWN_PICKUP_SCORE = 260;
const ENEMY_PICKUP_PENALTY = 160;
const ENEMY_OUT_DISTANCE_FACTOR = 8;
const OWN_OUT_DISTANCE_FACTOR = 10;
const ENEMY_SHRINK_ENTRY_SCORE = 900;
const OWN_SHRINK_ENTRY_PENALTY = 1200;
const OWN_CENTER_DISTANCE_FACTOR = 5;
const MAX_DISTANCE_DELTA_PIXELS = 220;
const OUT_RAY_COUNT = 32;

/**
 * Scores a simulated shot by eliminations, out-area pressure, and pickup value.
 */
export function scoreShot(
  result: SimulationResult,
  mapData: MapData,
  actorBodyId: string,
  shrinkCircle?: ShrinkCircleState
): number {
  const initialActor = findBody(result.initialState.bodies, actorBodyId);
  const actorPlayerId = initialActor?.ownerPlayerId;
  const actorTeamId = initialActor?.teamId;
  let score = 0;

  for (const initialBody of result.initialState.bodies) {
    const finalBody = findBody(result.finalState.bodies, initialBody.id);
    if (!initialBody.alive || finalBody?.alive !== false) {
      continue;
    }

    score += initialBody.ownerPlayerId === actorPlayerId
      ? -OWN_ELIMINATION_PENALTY
      : ENEMY_ELIMINATION_SCORE;
  }

  score += pickupScore(result, actorPlayerId);
  score += outDistanceScore(result, mapData, actorPlayerId);
  score += shrinkScore(result, actorPlayerId, shrinkCircle);
  score += dangerScore(result.finalState, mapData, actorTeamId);
  return score;
}

function pickupScore(result: SimulationResult, actorPlayerId?: string): number {
  let score = 0;
  for (const event of result.events) {
    if (event.type !== "pickup_collected") {
      continue;
    }
    const playerId = typeof event.data?.playerId === "string" ? event.data.playerId : undefined;
    score += playerId === actorPlayerId ? OWN_PICKUP_SCORE : -ENEMY_PICKUP_PENALTY;
  }
  return score;
}

function outDistanceScore(
  result: SimulationResult,
  mapData: MapData,
  actorPlayerId?: string
): number {
  let score = 0;
  for (const bodyId of movedBodyIds(result)) {
    const initialBody = findBody(result.initialState.bodies, bodyId);
    const finalBody = findBody(result.finalState.bodies, bodyId);
    if (!initialBody || !finalBody || !initialBody.alive) {
      continue;
    }

    const initialDistance = nearestOutAreaDistance(mapData, initialBody.position, initialBody.radius);
    const finalDistance = finalBody.alive
      ? nearestOutAreaDistance(mapData, finalBody.position, finalBody.radius)
      : 0;
    const deltaPixels = distanceDeltaPixels(initialDistance, finalDistance);
    if (deltaPixels === 0) {
      continue;
    }

    score += initialBody.ownerPlayerId === actorPlayerId
      ? -deltaPixels * OWN_OUT_DISTANCE_FACTOR
      : deltaPixels * ENEMY_OUT_DISTANCE_FACTOR;
  }
  return score;
}

function shrinkScore(
  result: SimulationResult,
  actorPlayerId?: string,
  shrinkCircle?: ShrinkCircleState
): number {
  if (!shrinkCircle?.enabled) {
    return 0;
  }

  let score = 0;
  for (const bodyId of movedBodyIds(result)) {
    const initialBody = findBody(result.initialState.bodies, bodyId);
    const finalBody = findBody(result.finalState.bodies, bodyId);
    if (!initialBody || !finalBody || !initialBody.alive) {
      continue;
    }

    const isOwn = initialBody.ownerPlayerId === actorPlayerId;
    if (isOwn) {
      const initialCenterDistance = distance(initialBody.position, shrinkCircle.center);
      const finalCenterDistance = finalBody.alive
        ? distance(finalBody.position, shrinkCircle.center)
        : initialCenterDistance;
      const deltaPixels = clampDeltaPixels(
        (initialCenterDistance - finalCenterDistance) / PIXEL_BODY_UNIT
      );
      score += deltaPixels * OWN_CENTER_DISTANCE_FACTOR;
    }

    if (!shrinkCircle.active) {
      continue;
    }

    const enteredShrink =
      !bodyInShrinkArea(initialBody, shrinkCircle) &&
      bodyInShrinkArea(finalBody, shrinkCircle);
    if (!enteredShrink) {
      continue;
    }
    score += isOwn ? -OWN_SHRINK_ENTRY_PENALTY : ENEMY_SHRINK_ENTRY_SCORE;
  }
  return score;
}

function movedBodyIds(result: SimulationResult): Set<string> {
  const ids = new Set<string>();
  for (const event of result.events) {
    for (const bodyId of event.bodyIds ?? []) {
      ids.add(bodyId);
    }
  }

  for (const initialBody of result.initialState.bodies) {
    const finalBody = findBody(result.finalState.bodies, initialBody.id);
    if (!finalBody) {
      continue;
    }
    if (
      distance(initialBody.position, finalBody.position) > PIXEL_BODY_UNIT * 0.5 ||
      initialBody.alive !== finalBody.alive
    ) {
      ids.add(initialBody.id);
    }
  }

  return ids;
}

function nearestOutAreaDistance(mapData: MapData, position: Vec2, radius: number): number {
  if (!mapData.tableBounds && !mapData.terrain) {
    return Number.POSITIVE_INFINITY;
  }

  const maxDistance = mapSearchDistance(mapData);
  const step = Math.max(PIXEL_BODY_UNIT * 4, radius * 0.5);
  let best = Number.POSITIVE_INFINITY;

  for (let ray = 0; ray < OUT_RAY_COUNT; ray += 1) {
    const direction = fromAngle((Math.PI * 2 * ray) / OUT_RAY_COUNT);
    const distanceToOut = distanceToOutAlongRay(mapData, position, direction, radius, step, maxDistance);
    if (distanceToOut < best) {
      best = distanceToOut;
    }
  }

  return best;
}

function distanceToOutAlongRay(
  mapData: MapData,
  start: Vec2,
  direction: Vec2,
  radius: number,
  step: number,
  maxDistance: number
): number {
  for (let travelled = Math.max(radius, step); travelled <= maxDistance; travelled += step) {
    const point = add(start, scale(direction, travelled));
    if (pointBlockedByCollider(mapData, point, radius)) {
      return Number.POSITIVE_INFINITY;
    }
    if (!isPointPlayableOnMap(mapData, point)) {
      return Math.max(0, travelled - radius);
    }
  }
  return Number.POSITIVE_INFINITY;
}

function distanceDeltaPixels(initialDistance: number, finalDistance: number): number {
  if (!Number.isFinite(initialDistance) && !Number.isFinite(finalDistance)) {
    return 0;
  }
  if (!Number.isFinite(initialDistance)) {
    return MAX_DISTANCE_DELTA_PIXELS;
  }
  if (!Number.isFinite(finalDistance)) {
    return -MAX_DISTANCE_DELTA_PIXELS;
  }
  return Math.max(
    -MAX_DISTANCE_DELTA_PIXELS,
    Math.min(MAX_DISTANCE_DELTA_PIXELS, (initialDistance - finalDistance) / PIXEL_BODY_UNIT)
  );
}

function clampDeltaPixels(deltaPixels: number): number {
  return Math.max(-MAX_DISTANCE_DELTA_PIXELS, Math.min(MAX_DISTANCE_DELTA_PIXELS, deltaPixels));
}

function bodyInShrinkArea(body: BodyState, shrinkCircle: ShrinkCircleState): boolean {
  if (!body.alive || !shrinkCircle.active) {
    return false;
  }
  if (shrinkCircle.progress >= 1) {
    return true;
  }
  return distance(body.position, shrinkCircle.center) - body.radius >= shrinkCircle.safeRadius;
}

function pointBlockedByCollider(mapData: MapData, point: Vec2, radius: number): boolean {
  return mapData.colliders.some((collider) => colliderContainsPoint(collider, point, radius));
}

function colliderContainsPoint(collider: MapCollider, point: Vec2, radius: number): boolean {
  if (collider.type === "static_wall") {
    return distancePointToSegment(point, collider.start, collider.end) <= radius;
  }
  if (collider.type === "bumper" || collider.type === "circle_obstacle") {
    return distance(point, collider.position) <= collider.radius + radius;
  }
  if (
    collider.type === "dynamic_obstacle_spawn" ||
    collider.type === "destructible_obstacle_spawn"
  ) {
    return distance(point, collider.position) <= collider.radius + radius;
  }
  return false;
}

function mapSearchDistance(mapData: MapData): number {
  if (mapData.tableBounds) {
    const width = mapData.tableBounds.right - mapData.tableBounds.left;
    const height = mapData.tableBounds.bottom - mapData.tableBounds.top;
    return Math.hypot(width, height) + PIXEL_BODY_UNIT * 20;
  }
  if (mapData.terrain) {
    return Math.hypot(
      mapData.terrain.widthCells * mapData.terrain.cellSize,
      mapData.terrain.heightCells * mapData.terrain.cellSize
    ) + PIXEL_BODY_UNIT * 20;
  }
  return PIXEL_BODY_UNIT * 2000;
}

function distancePointToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const segment = sub(end, start);
  const segmentLengthSquared = dot(segment, segment);
  if (segmentLengthSquared === 0) {
    return distance(point, start);
  }
  const t = Math.max(0, Math.min(1, dot(sub(point, start), segment) / segmentLengthSquared));
  return distance(point, add(start, scale(segment, t)));
}

function findBody(
  bodies: readonly BodyState[],
  bodyId: string
): BodyState | undefined {
  return bodies.find((body) => body.id === bodyId);
}
