import { chooseBotShot } from "@disc-arena/core";
import type { GameState, MapData, ShotIntent, ShrinkCircleState } from "@disc-arena/core";

/**
 * Temporary server-side bot input provider.
 * Bots must provide the same ShotIntent shape as human clients.
 */
export function chooseBotShotIntent(
  gameState: GameState,
  mapData: MapData,
  botPlayerId: string,
  shrinkCircle?: ShrinkCircleState
): ShotIntent | undefined {
  return chooseBotShot(gameState, mapData, botPlayerId, {
    rngSeed: gameState.rngSeed + gameState.turnIndex,
    ...(shrinkCircle ? { shrinkCircle } : {}),
    simulationOptions: {
      mode: "fast_eval",
      fixedDt: 1 / 20,
      maxSteps: 80,
      collisionIterations: 1,
      recordFrames: false,
      frameIntervalSteps: 5,
      quantize: true
    }
  });
}
