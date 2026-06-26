import type { BodyState } from "../../types/body";
import type { MapData } from "../../types/map";
import type { BodyProxy } from "../../types/portal";
import { IDENTITY_TRANSFORM } from "./portalTransforms";

export const MAX_PORTAL_PATH_LENGTH = 1;

/**
 * Builds collision proxies for alive bodies. Portal shadows are reserved for a
 * later precise portal pass and are intentionally non-recursive.
 */
export function buildBodyProxies(
  bodies: readonly BodyState[],
  _mapData: MapData
): BodyProxy[] {
  return bodies
    .filter((body) => body.alive)
    .map((body) => ({
      proxyId: `${body.id}:primary`,
      bodyId: body.id,
      kind: "primary",
      position: { ...body.position },
      velocity: { ...body.velocity },
      radius: body.radius,
      mass: body.mass,
      transformToBody: IDENTITY_TRANSFORM,
      transformFromBody: IDENTITY_TRANSFORM,
      portalPath: []
    }));
}
