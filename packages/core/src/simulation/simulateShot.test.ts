import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { SimulationOptions } from "../types/simulation";
import { simulateShot } from "./simulateShot";
import { shotIntentToVelocity } from "./shotPhysics";

describe("simulateShot", () => {
  it("converts ShotIntent angle and power into velocity", () => {
    const velocity = shotIntentToVelocity({
      actorBodyId: "disc-a",
      angle: Math.PI / 2,
      power: 10,
      spinOffset: 0
    });

    expect(velocity.x).toBeCloseTo(0);
    expect(velocity.y).toBeCloseTo(10);
  });

  it("applies shot intent and ends within maxSteps", () => {
    const result = simulateShot(
      makeGameState([makeBody("disc-a", "p1", "red")]),
      emptyMap,
      {
        actorBodyId: "disc-a",
        angle: 0,
        power: 5,
        spinOffset: 0.25
      },
      {
        ...baseOptions,
        maxSteps: 3
      }
    );

    expect(result.finalState.bodies[0]?.velocity.x).toBeGreaterThan(0);
    expect(result.finalState.bodies[0]?.spin).toBeGreaterThan(0);
    expect(Math.max(...result.events.map((event) => event.step))).toBeLessThanOrEqual(3);
    expect(result.resultHash).toMatch(/^[0-9a-f]{8}$/);
  });
});

const baseOptions: SimulationOptions = {
  mode: "authoritative",
  fixedDt: 1 / 30,
  maxSteps: 60,
  collisionIterations: 1,
  recordFrames: false,
  frameIntervalSteps: 5,
  quantize: true
};

const emptyMap: MapData = {
  id: "empty",
  colliders: [],
  triggers: [],
  portals: []
};

function makeGameState(bodies: BodyState[]): GameState {
  return {
    gameId: "game",
    mapId: "empty",
    turnIndex: 0,
    currentPlayerId: "p1",
    phase: "waiting_for_shot",
    players: [
      { id: "p1", teamId: "red" },
      { id: "p2", teamId: "blue" }
    ],
    bodies,
    effects: [],
    rngSeed: 1
  };
}

function makeBody(
  id: string,
  ownerPlayerId: string,
  teamId: string
): BodyState {
  return {
    id,
    kind: "disc",
    ownerPlayerId,
    teamId,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 10,
    mass: 1,
    damping: 0,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: true,
    tags: [],
    modifiers: []
  };
}
