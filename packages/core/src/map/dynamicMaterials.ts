import { add, dot, length, scale, sub } from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import type { BodyState } from "../types/body";
import type {
  MapCellShape,
  MapData,
  MapObstacleCell,
  MapObstacleData,
  MapTerrainCell,
  ObstacleMaterial,
  StaticWallCollider
} from "../types/map";
import type { SimulationEvent } from "../types/simulation";
import { OBSTACLE_RESTITUTION } from "./editableMap";

interface TerrainPatch {
  readonly x: number;
  readonly y: number;
  readonly material: "void";
  readonly shape: 0;
}

interface ObstaclePatch {
  readonly x: number;
  readonly y: number;
  readonly material: null;
}

/**
 * Consumes cloud terrain under the swept circle path of moving bodies.
 */
export function dissipateCloudTerrain(
  mapData: MapData,
  bodies: readonly BodyState[],
  previousPositions: ReadonlyMap<string, Vec2>,
  step: number
): readonly SimulationEvent[] {
  const terrain = mutableTerrain(mapData);
  if (!terrain) {
    return [];
  }

  const patches: TerrainPatch[] = [];
  const patched = new Set<string>();
  const bodyIds = new Set<string>();

  for (const body of bodies) {
    if (!body.alive) {
      continue;
    }
    const previous = previousPositions.get(body.id) ?? body.position;
    const minX = Math.min(previous.x, body.position.x) - body.radius;
    const maxX = Math.max(previous.x, body.position.x) + body.radius;
    const minY = Math.min(previous.y, body.position.y) - body.radius;
    const maxY = Math.max(previous.y, body.position.y) + body.radius;
    const left = clampCell(Math.floor((minX - terrain.origin.x) / terrain.cellSize), terrain.widthCells);
    const right = clampCell(Math.floor((maxX - terrain.origin.x) / terrain.cellSize), terrain.widthCells);
    const top = clampCell(Math.floor((minY - terrain.origin.y) / terrain.cellSize), terrain.heightCells);
    const bottom = clampCell(Math.floor((maxY - terrain.origin.y) / terrain.cellSize), terrain.heightCells);

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const key = `${x}:${y}`;
        if (patched.has(key)) {
          continue;
        }
        const index = y * terrain.widthCells + x;
        const cell = terrain.cells[index];
        if (!cell || cell.material !== "cloud") {
          continue;
        }

        const center = {
          x: terrain.origin.x + (x + 0.5) * terrain.cellSize,
          y: terrain.origin.y + (y + 0.5) * terrain.cellSize
        };
        if (
          !isGridPointInsideCellShape({ x: 0.5, y: 0.5 }, cell.shape) ||
          distancePointToSegment(center, previous, body.position) >
            body.radius + terrain.cellSize * 0.55
        ) {
          continue;
        }

        terrain.cells[index] = { material: "void", shape: 0 };
        patched.add(key);
        patches.push({ x, y, material: "void", shape: 0 });
        bodyIds.add(body.id);
      }
    }
  }

  if (patches.length === 0) {
    return [];
  }

  return [
    {
      type: "terrain_changed",
      step,
      bodyIds: [...bodyIds],
      data: {
        reason: "cloud_dissipated",
        cells: patches
      }
    }
  ];
}

/**
 * Pops airbag obstacle cells hit by wall collisions and rebuilds wall colliders.
 */
export function popAirbagsFromCollisions(
  mapData: MapData,
  bodies: readonly BodyState[],
  collisionEvents: readonly SimulationEvent[],
  step: number
): readonly SimulationEvent[] {
  const obstacles = mutableObstacles(mapData);
  if (!obstacles) {
    return [];
  }

  const patches: ObstaclePatch[] = [];
  const patched = new Set<string>();

  for (const event of collisionEvents) {
    if (event.type !== "wall_collision" || event.data?.material !== "airbag") {
      continue;
    }
    const collisionPoint = vec2FromUnknown(event.data.collisionPoint);
    const body = bodies.find((candidate) => candidate.id === event.bodyIds?.[0]);
    if (!collisionPoint || !body) {
      continue;
    }

    const wall = wallFromCollisionEvent(mapData, event);
    const removeHalfLength = body.radius * 0.4;
    const popSegment = airbagPopSegment(collisionPoint, wall, removeHalfLength);
    const left = clampCell(
      Math.floor((Math.min(popSegment.start.x, popSegment.end.x) - obstacles.cellSize - obstacles.origin.x) / obstacles.cellSize),
      obstacles.widthCells
    );
    const right = clampCell(
      Math.floor((Math.max(popSegment.start.x, popSegment.end.x) + obstacles.cellSize - obstacles.origin.x) / obstacles.cellSize),
      obstacles.widthCells
    );
    const top = clampCell(
      Math.floor((Math.min(popSegment.start.y, popSegment.end.y) - obstacles.cellSize - obstacles.origin.y) / obstacles.cellSize),
      obstacles.heightCells
    );
    const bottom = clampCell(
      Math.floor((Math.max(popSegment.start.y, popSegment.end.y) + obstacles.cellSize - obstacles.origin.y) / obstacles.cellSize),
      obstacles.heightCells
    );

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const key = `${x}:${y}`;
        if (patched.has(key)) {
          continue;
        }
        const index = y * obstacles.widthCells + x;
        const cell = obstacles.cells[index];
        if (!cell || cell.material !== "airbag") {
          continue;
        }

        const center = {
          x: obstacles.origin.x + (x + 0.5) * obstacles.cellSize,
          y: obstacles.origin.y + (y + 0.5) * obstacles.cellSize
        };
        if (distancePointToSegment(center, popSegment.start, popSegment.end) > obstacles.cellSize * 0.55) {
          continue;
        }

        obstacles.cells[index] = null;
        patched.add(key);
        patches.push({ x, y, material: null });
      }
    }
  }

  if (patches.length === 0) {
    return [];
  }

  replaceColliders(mapData, obstacleDataToWallColliders(obstacles));
  return [
    {
      type: "obstacle_changed",
      step,
      data: {
        reason: "airbag_popped",
        cells: patches
      }
    }
  ];
}

function wallFromCollisionEvent(
  mapData: MapData,
  event: SimulationEvent
): StaticWallCollider | undefined {
  const wallId = event.data?.wallId;
  return typeof wallId === "string"
    ? mapData.colliders.find(
        (collider): collider is StaticWallCollider =>
          collider.type === "static_wall" && collider.id === wallId
      )
    : undefined;
}

function airbagPopSegment(
  collisionPoint: Vec2,
  wall: StaticWallCollider | undefined,
  halfLength: number
): { readonly start: Vec2; readonly end: Vec2 } {
  if (!wall) {
    return { start: collisionPoint, end: collisionPoint };
  }
  const wallVector = sub(wall.end, wall.start);
  const wallLength = length(wallVector);
  if (wallLength === 0) {
    return { start: collisionPoint, end: collisionPoint };
  }
  const tangent = scale(wallVector, 1 / wallLength);
  return {
    start: add(collisionPoint, scale(tangent, -halfLength)),
    end: add(collisionPoint, scale(tangent, halfLength))
  };
}

function obstacleDataToWallColliders(obstacles: MutableObstacleData): StaticWallCollider[] {
  const edgeCounts = new Map<
    string,
    {
      readonly start: Vec2;
      readonly end: Vec2;
      readonly material: ObstacleMaterial;
      readonly solidSideNormal: Vec2;
      count: number;
    }
  >();

  obstacles.cells.forEach((cell, index) => {
    if (!cell) {
      return;
    }
    const x = index % obstacles.widthCells;
    const y = Math.floor(index / obstacles.widthCells);
    for (const edge of obstacleEdgesForCell(obstacles, x, y, cell.shape)) {
      const key = normalizedEdgeKey(edge.start, edge.end);
      const existing = edgeCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edgeCounts.set(key, {
          ...edge,
          material: cell.material,
          solidSideNormal: edgeSolidSideNormal(edge),
          count: 1
        });
      }
    }
  });

  return [...edgeCounts.values()]
    .filter((edge) => edge.count === 1)
    .map((edge, index) => ({
      type: "static_wall",
      id: `${edge.material}-wall-${index}`,
      start: edge.start,
      end: edge.end,
      material: edge.material,
      solidSideNormal: edge.solidSideNormal,
      restitution: OBSTACLE_RESTITUTION[edge.material]
    }));
}

type MutableTerrainData = Omit<NonNullable<MapData["terrain"]>, "cells"> & { cells: MapTerrainCell[] };
type MutableObstacleData = Omit<MapObstacleData, "cells"> & { cells: (MapObstacleCell | null)[] };

function mutableTerrain(mapData: MapData): MutableTerrainData | undefined {
  return mapData.terrain as MutableTerrainData | undefined;
}

function mutableObstacles(mapData: MapData): MutableObstacleData | undefined {
  return mapData.obstacles as MutableObstacleData | undefined;
}

function replaceColliders(mapData: MapData, colliders: readonly StaticWallCollider[]): void {
  (mapData as { colliders: readonly StaticWallCollider[] }).colliders = colliders;
}

function obstacleEdgesForCell(
  obstacles: Pick<MutableObstacleData, "origin" | "cellSize">,
  x: number,
  y: number,
  shape: MapCellShape
): readonly { readonly start: Vec2; readonly end: Vec2 }[] {
  const left = obstacles.origin.x + x * obstacles.cellSize;
  const top = obstacles.origin.y + y * obstacles.cellSize;
  const right = left + obstacles.cellSize;
  const bottom = top + obstacles.cellSize;
  const topLeft = { x: left, y: top };
  const topRight = { x: right, y: top };
  const bottomRight = { x: right, y: bottom };
  const bottomLeft = { x: left, y: bottom };

  if (shape === 1) {
    return edges([topLeft, topRight, bottomLeft]);
  }
  if (shape === 2) {
    return edges([topLeft, topRight, bottomRight]);
  }
  if (shape === 3) {
    return edges([topRight, bottomRight, bottomLeft]);
  }
  if (shape === 4) {
    return edges([topLeft, bottomRight, bottomLeft]);
  }
  return edges([topLeft, topRight, bottomRight, bottomLeft]);
}

function edges(points: readonly Vec2[]) {
  return points.map((point, index) => ({
    start: point,
    end: points[(index + 1) % points.length] ?? point
  }));
}

function edgeSolidSideNormal(edge: { readonly start: Vec2; readonly end: Vec2 }): Vec2 {
  const vector = sub(edge.end, edge.start);
  const candidate = { x: -vector.y, y: vector.x };
  const candidateLength = length(candidate);
  return candidateLength === 0 ? { x: 1, y: 0 } : scale(candidate, 1 / candidateLength);
}

function normalizedEdgeKey(start: Vec2, end: Vec2): string {
  const a = `${start.x},${start.y}`;
  const b = `${end.x},${end.y}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function distancePointToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const segment = sub(end, start);
  const lengthSquared = dot(segment, segment);
  if (lengthSquared === 0) {
    return length(sub(point, start));
  }
  const t = clamp(dot(sub(point, start), segment) / lengthSquared, 0, 1);
  return length(sub(point, add(start, scale(segment, t))));
}

function isGridPointInsideCellShape(point: Vec2, shape: MapCellShape): boolean {
  if (shape === 0) {
    return true;
  }
  if (shape === 1) {
    return point.x + point.y <= 1;
  }
  if (shape === 2) {
    return point.x >= point.y;
  }
  if (shape === 3) {
    return point.x + point.y >= 1;
  }
  return point.x <= point.y;
}

function vec2FromUnknown(value: unknown): Vec2 | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record.x === "number" && typeof record.y === "number"
    ? { x: record.x, y: record.y }
    : undefined;
}

function clampCell(value: number, count: number): number {
  return clamp(value, 0, Math.max(0, count - 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
