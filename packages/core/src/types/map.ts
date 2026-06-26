import type { Vec2 } from "../math/vec2";
import type { BodyKind } from "./body";
import type { PortalPair } from "./portal";

/**
 * Static map data split into colliders, triggers, and portal pairs.
 */
export interface MapData {
  readonly id: string;
  readonly name?: string;
  readonly colliders: readonly MapCollider[];
  readonly triggers: readonly MapTrigger[];
  readonly portals: readonly PortalPair[];
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
  readonly restitution?: number;
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
