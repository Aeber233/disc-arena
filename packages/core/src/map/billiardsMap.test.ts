import { describe, expect, it } from "vitest";
import {
  billiardsEditableMapDocument,
  billiardsMapData,
  createBilliardsGameState
} from "./billiardsMap";

describe("billiards map", () => {
  it("builds the default play map from editable map layers", () => {
    expect(billiardsEditableMapDocument.groundLayer.length).toBe(
      billiardsEditableMapDocument.widthCells * billiardsEditableMapDocument.heightCells
    );
    expect(billiardsMapData.terrain?.widthCells).toBe(
      billiardsEditableMapDocument.widthCells
    );
    expect(billiardsMapData.triggers.filter((trigger) => trigger.type === "hole")).toHaveLength(6);
    expect(billiardsMapData.colliders.length).toBeGreaterThan(0);
  });

  it("places a white-ring cue ball and ten black-ring rack balls", () => {
    const state = createBilliardsGameState();

    expect(state.bodies.map((body) => body.id)).toEqual([
      "ball-0",
      "ball-1",
      "ball-2",
      "ball-3",
      "ball-4",
      "ball-5",
      "ball-6",
      "ball-7",
      "ball-8",
      "ball-9",
      "ball-10"
    ]);
    expect(state.bodies[0]?.tags).toContain("number:0");
    expect(state.bodies[0]?.tags).toContain("outerColor:#f8f8f3");
    for (const body of state.bodies.slice(1)) {
      expect(body.tags).toContain("outerColor:#050505");
    }
  });

  it("keeps rack balls visibly separated", () => {
    const rackBalls = createBilliardsGameState().bodies.slice(1);
    let minGap = Number.POSITIVE_INFINITY;

    for (let a = 0; a < rackBalls.length; a += 1) {
      for (let b = a + 1; b < rackBalls.length; b += 1) {
        const first = rackBalls[a]!;
        const second = rackBalls[b]!;
        const centerDistance = Math.hypot(
          first.position.x - second.position.x,
          first.position.y - second.position.y
        );
        minGap = Math.min(minGap, centerDistance - first.radius - second.radius);
      }
    }

    expect(minGap).toBeGreaterThan(rackBalls[0]!.radius * 0.4);
  });
});
