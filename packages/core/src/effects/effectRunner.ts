import type { ActiveEffect, EffectHook } from "../types/effect";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { SimulationEvent } from "../types/simulation";

export interface EffectHookContext {
  readonly state: GameState;
  readonly mapData?: MapData;
  readonly step: number;
  readonly bodyIds?: readonly string[];
  readonly data?: Record<string, unknown>;
}

export interface EffectRunResult {
  readonly events: readonly SimulationEvent[];
}

/**
 * Runs effect hooks by name. Stage one only records hook dispatch events; later
 * rule modules can attach concrete behavior here.
 */
export function runEffectsForHook(
  effects: readonly ActiveEffect[],
  hook: EffectHook,
  context: EffectHookContext
): EffectRunResult {
  const events = effects
    .filter((effect) => effect.hooks?.includes(hook) ?? false)
    .map<SimulationEvent>((effect) => {
      const event: SimulationEvent = {
        type: "effect_hook",
        step: context.step,
        data: {
          effectId: effect.id,
          effectKind: effect.kind,
          hook,
          ...context.data
        }
      };

      if (context.bodyIds) {
        return { ...event, bodyIds: context.bodyIds };
      }

      return event;
    });

  return { events };
}
