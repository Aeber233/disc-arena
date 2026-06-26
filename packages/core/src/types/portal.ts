import type { Vec2 } from "../math/vec2";

/**
 * Portal and proxy types. The first stage supports transforms and proxy shape,
 * while precise portal clipping remains an extension point.
 */
export interface Transform2D {
  readonly position: Vec2;
  readonly rotation: number;
}

export interface HalfPlane {
  readonly point: Vec2;
  readonly normal: Vec2;
}

export interface ClipMask {
  readonly halfPlanes?: readonly HalfPlane[];
  readonly tags?: readonly string[];
}

export interface Portal {
  readonly id: string;
  readonly position: Vec2;
  readonly normal: Vec2;
  readonly width: number;
}

export interface PortalPair {
  readonly id: string;
  readonly a: Portal;
  readonly b: Portal;
  readonly enabled?: boolean;
}

export type BodyProxyKind = "primary" | "portal_shadow";

export interface BodyProxy {
  readonly proxyId: string;
  readonly bodyId: string;
  readonly kind: BodyProxyKind;
  position: Vec2;
  velocity: Vec2;
  readonly radius: number;
  readonly mass: number;
  readonly transformToBody: Transform2D;
  readonly transformFromBody: Transform2D;
  readonly clipMask?: ClipMask;
  readonly portalPairId?: string;
  readonly portalPath: readonly string[];
}
