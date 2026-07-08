import type { BodyState } from "./body";
import type {
  ActionBonusToken,
  PendingBonusChoice,
  PickupState,
  PlayerBonusState
} from "./bonus";
import type { ActiveEffect } from "./effect";

/**
 * Serializable match state shared by server, playback, and bot evaluation.
 */
export type GamePhase =
  | "lobby"
  | "waiting_for_shot"
  | "choosing_bonus"
  | "simulating"
  | "turn_ending"
  | "finished";

export interface PlayerState {
  readonly id: string;
  readonly teamId: string;
  readonly name?: string;
  readonly color?: string;
  readonly connected?: boolean;
  readonly eliminated?: boolean;
  readonly isBot?: boolean;
  readonly turnOrderIndex?: number;
}

export interface GameState {
  readonly gameId: string;
  readonly mapId: string;
  turnIndex: number;
  roundSlotIndex?: number;
  roundIndex?: number;
  currentPlayerId: string;
  phase: GamePhase;
  players: PlayerState[];
  bodies: BodyState[];
  effects: ActiveEffect[];
  pickups?: PickupState[];
  playerBonuses?: PlayerBonusState[];
  pendingBonusChoice?: PendingBonusChoice;
  activeActionConstraint?: ActionBonusToken;
  winnerTeamId?: string;
  readonly rngSeed: number;
}
