import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { ShotIntent } from "../types/shot";
import { simulateShot } from "../simulation/simulateShot";
import type { BotOptions } from "./botOptions";
import { resolveBotOptions } from "./botOptions";
import { generateCandidates } from "./generateCandidates";
import { scoreShot } from "./scoreShot";

/**
 * Evaluates 40 random weighted shots plus any direct ring-out shots, then
 * returns the highest-scoring legal intent.
 */
export function chooseBotShot(
  gameState: GameState,
  mapData: MapData,
  playerId: string,
  partialOptions: Partial<BotOptions> = {}
): ShotIntent | undefined {
  const options = resolveBotOptions(partialOptions);
  const candidates = generateCandidates(gameState, mapData, playerId, options);
  if (candidates.length === 0) {
    return undefined;
  }

  let bestShot = candidates[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const result = simulateShot(
      gameState,
      mapData,
      candidate,
      options.simulationOptions
    );
    const score = scoreShot(result, mapData, candidate.actorBodyId, options.shrinkCircle);

    if (score > bestScore) {
      bestScore = score;
      bestShot = candidate;
    }
  }

  return bestShot;
}
