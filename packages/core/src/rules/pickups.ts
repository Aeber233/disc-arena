import { add, distance, dot, length, scale, sub } from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import {
  isPointPlayableOnMap
} from "../map/editableMap";
import {
  nearestPixelBodyRadiusTier,
  PIXEL_BODY_MAX_RADIUS_PX,
  PIXEL_BODY_MIN_RADIUS_PX,
  PIXEL_BODY_UNIT,
  pixelBodyRadius,
  type PixelBodyRadiusTierId
} from "../map/pixelBodySizes";
import { PHYSICS_POWER_SCALE, PHYSICS_UNIT_SCALE } from "../physics/units";
import type { BodyState } from "../types/body";
import type {
  ActionBonusKind,
  ActionBonusToken,
  BonusKind,
  BonusOption,
  PendingBonusChoice,
  PickupState,
  PlayerBonusState,
  RecentActionContext
} from "../types/bonus";
import type { GameState } from "../types/game";
import type { MapCollider, MapData, MapTrigger, StaticWallCollider } from "../types/map";
import type { SimulationBodySnapshot, SimulationEvent } from "../types/simulation";

export const MAX_ACTIVE_PICKUPS = 6;
export const PICKUP_RADIUS = 7 * PIXEL_BODY_UNIT;
export const BASE_SHOT_POWER_LIMIT = 1500 * PHYSICS_POWER_SCALE;
export const POWER_STACK_BONUS = 600 * PHYSICS_POWER_SCALE;
export const MAX_POWER_STACKS = 3;
export const NEXT_SHOT_POWER_BONUS = 1000 * PHYSICS_POWER_SCALE;
export const MASS_UP_MULTIPLIER = 1.25;
export const SIZE_STEP_PIXELS = 2;
export const BOMB_RADIUS = 18 * PIXEL_BODY_UNIT;
export const BOMB_IMPULSE_POWER = 1400 * PHYSICS_POWER_SCALE;
export const TELEPORT_RANGE = 36 * PIXEL_BODY_UNIT;
export const SUMMONED_HALF_BALL_RADIUS = pixelBodyRadius("9px");
export const SUMMONED_HALF_BALL_MASS = 0.5 * PHYSICS_UNIT_SCALE;
export const ANCHOR_MODIFIER_KIND = "anchor";

const TEMPORARY_SHURIKEN_TAG = "temporary_shuriken";
const SUMMONED_HALF_BALL_TAG = "summoned_half_ball";
const GHOST_UNTIL_CLEAR_TAG_PREFIX = "ghost_until_clear:";

export const BONUS_KINDS: readonly BonusKind[] = [
  "power_stack",
  "trajectory_preview",
  "single_power_boost",
  "mass_up",
  "size_up",
  "size_down",
  "extra_action_any",
  "shuriken",
  "bomb",
  "summon_half_ball",
  "teleport",
  "anchor",
  "extra_action_on_elimination"
] as const;

const ACTION_BONUS_KINDS = new Set<BonusKind>([
  "extra_action_any",
  "shuriken",
  "bomb",
  "summon_half_ball",
  "teleport",
  "anchor",
  "extra_action_on_elimination"
]);

export interface BonusResolveResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly option?: BonusOption;
}

export function initializePickupState(state: GameState): void {
  state.pickups = [...(state.pickups ?? [])];
  state.playerBonuses = [...(state.playerBonuses ?? [])];
}

export function spawnPickupForTurn(
  state: GameState,
  mapData: MapData
): readonly SimulationEvent[] {
  initializePickupState(state);
  const pickups = state.pickups ?? [];
  if (pickups.length >= MAX_ACTIVE_PICKUPS) {
    return [];
  }
  if (pickups.some((pickup) => pickup.spawnedTurnIndex === state.turnIndex)) {
    return [];
  }

  const position = findPickupPosition(state, mapData);
  if (!position) {
    return [];
  }

  const pickup: PickupState = {
    id: `pickup-${state.turnIndex}-${pickups.length + 1}`,
    position,
    radius: PICKUP_RADIUS,
    spawnedTurnIndex: state.turnIndex
  };
  state.pickups = [...pickups, pickup];

  return [
    {
      type: "pickup_spawned",
      step: 0,
      data: {
        pickupId: pickup.id,
        position: pickup.position,
        radius: pickup.radius,
        turnIndex: pickup.spawnedTurnIndex
      }
    }
  ];
}

export function collectPickups(
  state: GameState,
  step: number,
  previousPositions?: ReadonlyMap<string, Vec2>
): readonly SimulationEvent[] {
  initializePickupState(state);
  const events: SimulationEvent[] = [];
  let pickups = [...(state.pickups ?? [])];
  if (pickups.length === 0) {
    return [];
  }

  for (const body of state.bodies) {
    if (!body.alive || !body.ownerPlayerId || bodySkipsPickupCollection(body)) {
      continue;
    }

    const previous = previousPositions?.get(body.id) ?? body.position;
    const collected: PickupState[] = [];
    pickups = pickups.filter((pickup) => {
      if (!bodyTouchesPickup(body, pickup, previous)) {
        return true;
      }
      collected.push(pickup);
      return false;
    });

    for (const pickup of collected) {
      const options = createBonusOptions(state, pickup, body);
      appendBonusOptions(state, body.ownerPlayerId, options);
      events.push({
        type: "pickup_collected",
        step,
        bodyIds: [body.id],
        data: {
          pickupId: pickup.id,
          playerId: body.ownerPlayerId,
          optionIds: options.map((option) => option.id),
          bonusKinds: options.map((option) => option.kind)
        }
      });
    }

    if (pickups.length === 0) {
      break;
    }
  }

  state.pickups = pickups;
  return events;
}

export function shotPowerLimitForPlayer(state: GameState, playerId: string): number {
  const bonuses = getPlayerBonusState(state, playerId);
  return (
    BASE_SHOT_POWER_LIMIT +
    bonuses.powerCapStacks * POWER_STACK_BONUS +
    bonuses.nextPowerBoosts * NEXT_SHOT_POWER_BONUS
  );
}

export function hasTrajectoryPreviewCharge(state: GameState, playerId: string): boolean {
  return getPlayerBonusState(state, playerId).trajectoryPreviewCharges > 0;
}

export function consumeShotStartBonuses(state: GameState, playerId: string): void {
  updatePlayerBonusState(state, playerId, (current) => ({
    ...current,
    nextPowerBoosts: Math.max(0, current.nextPowerBoosts - 1),
    trajectoryPreviewCharges: Math.max(0, current.trajectoryPreviewCharges - 1)
  }));
}

export function resolveBonusOption(
  state: GameState,
  playerId: string,
  optionId: string,
  recentAction?: RecentActionContext
): BonusResolveResult {
  const current = getPlayerBonusState(state, playerId);
  const option = current.options.find((candidate) => candidate.id === optionId);
  if (!option || option.ownerPlayerId !== playerId) {
    return { ok: false, reason: "invalid_bonus_option" };
  }

  const cleared: PlayerBonusState = {
    ...current,
    options: []
  };
  setPlayerBonusState(state, cleared);
  applyBonusKind(state, option, recentAction);
  return { ok: true, option };
}

export function keepBonusOptions(state: GameState, playerId: string): void {
  ensurePlayerBonusState(state, playerId);
}

export function applyPendingActionBonusesAfterShot(
  state: GameState,
  playerId: string,
  recentAction: RecentActionContext
): void {
  const current = getPlayerBonusState(state, playerId);
  if (current.pendingActionBonuses.length === 0) {
    return;
  }

  const pending = [...current.pendingActionBonuses];
  setPlayerBonusState(state, {
    ...current,
    pendingActionBonuses: []
  });

  for (const kind of pending) {
    grantActionTokenForKind(state, playerId, kind, recentAction);
  }
}

export function takeNextUsableActionToken(
  state: GameState,
  playerId: string
): ActionBonusToken | undefined {
  const current = getPlayerBonusState(state, playerId);
  if (current.extraActionTokens.length === 0) {
    delete state.activeActionConstraint;
    return undefined;
  }

  const remaining: ActionBonusToken[] = [];
  let selected: ActionBonusToken | undefined;
  for (const token of current.extraActionTokens) {
    if (!selected && isActionTokenUsable(state, token)) {
      selected = token;
      continue;
    }
    if (isActionTokenUsable(state, token)) {
      remaining.push(token);
    }
  }

  setPlayerBonusState(state, {
    ...current,
    extraActionTokens: remaining
  });
  if (selected) {
    state.activeActionConstraint = selected;
  } else {
    delete state.activeActionConstraint;
  }
  return selected;
}

export function actionConstraintAllowsBody(
  state: GameState,
  playerId: string,
  body: BodyState | undefined
): boolean {
  const constraint = state.activeActionConstraint;
  if (!constraint) {
    return true;
  }
  if (constraint.ownerPlayerId !== playerId) {
    return false;
  }
  if (!body?.alive || body.ownerPlayerId !== playerId) {
    return false;
  }
  if (constraint.kind === "teleport") {
    return true;
  }
  return !constraint.actorBodyId || constraint.actorBodyId === body.id;
}

export function clearActiveActionConstraint(state: GameState): void {
  delete state.activeActionConstraint;
}

export function actionKindLabel(kind: ActionBonusKind): string {
  if (kind === "extra_action_any") {
    return "Extra Action";
  }
  if (kind === "shuriken") {
    return "Shuriken";
  }
  if (kind === "bomb") {
    return "Bomb";
  }
  if (kind === "summon_half_ball") {
    return "New Half Ball";
  }
  if (kind === "teleport") {
    return "Teleport";
  }
  if (kind === "anchor") {
    return "Anchor";
  }
  return "Out Bonus";
}

export function applyBombExplosion(
  state: GameState,
  actorBodyId: string,
  step: number
): readonly SimulationEvent[] {
  const actor = state.bodies.find((body) => body.id === actorBodyId);
  if (!actor) {
    return [];
  }

  const affectedIds: string[] = [];
  for (const body of state.bodies) {
    if (!body.alive || body.id === actor.id) {
      continue;
    }
    const offset = sub(body.position, actor.position);
    const bodyDistance = length(offset);
    if (bodyDistance > BOMB_RADIUS + body.radius) {
      continue;
    }

    const direction = bodyDistance === 0 ? { x: 1, y: 0 } : scale(offset, 1 / bodyDistance);
    const falloff = Math.max(0.2, 1 - bodyDistance / (BOMB_RADIUS + body.radius));
    const safeMass = body.mass > 0 ? body.mass : PHYSICS_UNIT_SCALE;
    const speedDelta = (BOMB_IMPULSE_POWER * PHYSICS_UNIT_SCALE * falloff) / safeMass;
    body.velocity = add(body.velocity, scale(direction, speedDelta));
    body.sleep = false;
    affectedIds.push(body.id);
  }

  return [
    {
      type: "bomb_exploded",
      step,
      bodyIds: [actor.id, ...affectedIds],
      bodySnapshots: [actor.id, ...affectedIds]
        .map((bodyId) => state.bodies.find((body) => body.id === bodyId))
        .filter((body): body is BodyState => body !== undefined)
        .map(snapshotBody),
      data: {
        actorBodyId: actor.id,
        position: { ...actor.position },
        affectedBodyIds: affectedIds,
        radius: BOMB_RADIUS,
        impulsePower: BOMB_IMPULSE_POWER
      }
    }
  ];
}

export function restoreBodyAfterShuriken(
  state: GameState,
  snapshot: BodyState,
  step: number
): readonly SimulationEvent[] {
  const restored: BodyState = {
    ...cloneBody(snapshot),
    velocity: { x: 0, y: 0 },
    sleep: true
  };
  state.bodies = state.bodies.map((body) => (body.id === restored.id ? restored : body));

  return [
    {
      type: "body_restored",
      step,
      bodyIds: [restored.id],
      bodySnapshots: [snapshotBody(restored)],
      data: {
        reason: "shuriken",
        bodyId: restored.id
      }
    }
  ];
}

export function createActionProjectile(
  state: GameState,
  sourceBodyId: string,
  kind: "shuriken" | "summon_half_ball",
  shotId: string,
  step: number
): { readonly bodyId: string; readonly events: readonly SimulationEvent[] } | undefined {
  const source = state.bodies.find((body) => body.id === sourceBodyId);
  if (!source?.alive) {
    return undefined;
  }

  const bodyId = uniqueBodyId(
    state,
    `${kind}-${source.id}-${shotId}`.replace(/[^a-zA-Z0-9_-]/g, "-")
  );
  const projectile: BodyState = {
    ...cloneBody(source),
    id: bodyId,
    kind: "disc",
    position: { ...source.position },
    velocity: { x: 0, y: 0 },
    radius: kind === "summon_half_ball" ? SUMMONED_HALF_BALL_RADIUS : source.radius,
    mass: kind === "summon_half_ball" ? SUMMONED_HALF_BALL_MASS : source.mass,
    sleep: false,
    tags: [
      ...source.tags,
      kind === "shuriken" ? TEMPORARY_SHURIKEN_TAG : SUMMONED_HALF_BALL_TAG,
      `${GHOST_UNTIL_CLEAR_TAG_PREFIX}${source.id}`
    ],
    modifiers: []
  };
  state.bodies = [...state.bodies, projectile];

  return {
    bodyId,
    events: [
      {
        type: "body_spawned",
        step,
        bodyIds: [projectile.id],
        bodySnapshots: [snapshotBody(projectile)],
        data: {
          reason: kind,
          sourceBodyId: source.id,
          bodyId: projectile.id
        }
      }
    ]
  };
}

export function destroyTemporaryBody(
  state: GameState,
  bodyId: string,
  step: number,
  reason: string
): readonly SimulationEvent[] {
  const body = state.bodies.find((candidate) => candidate.id === bodyId);
  if (!body) {
    return [];
  }
  const destroyed: BodyState = {
    ...cloneBody(body),
    alive: false,
    sleep: true,
    velocity: { x: 0, y: 0 }
  };
  state.bodies = state.bodies.filter((candidate) => candidate.id !== bodyId);
  return [
    {
      type: "body_destroyed",
      step,
      bodyIds: [bodyId],
      bodySnapshots: [snapshotBody(destroyed)],
      data: {
        reason,
        bodyId
      }
    }
  ];
}

export function updateGhostCollisionStates(
  state: GameState,
  step: number
): readonly SimulationEvent[] {
  const events: SimulationEvent[] = [];
  state.bodies = state.bodies.map((body) => {
    if (!body.alive || !hasGhostCollisionTag(body)) {
      return body;
    }
    const sourceBodyId = ghostCollisionSourceBodyId(body);
    const source = sourceBodyId
      ? state.bodies.find((candidate) => candidate.id === sourceBodyId)
      : undefined;
    if (source?.alive && distance(source.position, body.position) <= source.radius + body.radius) {
      return body;
    }

    const updated: BodyState = {
      ...body,
      tags: body.tags.filter((tag) => !tag.startsWith(GHOST_UNTIL_CLEAR_TAG_PREFIX))
    };
    events.push({
      type: "body_collision_enabled",
      step,
      bodyIds: [updated.id],
      bodySnapshots: [snapshotBody(updated)],
      data: {
        bodyId: updated.id,
        sourceBodyId
      }
    });
    return updated;
  });
  return events;
}

export function bodyHasDisabledCollision(body: BodyState): boolean {
  return hasGhostCollisionTag(body);
}

export function isBodyTeleportTargetLegal(
  state: GameState,
  mapData: MapData,
  bodyId: string,
  position: Vec2,
  range = TELEPORT_RANGE
): boolean {
  const body = state.bodies.find((candidate) => candidate.id === bodyId);
  if (!body?.alive) {
    return false;
  }
  if (distance(body.position, position) > range) {
    return false;
  }
  if (!isCirclePlayable(mapData, position, body.radius)) {
    return false;
  }
  if (mapData.triggers.some((trigger) => triggerBlocksPickup(trigger, position, body.radius))) {
    return false;
  }
  if (mapData.colliders.some((collider) => colliderBlocksPickup(collider, position, body.radius))) {
    return false;
  }
  return !state.bodies.some(
    (candidate) =>
      candidate.id !== body.id &&
      candidate.alive &&
      distance(candidate.position, position) < candidate.radius + body.radius
  );
}

export function teleportBody(
  state: GameState,
  bodyId: string,
  position: Vec2,
  step: number
): readonly SimulationEvent[] {
  const body = state.bodies.find((candidate) => candidate.id === bodyId);
  if (!body?.alive) {
    return [];
  }
  body.position = { ...position };
  body.velocity = { x: 0, y: 0 };
  body.sleep = true;
  return [
    {
      type: "body_teleported",
      step,
      bodyIds: [body.id],
      bodySnapshots: [snapshotBody(body)],
      data: {
        bodyId: body.id,
        position: { ...position }
      }
    }
  ];
}

export function applyAnchorModifier(
  state: GameState,
  targetBodyId: string,
  ownerPlayerId: string,
  step: number
): readonly SimulationEvent[] {
  const body = state.bodies.find((candidate) => candidate.id === targetBodyId);
  if (!body?.alive) {
    return [];
  }
  const modifier = {
    id: `anchor-${ownerPlayerId}-${state.turnIndex}-${body.id}`,
    kind: ANCHOR_MODIFIER_KIND,
    ownerId: ownerPlayerId,
    targetId: body.id,
    data: {
      origin: { ...body.position },
      radius: body.radius * 2
    }
  };
  const anchored: BodyState = {
    ...body,
    modifiers: [
      ...body.modifiers.filter(
        (candidate) =>
          !(candidate.kind === ANCHOR_MODIFIER_KIND && candidate.ownerId === ownerPlayerId)
      ),
      modifier
    ]
  };
  state.bodies = state.bodies.map((candidate) =>
    candidate.id === anchored.id ? anchored : candidate
  );
  return [
    {
      type: "body_anchored",
      step,
      bodyIds: [anchored.id],
      bodySnapshots: [snapshotBody(anchored)],
      data: {
        bodyId: anchored.id,
        ownerPlayerId,
        origin: modifier.data.origin,
        radius: modifier.data.radius
      }
    }
  ];
}

export function applyAnchorConstraints(
  bodies: BodyState[],
  step: number
): readonly SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (const body of bodies) {
    if (!body.alive) {
      continue;
    }
    const modifier = body.modifiers.find(
      (candidate) => candidate.kind === ANCHOR_MODIFIER_KIND
    );
    if (!modifier) {
      continue;
    }
    const origin = vec2FromUnknown(modifier.data?.origin);
    const radius = typeof modifier.data?.radius === "number"
      ? modifier.data.radius
      : body.radius * 2;
    if (!origin || radius <= 0) {
      continue;
    }
    const offset = sub(body.position, origin);
    const offsetLength = length(offset);
    if (offsetLength <= radius) {
      continue;
    }
    const direction = offsetLength === 0 ? { x: 1, y: 0 } : scale(offset, 1 / offsetLength);
    body.position = add(origin, scale(direction, radius));
    body.velocity = { x: 0, y: 0 };
    body.sleep = true;
    events.push({
      type: "body_anchor_limited",
      step,
      bodyIds: [body.id],
      bodySnapshots: [snapshotBody(body)],
      data: {
        bodyId: body.id,
        origin,
        radius
      }
    });
  }
  return events;
}

export function clearAnchorModifiersForPlayer(state: GameState, playerId: string): void {
  state.bodies = state.bodies.map((body) => {
    if (!body.modifiers.some(
      (modifier) => modifier.kind === ANCHOR_MODIFIER_KIND && modifier.ownerId === playerId
    )) {
      return body;
    }
    return {
      ...body,
      modifiers: body.modifiers.filter(
        (modifier) =>
          !(modifier.kind === ANCHOR_MODIFIER_KIND && modifier.ownerId === playerId)
      )
    };
  });
}

function bodySkipsPickupCollection(body: BodyState): boolean {
  return body.tags.includes(TEMPORARY_SHURIKEN_TAG) || hasGhostCollisionTag(body);
}

function hasGhostCollisionTag(body: BodyState): boolean {
  return body.tags.some((tag) => tag.startsWith(GHOST_UNTIL_CLEAR_TAG_PREFIX));
}

function ghostCollisionSourceBodyId(body: BodyState): string | undefined {
  return body.tags
    .find((tag) => tag.startsWith(GHOST_UNTIL_CLEAR_TAG_PREFIX))
    ?.slice(GHOST_UNTIL_CLEAR_TAG_PREFIX.length);
}

function uniqueBodyId(state: GameState, baseId: string): string {
  const existing = new Set(state.bodies.map((body) => body.id));
  if (!existing.has(baseId)) {
    return baseId;
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${baseId}-${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${baseId}-${state.bodies.length}-${Date.now()}`;
}

function vec2FromUnknown(value: unknown): Vec2 | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value
  ) {
    const x = (value as { x?: unknown }).x;
    const y = (value as { y?: unknown }).y;
    if (typeof x === "number" && typeof y === "number") {
      return { x, y };
    }
  }
  return undefined;
}

export function eventsIncludeElimination(events: readonly SimulationEvent[]): boolean {
  return events.some((event) =>
    event.type === "body_out_of_bounds" || event.type === "body_eliminated"
  );
}

export function getPlayerBonusState(
  state: GameState,
  playerId: string
): PlayerBonusState {
  return state.playerBonuses?.find((bonus) => bonus.playerId === playerId) ??
    createEmptyPlayerBonusState(playerId);
}

export function playerHasBonusOptions(state: GameState, playerId: string): boolean {
  return getPlayerBonusState(state, playerId).options.length > 0;
}

export function bonusOptionCount(state: GameState, playerId: string): number {
  return getPlayerBonusState(state, playerId).options.length;
}

export function createPendingBonusChoice(
  playerId: string,
  createdTurnIndex: number,
  nextPlayerId: string | undefined,
  recentAction: RecentActionContext
): PendingBonusChoice {
  return {
    playerId,
    createdTurnIndex,
    ...(nextPlayerId ? { nextPlayerId } : {}),
    recentAction
  };
}

function applyBonusKind(
  state: GameState,
  option: BonusOption,
  recentAction?: RecentActionContext
): void {
  const current = getPlayerBonusState(state, option.ownerPlayerId);

  if (option.kind === "power_stack") {
    const atCap = current.powerCapStacks >= MAX_POWER_STACKS;
    setPlayerBonusState(state, {
      ...current,
      powerCapStacks: atCap ? current.powerCapStacks : current.powerCapStacks + 1,
      nextPowerBoosts: atCap ? current.nextPowerBoosts + 1 : current.nextPowerBoosts
    });
    return;
  }

  if (option.kind === "trajectory_preview") {
    setPlayerBonusState(state, {
      ...current,
      trajectoryPreviewCharges: current.trajectoryPreviewCharges + 1
    });
    return;
  }

  if (option.kind === "single_power_boost") {
    setPlayerBonusState(state, {
      ...current,
      nextPowerBoosts: current.nextPowerBoosts + 1
    });
    return;
  }

  if (option.kind === "mass_up") {
    replaceBody(state, option.sourceBodyId, (body) => ({
      ...body,
      mass: body.mass * MASS_UP_MULTIPLIER
    }));
    return;
  }

  if (option.kind === "size_up") {
    replaceBody(state, option.sourceBodyId, (body) => ({
      ...body,
      radius: radiusWithPixelOffset(body.radius, SIZE_STEP_PIXELS)
    }));
    return;
  }

  if (option.kind === "size_down") {
    replaceBody(state, option.sourceBodyId, (body) => ({
      ...body,
      radius: radiusWithPixelOffset(body.radius, -SIZE_STEP_PIXELS)
    }));
    return;
  }

  if (ACTION_BONUS_KINDS.has(option.kind)) {
    const kind = option.kind as ActionBonusKind;
    if (recentAction) {
      grantActionTokenForKind(state, option.ownerPlayerId, kind, recentAction, option.id);
      return;
    }
    setPlayerBonusState(state, {
      ...current,
      pendingActionBonuses: [...current.pendingActionBonuses, kind]
    });
  }
}

function grantActionTokenForKind(
  state: GameState,
  playerId: string,
  kind: ActionBonusKind,
  recentAction: RecentActionContext,
  sourceOptionId?: string
): void {
  if (kind === "extra_action_on_elimination" && !recentAction.hadElimination) {
    return;
  }

  const current = getPlayerBonusState(state, playerId);
  const bindRecentActor =
    kind === "shuriken" ||
    kind === "bomb" ||
    kind === "summon_half_ball" ||
    kind === "extra_action_on_elimination";
  const token: ActionBonusToken = {
    id: `action-${state.turnIndex}-${kind}-${current.extraActionTokens.length + 1}`,
    kind,
    ownerPlayerId: playerId,
    createdTurnIndex: state.turnIndex,
    ...(bindRecentActor ? { actorBodyId: recentAction.actorBodyId } : {}),
    ...(sourceOptionId ? { sourceOptionId } : {})
  };
  setPlayerBonusState(state, {
    ...current,
    extraActionTokens: [...current.extraActionTokens, token]
  });
}

function isActionTokenUsable(state: GameState, token: ActionBonusToken): boolean {
  const player = state.players.find((candidate) => candidate.id === token.ownerPlayerId);
  if (!player || player.eliminated) {
    return false;
  }
  if (token.actorBodyId) {
    const body = state.bodies.find((candidate) => candidate.id === token.actorBodyId);
    return Boolean(body?.alive && body.ownerPlayerId === token.ownerPlayerId);
  }
  if (token.kind === "anchor") {
    return state.bodies.some((body) => body.alive);
  }
  return state.bodies.some(
    (body) => body.alive && body.ownerPlayerId === token.ownerPlayerId
  );
}

function findPickupPosition(state: GameState, mapData: MapData): Vec2 | undefined {
  const bounds = mapBounds(mapData, state);
  if (!bounds) {
    return undefined;
  }

  const seed = hashString(`${state.rngSeed}:${state.turnIndex}:${state.pickups?.length ?? 0}`);
  const random = seededRandom(seed);
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const position = {
      x: bounds.left + random() * (bounds.right - bounds.left),
      y: bounds.top + random() * (bounds.bottom - bounds.top)
    };
    if (isPickupPositionLegal(state, mapData, position, PICKUP_RADIUS)) {
      return position;
    }
  }

  const step = PICKUP_RADIUS * 2;
  for (let y = bounds.top + PICKUP_RADIUS; y <= bounds.bottom - PICKUP_RADIUS; y += step) {
    for (let x = bounds.left + PICKUP_RADIUS; x <= bounds.right - PICKUP_RADIUS; x += step) {
      const position = { x, y };
      if (isPickupPositionLegal(state, mapData, position, PICKUP_RADIUS)) {
        return position;
      }
    }
  }

  return undefined;
}

function isPickupPositionLegal(
  state: GameState,
  mapData: MapData,
  position: Vec2,
  radius: number
): boolean {
  if (!isCirclePlayable(mapData, position, radius)) {
    return false;
  }
  if (mapData.triggers.some((trigger) => triggerBlocksPickup(trigger, position, radius))) {
    return false;
  }
  if (mapData.colliders.some((collider) => colliderBlocksPickup(collider, position, radius))) {
    return false;
  }
  if (
    state.bodies.some(
      (body) => body.alive && distance(body.position, position) < body.radius + radius
    )
  ) {
    return false;
  }
  return !(state.pickups ?? []).some(
    (pickup) => distance(pickup.position, position) < pickup.radius + radius
  );
}

function isCirclePlayable(mapData: MapData, center: Vec2, radius: number): boolean {
  const samples = 12;
  if (!isPointPlayableOnMap(mapData, center)) {
    return false;
  }
  for (let index = 0; index < samples; index += 1) {
    const angle = (Math.PI * 2 * index) / samples;
    const point = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    };
    if (!isPointPlayableOnMap(mapData, point)) {
      return false;
    }
  }
  return true;
}

function triggerBlocksPickup(trigger: MapTrigger, position: Vec2, radius: number): boolean {
  return trigger.type === "hole" && distance(trigger.position, position) <= trigger.radius + radius;
}

function colliderBlocksPickup(collider: MapCollider, position: Vec2, radius: number): boolean {
  if (collider.type === "static_wall") {
    return distanceToWall(position, collider) <= radius;
  }
  if (collider.type === "bumper" || collider.type === "circle_obstacle") {
    return distance(collider.position, position) <= collider.radius + radius;
  }
  if (
    collider.type === "dynamic_obstacle_spawn" ||
    collider.type === "destructible_obstacle_spawn"
  ) {
    return distance(collider.position, position) <= collider.radius + radius;
  }
  return false;
}

function bodyTouchesPickup(body: BodyState, pickup: PickupState, previousPosition: Vec2): boolean {
  return distancePointToSegment(pickup.position, previousPosition, body.position) <=
    body.radius + pickup.radius;
}

function createBonusOptions(
  state: GameState,
  pickup: PickupState,
  body: BodyState
): BonusOption[] {
  const kinds = shuffle(
    BONUS_KINDS,
    hashString(`${state.rngSeed}:${pickup.id}:${body.id}:${state.turnIndex}`)
  ).slice(0, 2);
  return kinds.map((kind, index) => ({
    id: `bonus-${pickup.id}-${body.id}-${index + 1}`,
    kind,
    ownerPlayerId: body.ownerPlayerId!,
    sourcePickupId: pickup.id,
    sourceBodyId: body.id,
    createdTurnIndex: state.turnIndex
  }));
}

function appendBonusOptions(
  state: GameState,
  playerId: string,
  options: readonly BonusOption[]
): void {
  const current = getPlayerBonusState(state, playerId);
  setPlayerBonusState(state, {
    ...current,
    options: [...current.options, ...options]
  });
}

function ensurePlayerBonusState(state: GameState, playerId: string): PlayerBonusState {
  const current = state.playerBonuses?.find((bonus) => bonus.playerId === playerId);
  if (current) {
    return current;
  }
  const created = createEmptyPlayerBonusState(playerId);
  setPlayerBonusState(state, created);
  return created;
}

function setPlayerBonusState(state: GameState, next: PlayerBonusState): void {
  initializePickupState(state);
  const bonuses = [...(state.playerBonuses ?? [])];
  const index = bonuses.findIndex((bonus) => bonus.playerId === next.playerId);
  if (index >= 0) {
    bonuses[index] = next;
  } else {
    bonuses.push(next);
  }
  state.playerBonuses = bonuses;
}

function updatePlayerBonusState(
  state: GameState,
  playerId: string,
  updater: (current: PlayerBonusState) => PlayerBonusState
): void {
  setPlayerBonusState(state, updater(getPlayerBonusState(state, playerId)));
}

function createEmptyPlayerBonusState(playerId: string): PlayerBonusState {
  return {
    playerId,
    options: [],
    powerCapStacks: 0,
    nextPowerBoosts: 0,
    trajectoryPreviewCharges: 0,
    pendingActionBonuses: [],
    extraActionTokens: []
  };
}

function replaceBody(
  state: GameState,
  bodyId: string,
  updater: (body: BodyState) => BodyState
): void {
  state.bodies = state.bodies.map((body) => (body.id === bodyId ? updater(body) : body));
}

function radiusWithPixelOffset(radius: number, offset: number): number {
  const tier = nearestPixelBodyRadiusTier(radius);
  const nextPixelRadius = Math.max(
    PIXEL_BODY_MIN_RADIUS_PX,
    Math.min(PIXEL_BODY_MAX_RADIUS_PX, tier.pixelRadius + offset)
  );
  return pixelBodyRadius(`${nextPixelRadius}px` as PixelBodyRadiusTierId);
}

function mapBounds(
  mapData: MapData,
  state: GameState
): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | undefined {
  if (mapData.tableBounds) {
    return mapData.tableBounds;
  }
  if (mapData.terrain) {
    return {
      left: mapData.terrain.origin.x,
      top: mapData.terrain.origin.y,
      right: mapData.terrain.origin.x + mapData.terrain.widthCells * mapData.terrain.cellSize,
      bottom: mapData.terrain.origin.y + mapData.terrain.heightCells * mapData.terrain.cellSize
    };
  }

  const points = [
    ...state.bodies.map((body) => body.position),
    ...mapData.triggers.map((trigger) => trigger.position)
  ];
  if (points.length === 0) {
    return undefined;
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs) - PICKUP_RADIUS * 4,
    top: Math.min(...ys) - PICKUP_RADIUS * 4,
    right: Math.max(...xs) + PICKUP_RADIUS * 4,
    bottom: Math.max(...ys) + PICKUP_RADIUS * 4
  };
}

function distanceToWall(point: Vec2, wall: StaticWallCollider): number {
  return distancePointToSegment(point, wall.start, wall.end);
}

function distancePointToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const segment = sub(end, start);
  const lengthSquared = dot(segment, segment);
  if (lengthSquared === 0) {
    return distance(point, start);
  }
  const t = Math.max(0, Math.min(1, dot(sub(point, start), segment) / lengthSquared));
  return distance(point, add(start, scale(segment, t)));
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function cloneBody(body: BodyState): BodyState {
  return JSON.parse(JSON.stringify(body)) as BodyState;
}

function snapshotBody(body: BodyState): SimulationBodySnapshot {
  return {
    id: body.id,
    position: { ...body.position },
    velocity: { ...body.velocity },
    spin: body.spin,
    alive: body.alive,
    sleep: body.sleep,
    radius: body.radius,
    mass: body.mass
  };
}
