import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { SimulationOptions } from "../types/simulation";
import { stepWorld } from "./stepWorld";

describe("stepWorld portal proxy feedback", () => {
  it("maps portal shadow wall correction back to the real body", () => {
    const body = makeBody();
    const state: GameState = {
      gameId: "portal-feedback",
      mapId: "portal-map",
      turnIndex: 0,
      currentPlayerId: "player",
      phase: "simulating",
      players: [{ id: "player", teamId: "team" }],
      bodies: [body],
      effects: [],
      rngSeed: 1
    };

    const result = stepWorld(state, portalWallMap, options, 1);

    expect(state.bodies[0]?.position.x).toBeGreaterThan(4);
    expect(result.events.some((event) => event.type === "wall_collision")).toBe(true);
  });
});

const options: SimulationOptions = {
  mode: "authoritative",
  fixedDt: 1 / 60,
  maxSteps: 1,
  collisionIterations: 1,
  recordFrames: false,
  frameIntervalSteps: 1
};

const portalWallMap: MapData = {
  id: "portal-wall-map",
  colliders: [
    {
      type: "static_wall",
      id: "exit-wall",
      start: { x: 96, y: -50 },
      end: { x: 96, y: 50 },
      restitution: 1
    }
  ],
  triggers: [],
  portals: [
    {
      id: "pair",
      a: {
        id: "a",
        position: { x: 0, y: 0 },
        normal: { x: 1, y: 0 },
        width: 80
      },
      b: {
        id: "b",
        position: { x: 100, y: 0 },
        normal: { x: -1, y: 0 },
        width: 80
      }
    }
  ]
};

function makeBody(): BodyState {
  return {
    id: "ball",
    kind: "disc",
    position: { x: 4, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 10,
    mass: 1,
    damping: 0,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: false,
    tags: [],
    modifiers: []
  };
}
