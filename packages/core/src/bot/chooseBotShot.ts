import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import type { ShotIntent } from "../types/shot";
import { simulateShot } from "../simulation/simulateShot";
import type { BotOptions } from "./botOptions";
import { resolveBotOptions } from "./botOptions";
import { generateCandidates } from "./generateCandidates";
import { scoreShot } from "./scoreShot";

/**
 * Evaluates bounded candidates with fast_eval simulation and returns the best
 * legal shot found.
 */
export function chooseBotShot(
  gameState: GameState,
  mapData: MapData,
  actorBodyId: string,
  partialOptions: Partial<BotOptions> = {}
): ShotIntent {
  const options = resolveBotOptions(partialOptions);
  const candidates = generateCandidates(gameState, actorBodyId, options);
  const fallback = candidates[0] ?? {
    actorBodyId,
    angle: 0,
    power: 0,
    spinOffset: 0
  };

  let bestShot = fallback;
  let bestScore = Number.NEGATIVE_INFINITY;
  const deadline = Date.now() + Math.max(0, options.maxThinkTimeMs);

  for (const candidate of candidates) {
    if (Date.now() > deadline) {
      break;
    }

    const result = simulateShot(
      gameState,
      mapData,
      candidate,
      options.simulationOptions
    );
    const score = scoreShot(result, mapData, actorBodyId);

    if (score > bestScore) {
      bestScore = score;
      bestShot = candidate;
    }
  }

  return bestShot;
}
