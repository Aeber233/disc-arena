import { scale } from "../../math/vec2";
import type { BodyState } from "../../types/body";
import type { MapData } from "../../types/map";
import type { BodyProxy, HalfPlane, Portal, PortalPair } from "../../types/portal";
import {
  IDENTITY_TRANSFORM,
  inverseTransform,
  isCircleOverlappingPortal,
  portalNormal,
  signedDistanceToPortalPlane,
  transformBetweenPortals,
  transformPoint,
  transformVector
} from "./portalTransforms";

export const MAX_PORTAL_PATH_LENGTH = 1;

/**
 * Builds collision proxies for alive bodies. Portal shadows mirror the crossed
 * slice of a body into the paired portal and are intentionally non-recursive.
 */
export function buildBodyProxies(
  bodies: readonly BodyState[],
  mapData: MapData
): BodyProxy[] {
  const proxies: BodyProxy[] = [];

  for (const body of bodies) {
    if (!body.alive) {
      continue;
    }

    proxies.push(createPrimaryProxy(body, mapData));
    proxies.push(...createPortalShadowProxies(body, mapData));
  }

  return proxies;
}

function createPrimaryProxy(body: BodyState, mapData: MapData): BodyProxy {
  const clipMask = primaryClipMask(body, mapData);
  return {
    proxyId: `${body.id}:primary`,
    bodyId: body.id,
    kind: "primary",
    position: { ...body.position },
    velocity: { ...body.velocity },
    radius: body.radius,
    mass: body.mass,
    transformToBody: IDENTITY_TRANSFORM,
    transformFromBody: IDENTITY_TRANSFORM,
    ...(clipMask ? { clipMask } : {}),
    portalPath: []
  };
}

function createPortalShadowProxies(
  body: BodyState,
  mapData: MapData
): BodyProxy[] {
  const shadows: BodyProxy[] = [];

  for (const pair of mapData.portals) {
    if (pair.enabled === false) {
      continue;
    }

    const aToB = createPortalShadowProxy(body, pair, pair.a, pair.b);
    if (aToB) {
      shadows.push(aToB);
    }

    const bToA = createPortalShadowProxy(body, pair, pair.b, pair.a);
    if (bToA) {
      shadows.push(bToA);
    }
  }

  return shadows;
}

function createPortalShadowProxy(
  body: BodyState,
  pair: PortalPair,
  from: Portal,
  to: Portal
): BodyProxy | undefined {
  if (!isCircleOverlappingPortal(body.position, body.radius, from)) {
    return undefined;
  }

  const signedDistance = signedDistanceToPortalPlane(body.position, from);
  if (Math.abs(signedDistance) >= body.radius) {
    return undefined;
  }

  const transformFromBody = transformBetweenPortals(from, to);
  const transformToBody = inverseTransform(transformFromBody);
  const side = signedDistance >= 0 ? 1 : -1;

  return {
    proxyId: `${body.id}:portal_shadow:${pair.id}:${from.id}->${to.id}`,
    bodyId: body.id,
    kind: "portal_shadow",
    position: transformPoint(body.position, transformFromBody),
    velocity: transformVector(body.velocity, transformFromBody),
    radius: body.radius,
    mass: body.mass,
    transformToBody,
    transformFromBody,
    clipMask: {
      halfPlanes: [portalHalfPlane(to, side)],
      tags: ["portal_shadow"]
    },
    portalPairId: pair.id,
    portalPath: [pair.id]
  };
}

function primaryClipMask(body: BodyState, mapData: MapData) {
  const halfPlanes: HalfPlane[] = [];

  for (const pair of mapData.portals) {
    if (pair.enabled === false) {
      continue;
    }

    collectPrimaryClipHalfPlane(body, pair.a, halfPlanes);
    collectPrimaryClipHalfPlane(body, pair.b, halfPlanes);
  }

  return halfPlanes.length > 0
    ? {
        halfPlanes,
        tags: ["portal_primary"]
      }
    : undefined;
}

function collectPrimaryClipHalfPlane(
  body: BodyState,
  portal: Portal,
  halfPlanes: HalfPlane[]
): void {
  if (!isCircleOverlappingPortal(body.position, body.radius, portal)) {
    return;
  }

  const signedDistance = signedDistanceToPortalPlane(body.position, portal);
  if (Math.abs(signedDistance) >= body.radius) {
    return;
  }

  const side = signedDistance >= 0 ? 1 : -1;
  halfPlanes.push(portalHalfPlane(portal, side));
}

function portalHalfPlane(portal: Portal, side: number): HalfPlane {
  return {
    point: portal.position,
    normal: scale(portalNormal(portal), side >= 0 ? 1 : -1)
  };
}
