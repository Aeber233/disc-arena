import { add, scale } from "../../math/vec2";
import type { BodyState } from "../../types/body";

/**
 * Reserved velocity integration stage for future forces and impulses.
 */
export function integrateVelocity(_bodies: BodyState[], _fixedDt: number): void {
  // Forces are intentionally left for later systems.
}

/**
 * Applies velocity to position for awake alive bodies.
 */
export function integratePosition(bodies: BodyState[], fixedDt: number): void {
  for (const body of bodies) {
    if (!body.alive || body.sleep) {
      continue;
    }
    body.position = add(body.position, scale(body.velocity, fixedDt));
  }
}
