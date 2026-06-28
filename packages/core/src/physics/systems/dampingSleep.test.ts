import { describe, expect, it } from "vitest";
import type { BodyState } from "../../types/body";
import { PHYSICS_UNIT_SCALE } from "../units";
import { applyDamping } from "./damping";
import { updateSleepState } from "./sleep";

describe("damping and sleep", () => {
  it("strongly brakes low-speed bodies without instantly zeroing them", () => {
    const initialSpeed = 20 * PHYSICS_UNIT_SCALE;
    const body = makeBody({ velocity: { x: initialSpeed, y: 0 }, spin: 0 });

    applyDamping([body], 1 / 60);

    expect(body.velocity.x).toBeGreaterThan(0);
    expect(body.velocity.x).toBeLessThan(initialSpeed);
  });

  it("damps velocity and spin until a body sleeps", () => {
    const body = makeBody({ velocity: { x: 10 * PHYSICS_UNIT_SCALE, y: 0 }, spin: 1 });

    for (let i = 0; i < 40; i += 1) {
      applyDamping([body], 0.25);
      updateSleepState([body]);
    }

    expect(body.velocity).toEqual({ x: 0, y: 0 });
    expect(body.spin).toBe(0);
    expect(body.sleep).toBe(true);
  });
});

function makeBody(options: {
  readonly velocity: { readonly x: number; readonly y: number };
  readonly spin: number;
}): BodyState {
  return {
    id: "disc-a",
    kind: "disc",
    ownerPlayerId: "p1",
    teamId: "red",
    position: { x: 0, y: 0 },
    velocity: { ...options.velocity },
    radius: 10 * PHYSICS_UNIT_SCALE,
    mass: PHYSICS_UNIT_SCALE,
    damping: 1,
    spin: options.spin,
    spinControl: 1,
    alive: true,
    sleep: false,
    tags: [],
    modifiers: []
  };
}
