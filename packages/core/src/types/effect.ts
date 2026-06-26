/**
 * Generic effect and modifier contracts. Concrete rules should plug into hooks
 * instead of being hardcoded in the physics systems.
 */
export type EffectHook =
  | "onTurnStart"
  | "onBeforeShot"
  | "onAfterShotApplied"
  | "onPhysicsStep"
  | "onCollision"
  | "onEnterTrigger"
  | "onBodyStopped"
  | "onBodyEliminated"
  | "onSimulationEnd"
  | "onTurnEnd";

export type EffectKind = "modifier" | "trigger_effect" | "rule_effect";

export interface ActiveEffect {
  readonly id: string;
  readonly kind: EffectKind;
  readonly ownerId: string;
  readonly targetId?: string;
  readonly duration?: number;
  readonly stacks?: number;
  readonly hooks?: readonly EffectHook[];
  readonly data?: Record<string, unknown>;
}

export interface ActiveModifier {
  readonly id: string;
  readonly kind: string;
  readonly ownerId: string;
  readonly targetId?: string;
  readonly duration?: number;
  readonly stacks?: number;
  readonly data?: Record<string, unknown>;
}
