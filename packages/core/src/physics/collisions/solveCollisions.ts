import { add, dot, length, scale, sub } from "../../math/vec2";
import type { BodyState } from "../../types/body";
import type { BodyProxy } from "../../types/portal";
import type { SimulationEvent } from "../../types/simulation";

export interface CollisionSolveResult {
  readonly proxies: BodyProxy[];
  readonly events: readonly SimulationEvent[];
}

/**
 * Minimal circle proxy collision solver. Clip masks and portal-specific
 * filtering are reserved by type but not implemented in stage one.
 */
export function solveCollisions(
  proxies: BodyProxy[],
  _bodies: readonly BodyState[],
  collisionIterations: number,
  step: number
): CollisionSolveResult {
  const events: SimulationEvent[] = [];
  const emittedPairs = new Set<string>();
  const iterations = Math.max(1, collisionIterations);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let i = 0; i < proxies.length; i += 1) {
      const a = proxies[i];
      if (!a) {
        continue;
      }

      for (let j = i + 1; j < proxies.length; j += 1) {
        const b = proxies[j];
        if (!b || a.bodyId === b.bodyId) {
          continue;
        }

        const pairEvents = solveProxyPair(a, b, step, emittedPairs);
        events.push(...pairEvents);
      }
    }
  }

  return { proxies, events };
}

function solveProxyPair(
  a: BodyProxy,
  b: BodyProxy,
  step: number,
  emittedPairs: Set<string>
): readonly SimulationEvent[] {
  const delta = sub(b.position, a.position);
  const distance = length(delta);
  const minDistance = a.radius + b.radius;

  if (distance >= minDistance) {
    return [];
  }

  const normal = distance === 0 ? { x: 1, y: 0 } : scale(delta, 1 / distance);
  const penetration = minDistance - distance;
  const inverseMassA = a.mass > 0 ? 1 / a.mass : 0;
  const inverseMassB = b.mass > 0 ? 1 / b.mass : 0;
  const inverseMassTotal = inverseMassA + inverseMassB;

  if (inverseMassTotal > 0) {
    a.position = add(
      a.position,
      scale(normal, (-penetration * inverseMassA) / inverseMassTotal)
    );
    b.position = add(
      b.position,
      scale(normal, (penetration * inverseMassB) / inverseMassTotal)
    );
  }

  const relativeVelocity = sub(b.velocity, a.velocity);
  const velocityAlongNormal = dot(relativeVelocity, normal);
  if (velocityAlongNormal < 0 && inverseMassTotal > 0) {
    const restitution = 0.8;
    const impulseMagnitude =
      (-(1 + restitution) * velocityAlongNormal) / inverseMassTotal;
    const impulse = scale(normal, impulseMagnitude);
    a.velocity = sub(a.velocity, scale(impulse, inverseMassA));
    b.velocity = add(b.velocity, scale(impulse, inverseMassB));
  }

  const pairKey = [a.bodyId, b.bodyId].sort().join(":");
  if (emittedPairs.has(pairKey)) {
    return [];
  }
  emittedPairs.add(pairKey);

  return [
    {
      type: "collision",
      step,
      bodyIds: [a.bodyId, b.bodyId],
      data: { penetration }
    }
  ];
}
