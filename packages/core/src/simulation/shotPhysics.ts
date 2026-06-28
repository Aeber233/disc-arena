import { add, fromAngle } from "../math/vec2";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { ShotIntent } from "../types/shot";
import type { SimulationEvent } from "../types/simulation";

/**
 * Converts input shot force into a velocity change. Power is kept at the same
 * coarse scale as distances, then converted into scaled velocity by mass.
 */
export function shotIntentToVelocity(shotIntent: ShotIntent, mass = PHYSICS_UNIT_SCALE) {
  const safeMass = mass > 0 ? mass : PHYSICS_UNIT_SCALE;
  const speedDelta = (Math.max(0, shotIntent.power) * PHYSICS_UNIT_SCALE) / safeMass;
  return fromAngle(shotIntent.angle, speedDelta);
}

export function applyShotIntentToState(
  state: GameState,
  shotIntent: ShotIntent,
  step: number
): readonly SimulationEvent[] {
  const actor = state.bodies.find((body) => body.id === shotIntent.actorBodyId);
  if (!actor || !actor.alive) {
    return [
      {
        type: "shot_rejected",
        step,
        bodyIds: [shotIntent.actorBodyId],
        data: { reason: actor ? "actor_not_alive" : "actor_not_found" }
      }
    ];
  }

  wakeBody(actor);
  actor.velocity = add(actor.velocity, shotIntentToVelocity(shotIntent, actor.mass));
  actor.spin += shotIntent.spinOffset * actor.spinControl;

  return [
    {
      type: "shot_applied",
      step,
      bodyIds: [actor.id],
      data: {
        angle: shotIntent.angle,
        power: shotIntent.power,
        actorMass: actor.mass,
        spinOffset: shotIntent.spinOffset,
        itemId: shotIntent.itemId
      }
    }
  ];
}

function wakeBody(body: BodyState): void {
  body.sleep = false;
}
