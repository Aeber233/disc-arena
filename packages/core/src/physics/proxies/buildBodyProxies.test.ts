import { describe, expect, it } from "vitest";
import type { BodyState } from "../../types/body";
import type { MapData } from "../../types/map";
import { buildBodyProxies } from "./buildBodyProxies";

describe("buildBodyProxies", () => {
  it("creates primary proxies for alive bodies only", () => {
    const bodies: BodyState[] = [
      makeBody("alive", true),
      makeBody("dead", false)
    ];
    const mapData: MapData = {
      id: "empty",
      colliders: [],
      triggers: [],
      portals: []
    };

    const proxies = buildBodyProxies(bodies, mapData);

    expect(proxies).toHaveLength(1);
    expect(proxies[0]).toMatchObject({
      proxyId: "alive:primary",
      bodyId: "alive",
      kind: "primary",
      portalPath: []
    });
  });

  it("creates one non-recursive portal shadow when a body overlaps a portal", () => {
    const bodies: BodyState[] = [
      {
        ...makeBody("crossing", true),
        position: { x: 4, y: 0 },
        radius: 10
      }
    ];
    const mapData: MapData = {
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
            width: 80
          },
          b: {
            id: "b",
            position: { x: 100, y: 0 },
            normal: { x: -1, y: 0 },
            width: 80
          }
        }
      ]
    };

    const proxies = buildBodyProxies(bodies, mapData);
    const shadow = proxies.find((proxy) => proxy.kind === "portal_shadow");

    expect(proxies).toHaveLength(2);
    expect(shadow).toMatchObject({
      bodyId: "crossing",
      portalPairId: "pair",
      portalPath: ["pair"]
    });
    expect(shadow?.portalPath).toHaveLength(1);
  });
});

function makeBody(id: string, alive: boolean): BodyState {
  return {
    id,
    kind: "disc",
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 10,
    mass: 1,
    damping: 0,
    spin: 0,
    spinControl: 1,
    alive,
    sleep: !alive,
    tags: [],
    modifiers: []
  };
}
