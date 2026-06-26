import { describe, expect, it } from "vitest";
import type { BodyState } from "../../types/body";
import { applyDamping } from "./damping";
import { updateSleepState } from "./sleep";

describe("damping and sleep", () => {
  it("damps velocity and spin until a body sleeps", () => {
    const body: BodyState = {
      id: "disc-a",
      kind: "disc",
      ownerPlayerId: "p1",
      teamId: "red",
      position: { x: 0, y: 0 },
      velocity: { x: 10, y: 0 },
      radius: 10,
      mass: 1,
      damping: 1,
      spin: 1,
      spinControl: 1,
      alive: true,
      sleep: false,
      tags: [],
      modifiers: []
    };

    for (let i = 0; i < 40; i += 1) {
      applyDamping([body], 0.25);
      updateSleepState([body]);
    }

    expect(body.velocity).toEqual({ x: 0, y: 0 });
    expect(body.spin).toBe(0);
    expect(body.sleep).toBe(true);
  });
});
