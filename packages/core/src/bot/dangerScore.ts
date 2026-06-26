import { distance } from "../math/vec2";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";

/**
 * Scores danger-zone proximity: own team near danger is bad, enemies near
 * danger are good.
 */
export function dangerScore(
  gameState: GameState,
  mapData: MapData,
  actorTeamId?: string
): number {
  let score = 0;
  const dangerZones = mapData.triggers.filter(
    (trigger) => trigger.type === "danger_zone"
  );

  for (const body of gameState.bodies) {
    if (!body.alive || !body.teamId) {
      continue;
    }

    for (const zone of dangerZones) {
      const range = zone.radius + body.radius;
      const proximity = Math.max(0, 1 - distance(body.position, zone.position) / range);
      if (proximity === 0) {
        continue;
      }
      score += body.teamId === actorTeamId ? -20 * proximity : 12 * proximity;
    }
  }

  return score;
}
