/**
 * Pure 2D vector helpers used by all simulation code.
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ZERO_VEC2: Vec2 = { x: 0, y: 0 };

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, scalar: number): Vec2 {
  return { x: v.x * scalar, y: v.y * scalar };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  if (len === 0) {
    return ZERO_VEC2;
  }
  return scale(v, 1 / len);
}

export function rotate(v: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos
  };
}

export function fromAngle(radians: number, magnitude = 1): Vec2 {
  return {
    x: Math.cos(radians) * magnitude,
    y: Math.sin(radians) * magnitude
  };
}

export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function distance(a: Vec2, b: Vec2): number {
  return length(sub(a, b));
}

export function clampMagnitude(v: Vec2, maxMagnitude: number): Vec2 {
  const len = length(v);
  if (len === 0 || len <= maxMagnitude) {
    return { ...v };
  }
  return scale(v, maxMagnitude / len);
}
