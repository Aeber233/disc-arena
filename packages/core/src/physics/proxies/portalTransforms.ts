import { add, dot, length, normalize, rotate, scale, sub } from "../../math/vec2";
import type { Vec2 } from "../../math/vec2";
import type { Portal, Transform2D } from "../../types/portal";

export const IDENTITY_TRANSFORM: Transform2D = {
  position: { x: 0, y: 0 },
  rotation: 0
};

/**
 * Transforms a point by rotation and translation.
 */
export function transformPoint(point: Vec2, transform: Transform2D): Vec2 {
  return add(rotate(point, transform.rotation), transform.position);
}

/**
 * Transforms a vector direction. Velocity and impulse use this path because
 * translation should not affect them.
 */
export function transformVector(vector: Vec2, transform: Transform2D): Vec2 {
  return rotate(vector, transform.rotation);
}

export function inverseTransform(transform: Transform2D): Transform2D {
  const inverseRotation = -transform.rotation;
  return {
    position: rotate(scale(transform.position, -1), inverseRotation),
    rotation: inverseRotation
  };
}

export function inverseTransformPoint(point: Vec2, transform: Transform2D): Vec2 {
  return rotate(sub(point, transform.position), -transform.rotation);
}

export function inverseTransformVector(vector: Vec2, transform: Transform2D): Vec2 {
  return rotate(vector, -transform.rotation);
}

export function transformBetweenPortals(from: Portal, to: Portal): Transform2D {
  const fromAngle = Math.atan2(from.normal.y, from.normal.x);
  const toAngle = Math.atan2(to.normal.y, to.normal.x);
  const rotation = toAngle - fromAngle + Math.PI;
  const rotatedSourcePosition = rotate(from.position, rotation);
  return {
    position: sub(to.position, rotatedSourcePosition),
    rotation
  };
}

export function transformPointBetweenPortals(
  point: Vec2,
  from: Portal,
  to: Portal
): Vec2 {
  return transformPoint(point, transformBetweenPortals(from, to));
}

export function transformVectorBetweenPortals(
  vector: Vec2,
  from: Portal,
  to: Portal
): Vec2 {
  return transformVector(vector, transformBetweenPortals(from, to));
}

export function portalNormal(portal: Portal): Vec2 {
  return normalize(portal.normal);
}

export function portalTangent(portal: Portal): Vec2 {
  const normal = portalNormal(portal);
  return { x: -normal.y, y: normal.x };
}

export function signedDistanceToPortalPlane(point: Vec2, portal: Portal): number {
  return dot(sub(point, portal.position), portalNormal(portal));
}

export function portalTangentOffset(point: Vec2, portal: Portal): number {
  return dot(sub(point, portal.position), portalTangent(portal));
}

export function isPointWithinPortalAperture(
  point: Vec2,
  portal: Portal,
  tolerance = 0
): boolean {
  return Math.abs(portalTangentOffset(point, portal)) <= portal.width / 2 + tolerance;
}

export function isCircleOverlappingPortal(
  position: Vec2,
  radius: number,
  portal: Portal
): boolean {
  return (
    Math.abs(signedDistanceToPortalPlane(position, portal)) <= radius &&
    Math.abs(portalTangentOffset(position, portal)) <= portal.width / 2 + radius
  );
}

export function portalEndpointA(portal: Portal): Vec2 {
  return add(portal.position, scale(portalTangent(portal), -portal.width / 2));
}

export function portalEndpointB(portal: Portal): Vec2 {
  return add(portal.position, scale(portalTangent(portal), portal.width / 2));
}

export function transformedSpeedMatches(
  before: Vec2,
  after: Vec2,
  epsilon = 0.000001
): boolean {
  return Math.abs(length(before) - length(after)) <= epsilon;
}
