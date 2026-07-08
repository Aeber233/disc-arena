import type { GameState } from "./game";
import type { MapData } from "./map";
import type { ShotIntent } from "./shot";
import type { Vec2 } from "../math/vec2";
import type { SimulationEvent, SimulationFrame } from "./simulation";
import type { ShrinkCircleSettings, ShrinkCircleState } from "../rules/shrinkCircle";

export type RoomPhase = "lobby" | "playing" | "finished";
export type RoomMemberKind = "human" | "bot";

export interface RoomMember {
  readonly playerId: string;
  readonly name: string;
  readonly color: string;
  readonly kind: RoomMemberKind;
  readonly connected: boolean;
  readonly joinIndex: number;
  readonly isOwner: boolean;
  readonly eliminated: boolean;
  readonly ballCount: number;
}

export type RoomPlayer = RoomMember;

export interface RoomStatePayload {
  readonly roomId: string | null;
  readonly roomPhase: RoomPhase;
  readonly playerId?: string;
  readonly ownerPlayerId?: string;
  readonly currentPlayerId?: string;
  readonly winnerPlayerId?: string;
  readonly players: readonly RoomMember[];
  readonly mapData: MapData;
  readonly gameState: GameState;
  readonly shrinkCircle: ShrinkCircleState;
  readonly stateHash: string;
}

export interface RoomJoinedPayload extends RoomStatePayload {
  readonly playerId: string;
  readonly rejoinToken: string;
}

export interface RoomCreatePayload {
  readonly playerName?: string;
}

export interface RoomJoinPayload {
  readonly roomId: string;
  readonly playerName?: string;
  readonly rejoinToken?: string;
}

export interface RoomKickPayload {
  readonly playerId: string;
}

export interface RoomImportMapPayload {
  readonly encodedMap: string;
}

export interface RoomSelectOfficialMapPayload {
  readonly mapId: string;
}

export interface RoomAddBotPayload {
  readonly name?: string;
}

export interface RoomUpdateShrinkCirclePayload extends ShrinkCircleSettings {}

export interface RoomErrorPayload {
  readonly reason: string;
  readonly message?: string;
  readonly roomId?: string | null;
}

export interface ShotSubmitPayload {
  readonly shotId: string;
  readonly turnIndex: number;
  readonly knownStateHash: string;
  readonly shotIntent: ShotIntent;
}

export interface BonusResolvePayload {
  readonly knownStateHash: string;
  readonly optionId?: string;
}

export interface BonusTeleportPayload {
  readonly knownStateHash: string;
  readonly bodyId: string;
  readonly position: Vec2;
}

export interface BonusAnchorPayload {
  readonly knownStateHash: string;
  readonly bodyId: string;
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
  readonly initialState?: GameState;
  readonly shotIntent: ShotIntent;
  readonly finalState: GameState;
  readonly finalMapData?: MapData;
  readonly events: readonly SimulationEvent[];
  readonly frames?: readonly SimulationFrame[];
  readonly shrinkCircle?: ShrinkCircleState;
  readonly resultHash: string;
}

export interface ClientToServerEvents {
  readonly "room:create": (payload: RoomCreatePayload) => void;
  readonly "room:join": (payload: RoomJoinPayload) => void;
  readonly "room:leave": () => void;
  readonly "room:kick": (payload: RoomKickPayload) => void;
  readonly "room:import_map": (payload: RoomImportMapPayload) => void;
  readonly "room:select_official_map": (payload: RoomSelectOfficialMapPayload) => void;
  readonly "room:add_bot": (payload: RoomAddBotPayload) => void;
  readonly "room:update_shrink_circle": (payload: RoomUpdateShrinkCirclePayload) => void;
  readonly "room:start": () => void;
  readonly "bonus:resolve": (payload: BonusResolvePayload) => void;
  readonly "bonus:teleport": (payload: BonusTeleportPayload) => void;
  readonly "bonus:anchor": (payload: BonusAnchorPayload) => void;
  readonly "shot:submit": (payload: ShotSubmitPayload) => void;
  readonly "room:reset": () => void;
}

export interface ServerToClientEvents {
  readonly "room:joined": (payload: RoomJoinedPayload) => void;
  readonly "room:state": (payload: RoomStatePayload) => void;
  readonly "room:error": (payload: RoomErrorPayload) => void;
  readonly "shot:started": (payload: ShotStartedPayload) => void;
  readonly "shot:resolved": (payload: ShotResolvedPayload) => void;
  readonly "shot:rejected": (payload: ShotRejectedPayload) => void;
}
