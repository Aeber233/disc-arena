import { describe, expect, it } from "vitest";
import { length } from "../../math/vec2";
import type { Portal } from "../../types/portal";
import {
  transformPointBetweenPortals,
  transformVectorBetweenPortals
} from "./portalTransforms";

describe("portalTransforms", () => {
  it("preserves vector speed while rotating direction by portal orientation", () => {
    const from: Portal = {
      id: "from",
      position: { x: 100, y: 100 },
      normal: { x: 1, y: 0 },
      width: 80
    };
    const to: Portal = {
      id: "to",
      position: { x: 300, y: 300 },
      normal: { x: 0, y: -1 },
      width: 80
    };

    const velocity = { x: -20, y: 0 };
    const transformed = transformVectorBetweenPortals(velocity, from, to);

    expect(length(transformed)).toBeCloseTo(length(velocity));
    expect(transformed.x).toBeCloseTo(0);
    expect(transformed.y).toBeCloseTo(-20);
  });

  it("maps points relative to the source portal center", () => {
    const from: Portal = {
      id: "from",
      position: { x: 100, y: 100 },
      normal: { x: 1, y: 0 },
      width: 80
    };
    const to: Portal = {
      id: "to",
      position: { x: 300, y: 300 },
      normal: { x: -1, y: 0 },
      width: 80
    };

    const transformed = transformPointBetweenPortals({ x: 90, y: 120 }, from, to);

    expect(transformed.x).toBeCloseTo(290);
    expect(transformed.y).toBeCloseTo(320);
  });
});
