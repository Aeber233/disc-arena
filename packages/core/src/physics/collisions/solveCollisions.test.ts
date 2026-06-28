import { describe, expect, it } from "vitest";
import type { MapData } from "../../types/map";
import type { BodyProxy } from "../../types/portal";
import { IDENTITY_TRANSFORM } from "../proxies/portalTransforms";
import { solveCollisions } from "./solveCollisions";

describe("solveCollisions", () => {
  it("passes velocity from one moving equal-mass body to a resting equal-mass body", () => {
    const moving = makeProxy("moving", 1, { x: 0, y: 0 }, { x: 10, y: 0 });
    const resting = makeProxy("resting", 1, { x: 19, y: 0 }, { x: 0, y: 0 });

    solveCollisions([moving, resting], [], emptyMap, 1, 1 / 60, 1);

    expect(moving.velocity.x).toBeCloseTo(0);
    expect(resting.velocity.x).toBeCloseTo(10);
  });

  it("bounces a low-mass body backward while nudging a high-mass body forward", () => {
    const light = makeProxy("light", 1, { x: 0, y: 0 }, { x: 10, y: 0 });
    const heavy = makeProxy("heavy", 10, { x: 19, y: 0 }, { x: 0, y: 0 });

    solveCollisions([light, heavy], [], emptyMap, 1, 1 / 60, 1);

    expect(light.velocity.x).toBeLessThan(0);
    expect(heavy.velocity.x).toBeGreaterThan(0);
    expect(heavy.velocity.x).toBeLessThan(3);
  });

  it("keeps a high-mass body moving while launching a low-mass body faster", () => {
    const heavy = makeProxy("heavy", 10, { x: 0, y: 0 }, { x: 10, y: 0 });
    const light = makeProxy("light", 1, { x: 19, y: 0 }, { x: 0, y: 0 });

    solveCollisions([heavy, light], [], emptyMap, 1, 1 / 60, 1);

    expect(heavy.velocity.x).toBeGreaterThan(7);
    expect(heavy.velocity.x).toBeLessThan(10);
    expect(light.velocity.x).toBeGreaterThan(10);
  });

  it("conserves total momentum and kinetic energy for body-body collisions", () => {
    const a = makeProxy("a", 2, { x: 0, y: 0 }, { x: 8, y: 3 });
    const b = makeProxy("b", 5, { x: 19, y: 0 }, { x: -1, y: -2 });
    const beforeMomentum = totalMomentum([a, b]);
    const beforeEnergy = totalKineticEnergy([a, b]);

    solveCollisions([a, b], [], emptyMap, 1, 1 / 60, 1);

    const afterMomentum = totalMomentum([a, b]);
    const afterEnergy = totalKineticEnergy([a, b]);
    expect(afterMomentum.x).toBeCloseTo(beforeMomentum.x);
    expect(afterMomentum.y).toBeCloseTo(beforeMomentum.y);
    expect(afterEnergy).toBeCloseTo(beforeEnergy);
  });

  it("reflects from static walls using wall restitution, including values above one", () => {
    const ball = makeProxy("ball", 1, { x: 11, y: 0 }, { x: 10, y: 0 }, 2);
    const mapData: MapData = {
      id: "wall-map",
      colliders: [
        {
          type: "static_wall",
          id: "right-wall",
          start: { x: 10, y: -20 },
          end: { x: 10, y: 20 },
          restitution: 1.5
        }
      ],
      triggers: [],
      portals: []
    };

    const result = solveCollisions([ball], [], mapData, 1, 0.2, 1);

    expect(ball.position.x).toBeCloseTo(8);
    expect(ball.velocity.x).toBeCloseTo(-15);
    expect(result.events[0]).toMatchObject({
      type: "wall_collision",
      bodyIds: ["ball"],
      data: {
        wallId: "right-wall",
        restitution: 1.5
      }
    });
  });
});

const emptyMap: MapData = {
  id: "empty",
  colliders: [],
  triggers: [],
  portals: []
};

function makeProxy(
  bodyId: string,
  mass: number,
  position: { x: number; y: number },
  velocity: { x: number; y: number },
  radius = 10
): BodyProxy {
  return {
    proxyId: `${bodyId}:primary`,
    bodyId,
    kind: "primary",
    position,
    velocity,
    radius,
    mass,
    transformToBody: IDENTITY_TRANSFORM,
    transformFromBody: IDENTITY_TRANSFORM,
    portalPath: []
  };
}

function totalMomentum(proxies: readonly BodyProxy[]) {
  return proxies.reduce(
    (momentum, proxy) => ({
      x: momentum.x + proxy.velocity.x * proxy.mass,
      y: momentum.y + proxy.velocity.y * proxy.mass
    }),
    { x: 0, y: 0 }
  );
}

function totalKineticEnergy(proxies: readonly BodyProxy[]): number {
  return proxies.reduce(
    (energy, proxy) =>
      energy +
      0.5 *
        proxy.mass *
        (proxy.velocity.x * proxy.velocity.x + proxy.velocity.y * proxy.velocity.y),
    0
  );
}
