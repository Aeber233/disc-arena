import type { GameState, MapData, ShotIntent } from "@disc-arena/core";

/**
 * Temporary server-side bot input provider.
 * Bots must provide the same ShotIntent shape as human clients.
 */
export function chooseBotShotIntent(
  gameState: GameState,
  mapData: MapData,
  botPlayerId: string
): ShotIntent | undefined {
  void mapData;
  const actor = gameState.bodies.find(
    (body) => body.alive && body.ownerPlayerId === botPlayerId
  );
  if (!actor) {
    return undefined;
  }

  return {
    actorBodyId: actor.id,
    angle: 0,
    power: 0,
    spinOffset: 0
  };
}
