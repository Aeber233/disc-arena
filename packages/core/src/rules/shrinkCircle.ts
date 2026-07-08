import { distance } from "../math/vec2";
import type { BodyState } from "../types/body";
import type { MapData } from "../types/map";
import type { Vec2 } from "../math/vec2";

export interface ShrinkCircleSettings {
  readonly enabled: boolean;
  readonly collapseRounds: number;
}

export interface ShrinkCircleState {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly collapseRounds: number;
  readonly startTurnIndex: number;
  readonly endTurnIndex: number;
  readonly progress: number;
  readonly center: Vec2;
  readonly safeRadius: number;
}

export const DEFAULT_SHRINK_CIRCLE_SETTINGS: ShrinkCircleSettings = {
  enabled: false,
  collapseRounds: 10
};

export const MIN_SHRINK_COLLAPSE_ROUNDS = 1;
export const MAX_SHRINK_COLLAPSE_ROUNDS = 99;

/**
 * Computes the safe circle for the battle-royale style shrinking arena rule.
 */
export function shrinkCircleStateForTurn(
  mapData: MapData,
  turnIndex: number,
  turnOrderLength: number,
  settings: ShrinkCircleSettings
): ShrinkCircleState {
  const normalized = normalizeShrinkCircleSettings(settings);
  const roundLength = Math.max(1, turnOrderLength);
  const startTurnIndex = roundLength;
  const endTurnIndex = startTurnIndex + normalized.collapseRounds * roundLength;
  const bounds = mapBounds(mapData);
  const center = {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2
  };
  const initialRadius = Math.hypot(bounds.right - bounds.left, bounds.bottom - bounds.top) / 2;
  const active = normalized.enabled && turnIndex >= startTurnIndex;
  const progress = active
    ? clamp((turnIndex - startTurnIndex) / Math.max(1, endTurnIndex - startTurnIndex), 0, 1)
    : 0;

  return {
    enabled: normalized.enabled,
    active,
    collapseRounds: normalized.collapseRounds,
    startTurnIndex,
    endTurnIndex,
    progress,
    center,
    safeRadius: initialRadius * (1 - progress)
  };
}

export function normalizeShrinkCircleSettings(
  settings: ShrinkCircleSettings
): ShrinkCircleSettings {
  return {
    enabled: settings.enabled,
    collapseRounds: clamp(
      Math.round(settings.collapseRounds),
      MIN_SHRINK_COLLAPSE_ROUNDS,
      MAX_SHRINK_COLLAPSE_ROUNDS
    )
  };
}

export function isBodyFullyCoveredByPoison(
  body: BodyState,
  circle: ShrinkCircleState
): boolean {
  if (!circle.enabled || !circle.active) {
    return false;
  }
  if (circle.progress >= 1) {
    return true;
  }
  return distance(body.position, circle.center) - body.radius >= circle.safeRadius;
}

function mapBounds(mapData: MapData): { left: number; top: number; right: number; bottom: number } {
  if (mapData.tableBounds) {
    return mapData.tableBounds;
  }
  if (mapData.terrain) {
    return {
      left: mapData.terrain.origin.x,
      top: mapData.terrain.origin.y,
      right: mapData.terrain.origin.x + mapData.terrain.widthCells * mapData.terrain.cellSize,
      bottom: mapData.terrain.origin.y + mapData.terrain.heightCells * mapData.terrain.cellSize
    };
  }
  return { left: 0, top: 0, right: 1, bottom: 1 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
