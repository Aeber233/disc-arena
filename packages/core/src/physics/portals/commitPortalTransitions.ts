import type { BodyState } from "../../types/body";
import type { MapData } from "../../types/map";
import type { SimulationEvent } from "../../types/simulation";

/**
 * Reserved portal transition commit stage. Precise portal crossing and clipping
 * will be added after proxy collision behavior is expanded.
 */
export function commitPortalTransitions(
  _bodies: BodyState[],
  _mapData: MapData,
  _step: number
): readonly SimulationEvent[] {
  return [];
}
