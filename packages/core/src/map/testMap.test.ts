import { describe, expect, it } from "vitest";
import {
  createTestMapGameState,
  TEST_MAP_HEIGHT,
  TEST_MAP_PHYSICS_SCALE,
  TEST_MAP_WIDTH
} from "./testMap";

describe("test_map scale", () => {
  it("stores map dimensions, body radii, and masses in scaled physics units", () => {
    const state = createTestMapGameState();
    const firstBall = state.bodies.find((body) => body.id === "ball-1");
    const heavyBall = state.bodies.find((body) => body.id === "ball-3");

    expect(TEST_MAP_PHYSICS_SCALE).toBe(1000);
    expect(TEST_MAP_WIDTH).toBe(960 * TEST_MAP_PHYSICS_SCALE);
    expect(TEST_MAP_HEIGHT).toBe(560 * TEST_MAP_PHYSICS_SCALE);
    expect(firstBall?.position).toEqual({
      x: 230 * TEST_MAP_PHYSICS_SCALE,
      y: 280 * TEST_MAP_PHYSICS_SCALE
    });
    expect(firstBall?.radius).toBe(18 * TEST_MAP_PHYSICS_SCALE);
    expect(firstBall?.mass).toBe(1 * TEST_MAP_PHYSICS_SCALE);
    expect(heavyBall?.mass).toBe(2.25 * TEST_MAP_PHYSICS_SCALE);
  });
});
