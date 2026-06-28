import { describe, expect, it } from "vitest";
import type { BodyState } from "../../types/body";
import type { MapData } from "../../types/map";
import { commitPortalTransitions } from "./commitPortalTransitions";

describe("commitPortalTransitions", () => {
  it("teleports a body crossing inside the portal aperture and preserves scalar properties", () => {
    const body = makeBody({
      position: { x: -2, y: 4 },
      velocity: { x: -10, y: 0 },
      spin: 0.4
    });
    const events = commitPortalTransitions(
      [body],
      portalMap,
      7,
      new Map([["ball", { x: 5, y: 4 }]])
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "portal_transition",
      step: 7,
      bodyIds: ["ball"],
      data: {
        portalPairId: "pair",
        fromPortalId: "a",
        toPortalId: "b"
      }
    });
    expect(body.position.x).toBeCloseTo(98);
    expect(body.position.y).toBeCloseTo(4);
    expect(body.velocity.x).toBeCloseTo(-10);
    expect(body.velocity.y).toBeCloseTo(0);
    expect(body.spin).toBe(0.4);
    expect(body.mass).toBe(3);
    expect(body.radius).toBe(6);
    expect(body.portalCooldown).toMatchObject({
      portalPairId: "pair",
      exitPortalId: "b"
    });
  });

  it("does not teleport a body crossing outside the aperture", () => {
    const body = makeBody({
      position: { x: -2, y: 40 },
      velocity: { x: -10, y: 0 }
    });
    const events = commitPortalTransitions(
      [body],
      portalMap,
      1,
      new Map([["ball", { x: 5, y: 40 }]])
    );

    expect(events).toHaveLength(0);
    expect(body.position).toEqual({ x: -2, y: 40 });
  });

  it("uses cooldown to prevent immediate re-entry through the exit portal", () => {
    const body = makeBody({
      position: { x: 102, y: 0 },
      velocity: { x: 10, y: 0 },
      portalCooldown: {
        portalPairId: "pair",
        exitPortalId: "b",
        remainingSteps: 2
      }
    });
    const events = commitPortalTransitions(
      [body],
      portalMap,
      2,
      new Map([["ball", { x: 98, y: 0 }]])
    );

    expect(events).toHaveLength(0);
    expect(body.position).toEqual({ x: 102, y: 0 });
    expect(body.portalCooldown?.remainingSteps).toBe(1);
  });
});

const portalMap: MapData = {
  id: "portal-map",
  colliders: [],
  triggers: [],
  portals: [
    {
      id: "pair",
      a: {
        id: "a",
        position: { x: 0, y: 0 },
        normal: { x: 1, y: 0 },
        width: 30
      },
      b: {
        id: "b",
        position: { x: 100, y: 0 },
        normal: { x: -1, y: 0 },
        width: 30
      }
    }
  ]
};

function makeBody(overrides: Partial<BodyState>): BodyState {
  return {
    id: "ball",
    kind: "disc",
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 6,
    mass: 3,
    damping: 0,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: false,
    tags: [],
    modifiers: [],
    ...overrides
  };
}
