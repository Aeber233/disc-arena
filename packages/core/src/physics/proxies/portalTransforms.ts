import { add, rotate, scale, sub } from "../../math/vec2";
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
  return {
    position: to.position,
    rotation
  };
}
