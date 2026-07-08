import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { SimulationResult } from "../types/simulation";
import type { ShrinkCircleState } from "../rules/shrinkCircle";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import { scoreShot } from "./scoreShot";

describe("scoreShot shrink scoring", () => {
  it("rewards enemy shrink pressure and own center movement only when shrink is enabled", () => {
    const initialState = makeState([
      makeBody("own", "p1", { x: 60 * PHYSICS_UNIT_SCALE, y: 0 }),
      makeBody("enemy", "p2", { x: 20 * PHYSICS_UNIT_SCALE, y: 0 })
    ]);
    const finalState = makeState([
      makeBody("own", "p1", { x: 10 * PHYSICS_UNIT_SCALE, y: 0 }),
      makeBody("enemy", "p2", { x: 70 * PHYSICS_UNIT_SCALE, y: 0 })
    ]);
    const result: SimulationResult = {
      initialState,
      finalState,
      finalMapData: mapData,
      events: [{ type: "collision", step: 1, bodyIds: ["own", "enemy"] }],
      resultHash: "hash"
    };

    const withoutShrink = scoreShot(result, mapData, "own", {
      ...shrinkCircle,
      enabled: false
    });
    const withShrink = scoreShot(result, mapData, "own", shrinkCircle);

    expect(withShrink).toBeGreaterThan(withoutShrink + 900);
  });
});

const mapData: MapData = {
  id: "open",
  tableBounds: {
    left: -200 * PHYSICS_UNIT_SCALE,
    top: -200 * PHYSICS_UNIT_SCALE,
    right: 200 * PHYSICS_UNIT_SCALE,
    bottom: 200 * PHYSICS_UNIT_SCALE
  },
  colliders: [],
  triggers: [],
  portals: []
};

const shrinkCircle: ShrinkCircleState = {
  enabled: true,
  active: true,
  collapseRounds: 2,
  startTurnIndex: 1,
  endTurnIndex: 3,
  progress: 0.5,
  center: { x: 0, y: 0 },
  safeRadius: 40 * PHYSICS_UNIT_SCALE
};

function makeState(bodies: BodyState[]): GameState {
  return {
    gameId: "game",
    mapId: "open",
    turnIndex: 0,
    roundSlotIndex: 0,
    roundIndex: 0,
    currentPlayerId: "p1",
    phase: "waiting_for_shot",
    players: [
      { id: "p1", teamId: "p1" },
      { id: "p2", teamId: "p2" }
    ],
    bodies,
    effects: [],
    rngSeed: 1
  };
}

function makeBody(id: string, ownerPlayerId: string, position: { x: number; y: number }): BodyState {
  return {
    id,
    kind: "disc",
    ownerPlayerId,
    teamId: ownerPlayerId,
    position,
    velocity: { x: 0, y: 0 },
    radius: 5 * PHYSICS_UNIT_SCALE,
    mass: PHYSICS_UNIT_SCALE,
    damping: 0,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: true,
    tags: [],
    modifiers: []
  };
}
