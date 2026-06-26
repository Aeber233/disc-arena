import type { BodyState } from "../types/body";
import type { MapData } from "../types/map";
import type { SimulationResult } from "../types/simulation";
import { dangerScore } from "./dangerScore";

/**
 * First-pass bot heuristic focused on eliminations and danger-zone position.
 */
export function scoreShot(
  result: SimulationResult,
  mapData: MapData,
  actorBodyId: string
): number {
  const initialActor = findBody(result.initialState.bodies, actorBodyId);
  const finalActor = findBody(result.finalState.bodies, actorBodyId);
  const actorTeamId = initialActor?.teamId;
  let score = 0;

  for (const initialBody of result.initialState.bodies) {
    const finalBody = findBody(result.finalState.bodies, initialBody.id);
    if (!initialBody.alive || finalBody?.alive !== false) {
      continue;
    }

    if (initialBody.id === actorBodyId) {
      score -= 1000;
    } else if (actorTeamId && initialBody.teamId === actorTeamId) {
      score -= 80;
    } else {
      score += 120;
    }
  }

  if (finalActor && !finalActor.alive) {
    score -= 1000;
  }

  score += dangerScore(result.finalState, mapData, actorTeamId);
  return score;
}

function findBody(
  bodies: readonly BodyState[],
  bodyId: string
): BodyState | undefined {
  return bodies.find((body) => body.id === bodyId);
}
