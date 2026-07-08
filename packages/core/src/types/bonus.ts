import type { Vec2 } from "../math/vec2";
import type { BodyState } from "./body";

export type BonusKind =
  | "power_stack"
  | "trajectory_preview"
  | "single_power_boost"
  | "mass_up"
  | "size_up"
  | "size_down"
  | "extra_action_any"
  | "shuriken"
  | "bomb"
  | "summon_half_ball"
  | "teleport"
  | "anchor"
  | "extra_action_on_elimination";

export type ActionBonusKind =
  | "extra_action_any"
  | "shuriken"
  | "bomb"
  | "summon_half_ball"
  | "teleport"
  | "anchor"
  | "extra_action_on_elimination";

export interface PickupState {
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly spawnedTurnIndex: number;
}

export interface BonusOption {
  readonly id: string;
  readonly kind: BonusKind;
  readonly ownerPlayerId: string;
  readonly sourcePickupId: string;
  readonly sourceBodyId: string;
  readonly createdTurnIndex: number;
}

export interface RecentActionContext {
  readonly actorBodyId: string;
  readonly hadElimination: boolean;
}

export interface PendingBonusChoice {
  readonly playerId: string;
  readonly createdTurnIndex: number;
  readonly nextPlayerId?: string;
  readonly recentAction?: RecentActionContext;
}

export interface BodyRestoreSnapshot {
  readonly body: BodyState;
}

export interface ActionBonusToken {
  readonly id: string;
  readonly kind: ActionBonusKind;
  readonly ownerPlayerId: string;
  readonly createdTurnIndex: number;
  readonly actorBodyId?: string;
  readonly sourceOptionId?: string;
}

export interface PlayerBonusState {
  readonly playerId: string;
  readonly options: readonly BonusOption[];
  readonly powerCapStacks: number;
  readonly nextPowerBoosts: number;
  readonly trajectoryPreviewCharges: number;
  readonly pendingActionBonuses: readonly ActionBonusKind[];
  readonly extraActionTokens: readonly ActionBonusToken[];
}
