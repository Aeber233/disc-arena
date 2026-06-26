import { add, fromAngle } from "../math/vec2";
import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { ShotIntent } from "../types/shot";
import type { SimulationEvent } from "../types/simulation";

/**
 * Converts input shot data into physical velocity and spin changes.
 */
export function shotIntentToVelocity(shotIntent: ShotIntent) {
  return fromAngle(shotIntent.angle, Math.max(0, shotIntent.power));
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
  actor.velocity = add(actor.velocity, shotIntentToVelocity(shotIntent));
  actor.spin += shotIntent.spinOffset * actor.spinControl;

  return [
    {
      type: "shot_applied",
      step,
      bodyIds: [actor.id],
      data: {
        angle: shotIntent.angle,
        power: shotIntent.power,
        spinOffset: shotIntent.spinOffset,
        itemId: shotIntent.itemId
      }
    }
  ];
}

function wakeBody(body: BodyState): void {
  body.sleep = false;
}
