import { describe, expect, it } from "vitest";
import { billiardsMapData } from "../map/billiardsMap";
import type { BodyState } from "../types/body";
import {
  DEFAULT_SHRINK_CIRCLE_SETTINGS,
  isBodyFullyCoveredByPoison,
  normalizeShrinkCircleSettings,
  shrinkCircleStateForTurn
} from "./shrinkCircle";

describe("shrink circle", () => {
  it("defaults to a ten-round collapse speed", () => {
    expect(DEFAULT_SHRINK_CIRCLE_SETTINGS.collapseRounds).toBe(10);
  });

  it("starts after one full turn order round and collapses after configured rounds", () => {
    const before = shrinkCircleStateForTurn(
      billiardsMapData,
      3,
      4,
      { enabled: true, collapseRounds: 2 }
    );
    const start = shrinkCircleStateForTurn(
      billiardsMapData,
      4,
      4,
      { enabled: true, collapseRounds: 2 }
    );
    const end = shrinkCircleStateForTurn(
      billiardsMapData,
      12,
      4,
      { enabled: true, collapseRounds: 2 }
    );

    expect(before.active).toBe(false);
    expect(start.active).toBe(true);
    expect(start.progress).toBe(0);
    expect(end.progress).toBe(1);
    expect(end.safeRadius).toBe(0);
  });

  it("detects bodies whose whole area is in the poison", () => {
    const circle = shrinkCircleStateForTurn(
      billiardsMapData,
      6,
      4,
      { enabled: true, collapseRounds: 1 }
    );
    const covered = bodyAt(circle.center.x + circle.safeRadius + 1000, circle.center.y, 10);
    const touchingSafeArea = bodyAt(circle.center.x + circle.safeRadius - 5, circle.center.y, 10);

    expect(isBodyFullyCoveredByPoison(covered, circle)).toBe(true);
    expect(isBodyFullyCoveredByPoison(touchingSafeArea, circle)).toBe(false);
  });

  it("clamps collapse rounds", () => {
    expect(normalizeShrinkCircleSettings({ enabled: true, collapseRounds: -5 }).collapseRounds).toBe(1);
    expect(normalizeShrinkCircleSettings({ enabled: true, collapseRounds: 500 }).collapseRounds).toBe(99);
  });
});

function bodyAt(x: number, y: number, radius: number): BodyState {
  return {
    id: "body",
    kind: "disc",
    ownerPlayerId: "player",
    teamId: "player",
    position: { x, y },
    velocity: { x: 0, y: 0 },
    radius,
    mass: 1,
    damping: 1,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: true,
    tags: [],
    modifiers: []
  };
}
