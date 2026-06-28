import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import { PHYSICS_UNIT_SCALE } from "../physics/units";

export const TEST_MAP_ID = "test_map";
export const TEST_MAP_PHYSICS_SCALE = PHYSICS_UNIT_SCALE;
export const TEST_MAP_WIDTH = 960 * TEST_MAP_PHYSICS_SCALE;
export const TEST_MAP_HEIGHT = 560 * TEST_MAP_PHYSICS_SCALE;
export const TEST_MAP_WALL_INSET = 44 * TEST_MAP_PHYSICS_SCALE;

const S = TEST_MAP_PHYSICS_SCALE;

/**
 * Small sandbox map for local physics tests. It has left and right wall
 * boundaries while the top and bottom sides stay open.
 */
export const testMapData: MapData = {
  id: TEST_MAP_ID,
  name: "test_map",
  tableBounds: {
    left: 0,
    top: 0,
    right: TEST_MAP_WIDTH,
    bottom: TEST_MAP_HEIGHT
  },
  colliders: [
    {
      type: "static_wall",
      id: "left-wall",
      start: { x: TEST_MAP_WALL_INSET, y: 40 * S },
      end: { x: TEST_MAP_WALL_INSET, y: TEST_MAP_HEIGHT - 40 * S },
      restitution: 0.92
    },
    {
      type: "static_wall",
      id: "right-wall",
      start: { x: TEST_MAP_WIDTH - TEST_MAP_WALL_INSET, y: 40 * S },
      end: { x: TEST_MAP_WIDTH - TEST_MAP_WALL_INSET, y: TEST_MAP_HEIGHT - 40 * S },
      restitution: 1.12
    }
  ],
  triggers: [],
  portals: []
};

export function createTestMapGameState(): GameState {
  return {
    gameId: "local-test",
    mapId: TEST_MAP_ID,
    turnIndex: 0,
    currentPlayerId: "player",
    phase: "waiting_for_shot",
    players: [{ id: "player", teamId: "white" }],
    bodies: [
      createBall("ball-1", 1, 1, 18, 1.25, { x: 230, y: 280 }),
      createBall("ball-2", 2, 1, 18, 1.2, { x: 455, y: 280 }),
      createBall("ball-3", 3, 2.25, 26, 1, { x: 585, y: 280 }),
      createBall("ball-4", 4, 0.8, 14, 1.5, { x: 700, y: 210 }),
      createBall("ball-5", 5, 1.55, 22, 1.1, { x: 705, y: 350 })
    ],
    effects: [],
    rngSeed: 20260627
  };
}

function createBall(
  id: string,
  number: number,
  mass: number,
  radius: number,
  damping: number,
  position: { x: number; y: number }
): BodyState {
  return {
    id,
    kind: "disc",
    ownerPlayerId: "player",
    teamId: "white",
    position: scalePoint(position),
    velocity: { x: 0, y: 0 },
    radius: radius * S,
    mass: mass * S,
    damping,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: true,
    tags: [`number:${number}`],
    modifiers: []
  };
}

function scalePoint(position: { readonly x: number; readonly y: number }) {
  return {
    x: position.x * S,
    y: position.y * S
  };
}
