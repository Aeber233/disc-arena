import {
  add,
  angleOf,
  distance,
  dot,
  length,
  normalize,
  scale,
  sub
} from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import { isPointPlayableOnMap } from "../map/editableMap";
import { PIXEL_BODY_UNIT } from "../map/pixelBodySizes";
import {
  actionConstraintAllowsBody,
  shotPowerLimitForPlayer
} from "../rules/pickups";
import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { MapCollider, MapData } from "../types/map";
import type { ShotIntent } from "../types/shot";
import type { BotOptions } from "./botOptions";

/**
 * Generates the requested bot search set:
 * - 40 random shots by default, choosing an owned legal ball, random direction,
 *   and power sampled with probability density proportional to power.
 * - Extra direct ring-out shots when an owned ball, enemy ball, and out area
 *   are on a clear line.
 */
export function generateCandidates(
  gameState: GameState,
  mapData: MapData,
  playerId: string,
  options: BotOptions
): readonly ShotIntent[] {
  const actors = legalActors(gameState, playerId);
  if (actors.length === 0) {
    return [];
  }

  const maxPower = shotPowerLimitForPlayer(gameState, playerId);
  const random = createRandom(
    hashString(`${options.rngSeed}:${gameState.rngSeed}:${gameState.turnIndex}:${playerId}`)
  );
  const candidates: ShotIntent[] = [];

  for (let index = 0; index < options.maxCandidates; index += 1) {
    const actor = actors[Math.floor(random() * actors.length)] ?? actors[0]!;
    candidates.push({
      actorBodyId: actor.id,
      angle: random() * Math.PI * 2,
      power: maxPower * Math.sqrt(random()),
      spinOffset: 0
    });
  }

  candidates.push(...directRingOutCandidates(gameState, mapData, playerId, actors, maxPower));
  return candidates;
}

function legalActors(state: GameState, playerId: string): BodyState[] {
  return state.bodies.filter(
    (body) =>
      body.alive &&
      body.ownerPlayerId === playerId &&
      actionConstraintAllowsBody(state, playerId, body)
  );
}

function directRingOutCandidates(
  state: GameState,
  mapData: MapData,
  playerId: string,
  actors: readonly BodyState[],
  maxPower: number
): ShotIntent[] {
  const candidates: ShotIntent[] = [];
  const enemies = state.bodies.filter(
    (body) => body.alive && body.ownerPlayerId && body.ownerPlayerId !== playerId
  );

  for (const actor of actors) {
    for (const enemy of enemies) {
      const aim = sub(enemy.position, actor.position);
      const aimDistance = length(aim);
      if (aimDistance <= actor.radius + enemy.radius) {
        continue;
      }
      const direction = normalize(aim);
      if (!segmentIsClear(mapData, state.bodies, actor, enemy, actor.position, enemy.position)) {
        continue;
      }
      if (!rayReachesOutArea(mapData, enemy.position, direction, enemy.radius)) {
        continue;
      }
      candidates.push({
        actorBodyId: actor.id,
        angle: angleOf(direction),
        power: maxPower,
        spinOffset: 0
      });
    }
  }

  return dedupeCandidates(candidates);
}

function segmentIsClear(
  mapData: MapData,
  bodies: readonly BodyState[],
  actor: BodyState,
  target: BodyState,
  start: Vec2,
  end: Vec2
): boolean {
  const segmentLength = distance(start, end);
  const step = Math.max(PIXEL_BODY_UNIT * 4, actor.radius);
  for (let travelled = 0; travelled <= segmentLength; travelled += step) {
    const point = add(start, scale(sub(end, start), travelled / segmentLength));
    if (!isPointPlayableOnMap(mapData, point) || pointBlockedByCollider(mapData, point, actor.radius)) {
      return false;
    }
  }

  return bodies.every((body) => {
    if (!body.alive || body.id === actor.id || body.id === target.id) {
      return true;
    }
    return distancePointToSegment(body.position, start, end) >
      body.radius + actor.radius;
  });
}

function rayReachesOutArea(
  mapData: MapData,
  start: Vec2,
  direction: Vec2,
  radius: number
): boolean {
  const maxDistance = mapSearchDistance(mapData);
  const step = Math.max(PIXEL_BODY_UNIT * 5, radius * 0.75);
  for (let travelled = radius + step; travelled <= maxDistance; travelled += step) {
    const point = add(start, scale(direction, travelled));
    if (pointBlockedByCollider(mapData, point, radius)) {
      return false;
    }
    if (!isPointPlayableOnMap(mapData, point)) {
      return true;
    }
  }
  return false;
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

function dedupeCandidates(candidates: readonly ShotIntent[]): ShotIntent[] {
  const seen = new Set<string>();
  const deduped: ShotIntent[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.actorBodyId}:${Math.round(candidate.angle * 10000)}:${Math.round(candidate.power)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 0x100000000;
  };
}

function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
