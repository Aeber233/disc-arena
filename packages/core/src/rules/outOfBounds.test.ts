import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import type { MapData } from "../types/map";
import {
  createOutOfBoundsTracker,
  outsideTableAreaRatio,
  updateOutOfBoundsBodies
} from "./outOfBounds";

describe("out-of-bounds rule", () => {
  it("marks a body dead only after most of it stays outside long enough", () => {
    const body = makeBody({ x: 118, y: 50 });
    const tracker = createOutOfBoundsTracker();

    expect(outsideTableAreaRatio(body, mapData.tableBounds!)).toBeGreaterThanOrEqual(0.8);

    const firstEvents = updateOutOfBoundsBodies(
      [body],
      mapData,
      tracker,
      0.2,
      1
    );
    expect(firstEvents).toHaveLength(0);
    expect(body.alive).toBe(true);

    const secondEvents = updateOutOfBoundsBodies(
      [body],
      mapData,
      tracker,
      0.21,
      2
    );
    expect(secondEvents[0]?.type).toBe("body_out_of_bounds");
    expect(body.alive).toBe(false);
    expect(body.sleep).toBe(true);
  });
});

const mapData: MapData = {
  id: "bounds",
  tableBounds: { left: 0, top: 0, right: 100, bottom: 100 },
  colliders: [],
  triggers: [],
  portals: []
};

function makeBody(position: { x: number; y: number }): BodyState {
  return {
    id: "ball",
    kind: "disc",
    position,
    velocity: { x: 1, y: 0 },
    radius: 10,
    mass: 1,
    damping: 1,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: false,
    tags: [],
    modifiers: []
  };
}
