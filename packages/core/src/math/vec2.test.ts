import { describe, expect, it } from "vitest";
import {
  add,
  angleOf,
  clampMagnitude,
  distance,
  dot,
  fromAngle,
  length,
  normalize,
  rotate,
  scale,
  sub
} from "./vec2";

describe("Vec2 helpers", () => {
  it("performs basic vector operations without mutating inputs", () => {
    const a = { x: 3, y: 4 };
    const b = { x: 1, y: 2 };

    expect(add(a, b)).toEqual({ x: 4, y: 6 });
    expect(sub(a, b)).toEqual({ x: 2, y: 2 });
    expect(scale(a, 2)).toEqual({ x: 6, y: 8 });
    expect(dot(a, b)).toBe(11);
    expect(length(a)).toBe(5);
    expect(distance(a, b)).toBeCloseTo(Math.sqrt(8));
    expect(a).toEqual({ x: 3, y: 4 });
    expect(b).toEqual({ x: 1, y: 2 });
  });

  it("normalizes, rotates, and creates angles safely", () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(normalize({ x: 0, y: 5 })).toEqual({ x: 0, y: 1 });

    const rotated = rotate({ x: 1, y: 0 }, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);

    const angled = fromAngle(Math.PI / 2, 10);
    expect(angled.x).toBeCloseTo(0);
    expect(angled.y).toBeCloseTo(10);
    expect(angleOf({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
  });

  it("clamps magnitude only when needed", () => {
    expect(clampMagnitude({ x: 3, y: 4 }, 10)).toEqual({ x: 3, y: 4 });

    const clamped = clampMagnitude({ x: 3, y: 4 }, 2);
    expect(length(clamped)).toBeCloseTo(2);
  });
});
