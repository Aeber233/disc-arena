import type { Vec2 } from "../math/vec2";
import type { BodyKind } from "./body";
import type { PortalPair } from "./portal";

/**
 * Static map data split into colliders, triggers, and portal pairs.
 */
export interface MapData {
  readonly id: string;
  readonly name?: string;
  readonly tableBounds?: TableBounds;
  readonly terrain?: MapTerrainData;
  readonly obstacles?: MapObstacleData;
  readonly colliders: readonly MapCollider[];
  readonly triggers: readonly MapTrigger[];
  readonly portals: readonly PortalPair[];
}

export interface TableBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type GroundMaterial = "void" | "grass" | "ice" | "sand" | "cloud";
export type ObstacleMaterial = "wood" | "elastic_wall" | "sticky_wall" | "airbag";
export type MapCellShape = 0 | 1 | 2 | 3 | 4;

export interface MapTerrainData {
  readonly origin: Vec2;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellSize: number;
  readonly cells: readonly MapTerrainCell[];
}

export interface MapTerrainCell {
  readonly material: GroundMaterial;
  readonly shape: MapCellShape;
}

export interface MapObstacleData {
  readonly origin: Vec2;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellSize: number;
  readonly cells: readonly (MapObstacleCell | null)[];
}

export interface MapObstacleCell {
  readonly material: ObstacleMaterial;
  readonly shape: MapCellShape;
}

export type MapCollider =
  | StaticWallCollider
  | BumperCollider
  | CircleObstacleCollider
  | DynamicObstacleSpawn
  | DestructibleObstacleSpawn;

export interface StaticWallCollider {
  readonly type: "static_wall";
  readonly id: string;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly material?: ObstacleMaterial;
  readonly restitution?: number;
  /**
   * Optional unit normal pointing from the collision edge into the solid
   * obstacle side. Renderers can use this to draw visual wall thickness without
   * moving the physical collision line.
   */
  readonly solidSideNormal?: Vec2;
}

export interface BumperCollider {
  readonly type: "bumper";
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly impulse: number;
}

export interface CircleObstacleCollider {
  readonly type: "circle_obstacle";
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly restitution?: number;
}

export interface DynamicObstacleSpawn {
  readonly type: "dynamic_obstacle_spawn";
  readonly id: string;
  readonly bodyKind: BodyKind;
  readonly position: Vec2;
  readonly radius: number;
  readonly mass: number;
}

export interface DestructibleObstacleSpawn {
  readonly type: "destructible_obstacle_spawn";
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly hp: number;
  readonly breakThreshold?: number;
}

export type MapTrigger =
  | HoleTrigger
  | PickupTrigger
  | ForceFieldTrigger
  | DangerZoneTrigger;

export interface HoleTrigger {
  readonly type: "hole";
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
}

export interface PickupTrigger {
  readonly type: "pickup";
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly itemId: string;
}

export interface ForceFieldTrigger {
  readonly type: "force_field";
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly force: Vec2;
}

export interface DangerZoneTrigger {
  readonly type: "danger_zone";
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly damagePerTurn?: number;
}
