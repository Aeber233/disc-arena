import type { GameState } from "./game";
import type { MapData } from "./map";
import type { ShotIntent } from "./shot";
import type { SimulationEvent } from "./simulation";

export interface RoomPlayer {
  readonly playerId: string;
  readonly connected: boolean;
  readonly joinIndex: number;
}

export interface RoomStatePayload {
  readonly roomId: string;
  readonly playerId?: string;
  readonly players: readonly RoomPlayer[];
  readonly mapData: MapData;
  readonly gameState: GameState;
  readonly stateHash: string;
}

export interface RoomJoinedPayload extends RoomStatePayload {
  readonly playerId: string;
}

export interface ShotSubmitPayload {
  readonly shotId: string;
  readonly turnIndex: number;
  readonly knownStateHash: string;
  readonly shotIntent: ShotIntent;
}

export interface ShotStartedPayload {
  readonly shotId: string;
  readonly playerId: string;
  readonly turnIndex: number;
  readonly initialStateHash: string;
  readonly shotIntent: ShotIntent;
}

export interface ShotRejectedPayload {
  readonly shotId: string;
  readonly reason: string;
  readonly gameState: GameState;
  readonly stateHash: string;
}

/**
 * Future low-bandwidth shot settlement payload.
 */
export interface ShotResolvedPayload {
  readonly shotId: string;
  readonly playerId?: string;
  readonly initialStateHash: string;
  readonly shotIntent: ShotIntent;
  readonly finalState: GameState;
  readonly events: readonly SimulationEvent[];
  readonly resultHash: string;
}

export interface ClientToServerEvents {
  readonly "shot:submit": (payload: ShotSubmitPayload) => void;
  readonly "room:reset": () => void;
}

export interface ServerToClientEvents {
  readonly "room:joined": (payload: RoomJoinedPayload) => void;
  readonly "room:state": (payload: RoomStatePayload) => void;
  readonly "shot:started": (payload: ShotStartedPayload) => void;
  readonly "shot:resolved": (payload: ShotResolvedPayload) => void;
  readonly "shot:rejected": (payload: ShotRejectedPayload) => void;
}
