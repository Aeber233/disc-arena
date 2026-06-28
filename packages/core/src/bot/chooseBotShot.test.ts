import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import { PHYSICS_POWER_SCALE, PHYSICS_UNIT_SCALE } from "../physics/units";
import { chooseBotShot } from "./chooseBotShot";

const candidatePowers = [10, 20].map((power) => power * PHYSICS_POWER_SCALE);

describe("chooseBotShot", () => {
  it("returns a legal ShotIntent within configured candidate ranges", () => {
    const shot = chooseBotShot(gameState, mapData, "disc-a", {
      maxCandidates: 6,
      maxThinkTimeMs: 100,
      powers: candidatePowers,
      spinOffsets: [0]
    });

    expect(shot.actorBodyId).toBe("disc-a");
    expect(shot.angle).toBeGreaterThanOrEqual(0);
    expect(shot.angle).toBeLessThanOrEqual(Math.PI * 2);
    expect(candidatePowers).toContain(shot.power);
    expect(shot.spinOffset).toBe(0);
  });
});

const mapData: MapData = {
  id: "arena",
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
    makeBody("disc-a", "p1", "red", { x: 0, y: 0 }),
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
