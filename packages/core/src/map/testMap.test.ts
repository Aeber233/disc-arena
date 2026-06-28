import { describe, expect, it } from "vitest";
import {
  createTestMapGameState,
  TEST_MAP_HEIGHT,
  TEST_MAP_PHYSICS_SCALE,
  TEST_MAP_WIDTH
} from "./testMap";
import {
  PIXEL_BODY_MAX_RADIUS_PX,
  PIXEL_BODY_MIN_RADIUS_PX,
  PIXEL_BODY_RADIUS_TIERS,
  pixelBodyRadius
} from "./pixelBodySizes";

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
    expect(firstBall?.radius).toBe(pixelBodyRadius("18px"));
    expect(firstBall?.mass).toBe(1 * TEST_MAP_PHYSICS_SCALE);
    expect(heavyBall?.mass).toBe(2.25 * TEST_MAP_PHYSICS_SCALE);
  });

  it("uses only fixed 1px body radius tiers", () => {
    const tierRadii = new Set(PIXEL_BODY_RADIUS_TIERS.map((tier) => tier.radius));
    const state = createTestMapGameState();

    expect(state.bodies.every((body) => tierRadii.has(body.radius))).toBe(true);
  });

  it("names body radius tiers by pixel radius", () => {
    expect(PIXEL_BODY_RADIUS_TIERS[0]?.id).toBe(`${PIXEL_BODY_MIN_RADIUS_PX}px`);
    expect(PIXEL_BODY_RADIUS_TIERS.at(-1)?.id).toBe(`${PIXEL_BODY_MAX_RADIUS_PX}px`);

    for (let index = 0; index < PIXEL_BODY_RADIUS_TIERS.length; index += 1) {
      const tier = PIXEL_BODY_RADIUS_TIERS[index];
      expect(tier?.pixelRadius).toBe(PIXEL_BODY_MIN_RADIUS_PX + index);
      expect(tier?.id).toBe(`${tier?.pixelRadius}px`);
      expect(tier?.radius).toBe((tier!.pixelRadius + 0.5) * TEST_MAP_PHYSICS_SCALE);
    }
  });
});
