import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import { BASE_SHOT_POWER_LIMIT } from "../rules/pickups";
import { chooseBotShot } from "./chooseBotShot";
import { resolveBotOptions } from "./botOptions";
import { generateCandidates } from "./generateCandidates";

describe("chooseBotShot", () => {
  it("generates 40 weighted random candidates plus direct ring-out opportunities", () => {
    const candidates = generateCandidates(
      gameState,
      mapData,
      "p1",
      resolveBotOptions({ maxCandidates: 40, rngSeed: 9 })
    );

    expect(candidates.length).toBeGreaterThan(40);
    expect(
      candidates.some(
        (candidate) =>
          candidate.actorBodyId === "disc-a" &&
          candidate.power === BASE_SHOT_POWER_LIMIT &&
          Math.abs(candidate.angle) < 0.000001
      )
    ).toBe(true);
    expect(candidates.slice(0, 40).every((candidate) => candidate.power >= 0)).toBe(true);
    expect(candidates.slice(0, 40).every((candidate) => candidate.power <= BASE_SHOT_POWER_LIMIT))
      .toBe(true);
  });

  it("returns a legal ShotIntent for the bot player", () => {
    const shot = chooseBotShot(gameState, mapData, "p1", {
      maxCandidates: 8,
      rngSeed: 5
    });

    expect(shot).toBeDefined();
    if (!shot) {
      throw new Error("bot should choose a shot");
    }
    expect(shot.actorBodyId).toBe("disc-a");
    expect(shot.angle).toBeGreaterThanOrEqual(0);
    expect(shot.angle).toBeLessThanOrEqual(Math.PI * 2);
    expect(shot.power).toBeGreaterThanOrEqual(0);
    expect(shot.power).toBeLessThanOrEqual(BASE_SHOT_POWER_LIMIT);
    expect(shot.spinOffset).toBe(0);
  });
});

const mapData: MapData = {
  id: "arena",
  tableBounds: {
    left: -20 * PHYSICS_UNIT_SCALE,
    top: -50 * PHYSICS_UNIT_SCALE,
    right: 125 * PHYSICS_UNIT_SCALE,
    bottom: 50 * PHYSICS_UNIT_SCALE
  },
  colliders: [],
  triggers: [],
  portals: []
};

const gameState: GameState = {
  gameId: "game",
  mapId: "arena",
  turnIndex: 0,
  currentPlayerId: "p1",
  phase: "waiting_for_shot",
  players: [
    { id: "p1", teamId: "red", isBot: true },
    { id: "p2", teamId: "blue" }
  ],
  bodies: [
    makeBody("disc-a", "p1", "red", { x: 20 * PHYSICS_UNIT_SCALE, y: 0 }),
    makeBody("disc-b", "p2", "blue", { x: 100 * PHYSICS_UNIT_SCALE, y: 0 })
  ],
  effects: [],
  rngSeed: 1
};

function makeBody(
  id: string,
  ownerPlayerId: string,
  teamId: string,
  position: { x: number; y: number }
): BodyState {
  return {
    id,
    kind: "disc",
    ownerPlayerId,
    teamId,
    position,
    velocity: { x: 0, y: 0 },
    radius: 10 * PHYSICS_UNIT_SCALE,
    mass: PHYSICS_UNIT_SCALE,
    damping: 0.5,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: true,
    tags: [],
    modifiers: []
  };
}
