import { add, distance, scale } from "../../math/vec2";
import type { BodyState } from "../../types/body";
import type { MapData, MapTrigger } from "../../types/map";
import type { SimulationEvent } from "../../types/simulation";

/**
 * First-stage trigger resolver. It keeps trigger dispatch structured while
 * leaving richer item and rule behavior for future effect hooks.
 */
export function resolveTriggers(
  bodies: BodyState[],
  mapData: MapData,
  fixedDt: number,
  step: number
): readonly SimulationEvent[] {
  const events: SimulationEvent[] = [];

  for (const body of bodies) {
    if (!body.alive) {
      continue;
    }

    for (const trigger of mapData.triggers) {
      if (!isInsideTrigger(body, trigger)) {
        continue;
      }

      events.push({
        type: "trigger_enter",
        step,
        bodyIds: [body.id],
        data: { triggerId: trigger.id, triggerType: trigger.type }
      });

      if (trigger.type === "hole") {
        body.alive = false;
        body.sleep = true;
        body.velocity = { x: 0, y: 0 };
        body.spin = 0;
        events.push({
          type: "body_eliminated",
          step,
          bodyIds: [body.id],
          data: { triggerId: trigger.id }
        });
      }

      if (trigger.type === "force_field") {
        body.velocity = add(body.velocity, scale(trigger.force, fixedDt));
      }

      if (trigger.type === "pickup") {
        events.push({
          type: "pickup_available",
          step,
          bodyIds: [body.id],
          data: { triggerId: trigger.id, itemId: trigger.itemId }
        });
      }
    }
  }

  return events;
}

function isInsideTrigger(body: BodyState, trigger: MapTrigger): boolean {
  return distance(body.position, trigger.position) <= trigger.radius + body.radius;
}
