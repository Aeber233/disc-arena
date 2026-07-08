import {
  allBodiesSleeping,
  actionConstraintAllowsBody,
  applyAnchorModifier,
  applyBombExplosion,
  applyPendingActionBonusesAfterShot,
  bonusOptionCount,
  clearAnchorModifiersForPlayer,
  countAliveOwnedBodies,
  collectPickups,
  createActionProjectile,
  createOfficialMapSetup,
  createPendingBonusChoice,
  clearActiveActionConstraint,
  consumeShotStartBonuses,
  continueSimulation,
  destroyTemporaryBody,
  decodeEditableMapDocument,
  DEFAULT_SHRINK_CIRCLE_SETTINGS,
  DEFAULT_PLAYER_COLORS,
  editableBallPlacementsToBodies,
  editableMapToMapData,
  eventsIncludeElimination,
  getPlayerBonusState,
  hashGameState,
  initializePickupState,
  isBodyTeleportTargetLegal,
  isBodyFullyCoveredByPoison,
  isBodyOwnedByPlayer,
  keepBonusOptions,
  normalizeShrinkCircleSettings,
  playerHasBonusOptions,
  resolveBonusOption,
  setupMatchGameState,
  settleMatchState,
  shotPowerLimitForPlayer,
  shrinkCircleStateForTurn,
  spawnPickupForTurn,
  simulateShot,
  takeNextUsableActionToken,
  teleportBody
} from "@disc-arena/core";
import type {
  BodyState,
  BonusResolvePayload,
  BonusAnchorPayload,
  BonusTeleportPayload,
  GameState,
  MapData,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomMember,
  RoomMemberKind,
  RoomStatePayload,
  ShotRejectedPayload,
  ShotResolvedPayload,
  ShotStartedPayload,
  ShotSubmitPayload,
  SimulationEvent,
  SimulationOptions,
  ShrinkCircleSettings
} from "@disc-arena/core";
import { randomBytes } from "node:crypto";
import { chooseBotShotIntent } from "./botInput";

export interface AcceptedShot {
  readonly ok: true;
  readonly started: ShotStartedPayload;
  readonly resolved: ShotResolvedPayload;
}

export interface RejectedShot {
  readonly ok: false;
  readonly rejected: ShotRejectedPayload;
}

export type ShotSubmissionResult = AcceptedShot | RejectedShot;

export interface DiscArenaRoomOptions {
  readonly simulationOptions?: SimulationOptions;
}

export interface RoomJoinOptions {
  readonly socketId: string;
  readonly playerName?: string | undefined;
  readonly rejoinToken?: string | undefined;
}

export interface RoomActionOk<T> {
  readonly ok: true;
  readonly payload: T;
}

export interface RoomActionError {
  readonly ok: false;
  readonly error: RoomErrorPayload;
}

export type RoomActionResult<T> = RoomActionOk<T> | RoomActionError;

interface RoomMemberState {
  readonly playerId: string;
  socketId: string | null;
  readonly rejoinToken?: string;
  name: string;
  readonly color: string;
  readonly kind: RoomMemberKind;
  connected: boolean;
  joinIndex: number;
  isOwner: boolean;
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

const authoritativeSimulationOptions: SimulationOptions = {
  mode: "authoritative",
  fixedDt: 1 / 60,
  maxSteps: 1800,
  collisionIterations: 3,
  recordFrames: true,
  frameIntervalSteps: 2,
  quantize: true
};

const defaultOfficialMapSetup = createOfficialMapSetup("billiards_table");

/**
 * Owns lobby membership plus one authoritative Disc Arena match.
 */
export class DiscArenaRoom {
  private readonly roomId: string;
  private readonly seed: number;
  private readonly simulationOptions: SimulationOptions;
  private members: RoomMemberState[] = [];
  private mapData: MapData = defaultOfficialMapSetup.mapData;
  private baseGameState: GameState = defaultOfficialMapSetup.gameState;
  private gameState: GameState = createLobbyGameState("lobby", this.baseGameState);
  private shrinkCircleSettings: ShrinkCircleSettings = DEFAULT_SHRINK_CIRCLE_SETTINGS;
  private turnOrder: string[] = [];
  private nextJoinIndex = 1;
  private nextBotIndex = 1;

  constructor(roomId: string, seed = Date.now(), options: DiscArenaRoomOptions = {}) {
    this.roomId = normalizeRoomId(roomId);
    this.seed = seed;
    this.simulationOptions = {
      ...authoritativeSimulationOptions,
      ...options.simulationOptions,
      mode: "authoritative"
    };
    this.loadMapSetup(defaultOfficialMapSetup.mapData, defaultOfficialMapSetup.gameState);
    this.gameState = createLobbyGameState(this.roomId, this.baseGameState);
  }

  getRoomId(): string {
    return this.roomId;
  }

  join(options: RoomJoinOptions): RoomActionResult<RoomJoinedPayload> {
    const rejoining = options.rejoinToken
      ? this.members.find(
          (member) => member.kind === "human" && member.rejoinToken === options.rejoinToken
        )
      : undefined;
    if (rejoining) {
      if (rejoining.connected && rejoining.socketId !== options.socketId) {
        if (this.roomPhase() !== "lobby") {
          return this.error(
            "member_already_online",
            "This player is already online in the room."
          );
        }
      } else {
        rejoining.socketId = options.socketId;
        rejoining.connected = true;
        if (options.playerName) {
          rejoining.name = normalizeName(options.playerName, rejoining.name);
        }
        this.syncMembersToGameState();
        this.refreshCurrentPlayerIfNeeded();
        return {
          ok: true,
          payload: this.joinedPayload(rejoining)
        };
      }
    }

    if (this.roomPhase() !== "lobby") {
      return this.error("room_in_progress", "This room is already in a match.");
    }
    if (this.members.length >= MAX_PLAYERS) {
      return this.error("room_full", "This room is full.");
    }
    if (this.members.some((member) => member.socketId === options.socketId)) {
      return this.error("already_in_room", "You have already joined this room.");
    }

    const playerId = `player-${this.nextJoinIndex}`;
    const member: RoomMemberState = {
      playerId,
      socketId: options.socketId,
      rejoinToken: createToken(),
      name: normalizeName(options.playerName, `Player ${this.nextJoinIndex}`),
      color: DEFAULT_PLAYER_COLORS[
        (this.nextJoinIndex - 1) % DEFAULT_PLAYER_COLORS.length
      ]!,
      kind: "human",
      connected: true,
      joinIndex: this.nextJoinIndex,
      isOwner: this.members.length === 0
    };
    this.nextJoinIndex += 1;
    this.members.push(member);
    this.syncMembersToGameState();

    return {
      ok: true,
      payload: this.joinedPayload(member)
    };
  }

  leave(socketId: string): RoomStatePayload {
    const member = this.memberBySocket(socketId);
    if (!member) {
      return this.snapshot();
    }

    if (this.roomPhase() === "lobby") {
      this.members = this.members.filter((candidate) => candidate.playerId !== member.playerId);
    } else {
      member.connected = false;
      member.socketId = null;
    }

    this.ensureOwner();
    this.syncMembersToGameState();
    this.refreshCurrentPlayerIfNeeded();
    return this.snapshot();
  }

  disconnect(socketId: string): RoomStatePayload {
    return this.leave(socketId);
  }

  kick(socketId: string, targetPlayerId: string): RoomActionResult<RoomStatePayload> {
    const actor = this.memberBySocket(socketId);
    if (!actor?.isOwner) {
      return this.error("not_room_owner", "Only the room owner can kick players.");
    }
    if (this.roomPhase() !== "lobby") {
      return this.error("room_in_progress", "Players can only be kicked in the lobby.");
    }
    if (actor.playerId === targetPlayerId) {
      return this.error("cannot_kick_self", "The owner cannot kick themselves.");
    }

    this.members = this.members.filter((member) => member.playerId !== targetPlayerId);
    this.syncMembersToGameState();
    return { ok: true, payload: this.snapshot() };
  }

  addBot(socketId: string, botName?: string): RoomActionResult<RoomStatePayload> {
    const actor = this.memberBySocket(socketId);
    if (!actor?.isOwner) {
      return this.error("not_room_owner", "Only the room owner can add bots.");
    }
    if (this.roomPhase() !== "lobby") {
      return this.error("room_in_progress", "Bots can only be added in the lobby.");
    }
    if (this.members.length >= MAX_PLAYERS) {
      return this.error("room_full", "This room is full.");
    }

    const botIndex = this.nextBotIndex;
    const member: RoomMemberState = {
      playerId: `bot-${botIndex}`,
      socketId: null,
      name: normalizeName(botName, `Bot ${botIndex}`),
      color: DEFAULT_PLAYER_COLORS[
        (this.nextJoinIndex - 1) % DEFAULT_PLAYER_COLORS.length
      ]!,
      kind: "bot",
      connected: true,
      joinIndex: this.nextJoinIndex,
      isOwner: false
    };
    this.nextBotIndex += 1;
    this.nextJoinIndex += 1;
    this.members.push(member);
    this.syncMembersToGameState();
    return { ok: true, payload: this.snapshot() };
  }

  importMap(socketId: string, encodedMap: string): RoomActionResult<RoomStatePayload> {
    const actor = this.memberBySocket(socketId);
    if (!actor?.isOwner) {
      return this.error("not_room_owner", "Only the room owner can import maps.");
    }
    if (this.roomPhase() !== "lobby") {
      return this.error("room_in_progress", "Maps can only be imported in the lobby.");
    }

    try {
      const document = decodeEditableMapDocument(encodedMap);
      const bodies = editableBallPlacementsToBodies(document);
      if (bodies.length === 0) {
        return this.error("map_has_no_balls", "Imported maps need at least one ball.");
      }

      this.loadMapSetup(editableMapToMapData(document), {
        ...defaultOfficialMapSetup.gameState,
        mapId: document.id,
        bodies
      });
      return { ok: true, payload: this.snapshot() };
    } catch {
      return this.error("invalid_map", "Could not import this map.");
    }
  }

  selectOfficialMap(socketId: string, mapId: string): RoomActionResult<RoomStatePayload> {
    const actor = this.memberBySocket(socketId);
    if (!actor?.isOwner) {
      return this.error("not_room_owner", "Only the room owner can select maps.");
    }
    if (this.roomPhase() !== "lobby") {
      return this.error("room_in_progress", "Maps can only be selected in the lobby.");
    }

    try {
      const setup = createOfficialMapSetup(mapId);
      if (setup.gameState.bodies.length === 0) {
        return this.error("map_has_no_balls", "Official map has no balls.");
      }
      this.loadMapSetup(setup.mapData, setup.gameState);
      return { ok: true, payload: this.snapshot() };
    } catch {
      return this.error("invalid_map", "Unknown official map.");
    }
  }

  updateShrinkCircle(
    socketId: string,
    settings: ShrinkCircleSettings
  ): RoomActionResult<RoomStatePayload> {
    const actor = this.memberBySocket(socketId);
    if (!actor?.isOwner) {
      return this.error("not_room_owner", "Only the room owner can change shrinking circle.");
    }
    if (this.roomPhase() !== "lobby") {
      return this.error("room_in_progress", "Shrinking circle can only be changed in the lobby.");
    }

    this.shrinkCircleSettings = normalizeShrinkCircleSettings(settings);
    return { ok: true, payload: this.snapshot() };
  }

  start(socketId: string): RoomActionResult<RoomStatePayload> {
    const actor = this.memberBySocket(socketId);
    if (!actor?.isOwner) {
      return this.error("not_room_owner", "Only the room owner can start the game.");
    }
    if (this.roomPhase() !== "lobby") {
      return this.error("room_in_progress", "This room has already started.");
    }

    const activeMembers = this.members.filter((member) => this.isActiveRoomMember(member));
    if (activeMembers.length < MIN_PLAYERS) {
      return this.error("not_enough_players", "At least two players are required.");
    }
    if (this.baseGameState.bodies.filter((body) => body.kind === "disc").length === 0) {
      return this.error("map_has_no_balls", "The current map has no balls.");
    }

    const ownerPlayerId =
      activeMembers.find((member) => member.isOwner)?.playerId ??
      activeMembers.find((member) => member.kind === "human")?.playerId ??
      activeMembers[0]?.playerId;
    this.members = activeMembers.map((member, index) => ({
      ...member,
      joinIndex: index + 1,
      isOwner: member.playerId === ownerPlayerId
    }));
    this.ensureOwner();

    const baseState: GameState = createRoomBaseState(
      this.roomId,
      this.baseGameState,
      this.seed
    );
    delete baseState.winnerTeamId;
    const setup = setupMatchGameState(
      baseState,
      this.members.map((member) => ({
        id: member.playerId,
        name: member.name,
        connected: member.connected,
        color: member.color,
        isBot: member.kind === "bot",
        joinIndex: member.joinIndex
      })),
      this.seed
    );
    this.gameState = setup.gameState;
    initializePickupState(this.gameState);
    this.turnOrder = [...setup.turnOrder];
    this.syncMembersToGameState();
    this.gameState.roundSlotIndex = 0;
    this.syncRoundCounters(this.gameState);
    this.refreshCurrentPlayerIfNeeded();
    this.beginWaitingAction(this.gameState);
    return { ok: true, payload: this.snapshot() };
  }

  reset(socketId: string): RoomActionResult<RoomStatePayload> {
    const actor = this.memberBySocket(socketId);
    if (!actor?.isOwner) {
      return this.error("not_room_owner", "Only the room owner can reset the room.");
    }

    this.gameState = createLobbyGameState(this.roomId, this.baseGameState);
    this.turnOrder = [];
    this.members = this.members
      .filter((member) => this.isActiveRoomMember(member))
      .map((member, index) => ({
        ...member,
        joinIndex: index + 1,
        isOwner: member.kind === "human" && index === 0
      }));
    this.ensureOwner();
    this.syncMembersToGameState();
    return { ok: true, payload: this.snapshot() };
  }

  submitShot(socketId: string, payload: ShotSubmitPayload): ShotSubmissionResult {
    const member = this.memberBySocket(socketId);
    return this.submitShotForPlayer(member?.playerId, payload);
  }

  resolveBonus(
    socketId: string,
    payload: BonusResolvePayload
  ): RoomActionResult<RoomStatePayload> {
    const playerId = this.memberBySocket(socketId)?.playerId;
    if (!playerId) {
      return this.error("unknown_player", "Unknown player.");
    }
    if (payload.knownStateHash !== this.stateHash()) {
      return this.error("state_hash_mismatch", "Your local state is out of date.");
    }

    const pendingChoice = this.gameState.pendingBonusChoice;
    const resolvingPendingChoice =
      this.gameState.phase === "choosing_bonus" && pendingChoice?.playerId === playerId;
    const resolvingBeforeShot =
      this.gameState.phase === "waiting_for_shot" &&
      this.gameState.currentPlayerId === playerId;
    const resolvingOwnedOptions = playerHasBonusOptions(this.gameState, playerId);

    if (!resolvingPendingChoice && !resolvingBeforeShot && !resolvingOwnedOptions) {
      return this.error("not_bonus_player", "This player cannot choose a bonus now.");
    }

    if (payload.optionId) {
      const result = resolveBonusOption(
        this.gameState,
        playerId,
        payload.optionId,
        resolvingPendingChoice ? pendingChoice?.recentAction : undefined
      );
      if (!result.ok) {
        return this.error(result.reason ?? "invalid_bonus_option", "Invalid bonus option.");
      }
    } else {
      keepBonusOptions(this.gameState, playerId);
    }

    if (resolvingPendingChoice) {
      this.finishPendingBonusChoice(playerId);
    }

    return { ok: true, payload: this.snapshot() };
  }

  resolveTeleport(
    socketId: string,
    payload: BonusTeleportPayload
  ): RoomActionResult<RoomStatePayload> {
    const validation = this.validateTargetBonusAction(socketId, payload.knownStateHash, "teleport");
    if (!validation.ok) {
      return validation;
    }
    const playerId = validation.payload;
    const body = this.gameState.bodies.find((candidate) => candidate.id === payload.bodyId);
    if (!isBodyOwnedByPlayer(body, playerId)) {
      return this.error("actor_not_owned", "Teleport can only move your own balls.");
    }
    if (!isBodyTeleportTargetLegal(this.gameState, this.mapData, payload.bodyId, payload.position)) {
      return this.error("invalid_teleport_target", "That teleport target is not legal.");
    }

    const state = this.cloneState();
    const optionCountBeforeAction = bonusOptionCount(state, playerId);
    const stateBody = state.bodies.find((candidate) => candidate.id === payload.bodyId);
    const previousPositions = new Map<string, BodyState["position"]>();
    if (stateBody) {
      previousPositions.set(stateBody.id, { ...stateBody.position });
    }
    clearActiveActionConstraint(state);
    teleportBody(state, payload.bodyId, payload.position, 0);
    collectPickups(state, 1, previousPositions);
    return this.finishTargetBonusAction(state, playerId, payload.bodyId, optionCountBeforeAction);
  }

  resolveAnchor(
    socketId: string,
    payload: BonusAnchorPayload
  ): RoomActionResult<RoomStatePayload> {
    const validation = this.validateTargetBonusAction(socketId, payload.knownStateHash, "anchor");
    if (!validation.ok) {
      return validation;
    }
    const playerId = validation.payload;
    const body = this.gameState.bodies.find((candidate) => candidate.id === payload.bodyId);
    if (!body?.alive) {
      return this.error("invalid_anchor_target", "Anchor needs a living target ball.");
    }

    const state = this.cloneState();
    const optionCountBeforeAction = bonusOptionCount(state, playerId);
    clearActiveActionConstraint(state);
    applyAnchorModifier(state, payload.bodyId, playerId, 0);
    return this.finishTargetBonusAction(state, playerId, payload.bodyId, optionCountBeforeAction);
  }

  submitShotForPlayer(
    playerId: string | undefined,
    payload: ShotSubmitPayload
  ): ShotSubmissionResult {
    const rejectionReason = this.validateShot(playerId, payload);
    if (rejectionReason) {
      return {
        ok: false,
        rejected: {
          shotId: payload.shotId,
          reason: rejectionReason,
          gameState: this.cloneState(),
          stateHash: this.stateHash()
        }
      };
    }

    const actingPlayerId = playerId!;
    const initialStateHash = this.stateHash();
    const started: ShotStartedPayload = {
      shotId: payload.shotId,
      playerId: actingPlayerId,
      turnIndex: this.gameState.turnIndex,
      initialStateHash,
      shotIntent: payload.shotIntent
    };

    const roundSlotAtActionStart = this.gameState.roundSlotIndex ?? this.gameState.turnIndex;
    const poisonCoveredAtStart = this.poisonCoveredBodyIdsForPlayer(
      actingPlayerId,
      this.gameState,
      roundSlotAtActionStart
    );
    const optionCountBeforeShot = bonusOptionCount(this.gameState, actingPlayerId);
    const activeConstraint = this.gameState.activeActionConstraint
      ? cloneJson(this.gameState.activeActionConstraint)
      : undefined;
    const stateForShot = this.cloneState();
    consumeShotStartBonuses(stateForShot, actingPlayerId);
    clearActiveActionConstraint(stateForShot);
    let shotIntentForSimulation = payload.shotIntent;
    let temporaryProjectileBodyId: string | undefined;
    const preSimulationEvents: SimulationEvent[] = [];
    if (activeConstraint?.kind === "shuriken" || activeConstraint?.kind === "summon_half_ball") {
      const projectile = createActionProjectile(
        stateForShot,
        payload.shotIntent.actorBodyId,
        activeConstraint.kind,
        payload.shotId,
        0
      );
      if (!projectile) {
        return {
          ok: false,
          rejected: {
            shotId: payload.shotId,
            reason: "projectile_spawn_failed",
            gameState: this.cloneState(),
            stateHash: this.stateHash()
          }
        };
      }
      preSimulationEvents.push(...projectile.events);
      shotIntentForSimulation = {
        ...payload.shotIntent,
        actorBodyId: projectile.bodyId
      };
      if (activeConstraint.kind === "shuriken") {
        temporaryProjectileBodyId = projectile.bodyId;
      }
    }
    const simulationResult = simulateShot(
      stateForShot,
      this.mapData,
      shotIntentForSimulation,
      this.simulationOptions
    );
    let simulationEvents = [...preSimulationEvents, ...simulationResult.events];
    const playbackFrames = [...(simulationResult.frames ?? [])];
    let finalMapData = simulationResult.finalMapData ?? this.mapData;
    let finalState = simulationResult.finalState;

    if (temporaryProjectileBodyId) {
      simulationEvents.push(
        ...destroyTemporaryBody(
          finalState,
          temporaryProjectileBodyId,
          nextEventStep(simulationEvents),
          "shuriken"
        )
      );
    }

    if (activeConstraint?.kind === "bomb") {
      const explosionStep = nextEventStep(simulationEvents);
      simulationEvents.push(
        ...applyBombExplosion(finalState, shotIntentForSimulation.actorBodyId, explosionStep)
      );
      const continuation = continueSimulation(
        finalState,
        finalMapData,
        this.simulationOptions,
        explosionStep
      );
      simulationEvents = [...simulationEvents, ...continuation.events];
      playbackFrames.push(...(continuation.frames ?? []));
      finalState = continuation.finalState;
      finalMapData = continuation.finalMapData ?? finalMapData;
    }

    const mapChanged = simulationChangedMap(simulationEvents);
    if (mapChanged) {
      this.mapData = finalMapData;
    }
    finalState.players = this.playerStatesFromMembers(finalState);
    finalState.turnIndex = this.gameState.turnIndex + 1;
    const poisonEvents = this.applyPoisonEliminations(
      finalState,
      actingPlayerId,
      poisonCoveredAtStart,
      roundSlotAtActionStart,
      nextEventStep(simulationEvents)
    );
    const recentAction = {
      actorBodyId: payload.shotIntent.actorBodyId,
      hadElimination: eventsIncludeElimination([...simulationEvents, ...poisonEvents])
    };
    applyPendingActionBonusesAfterShot(
      finalState,
      actingPlayerId,
      recentAction
    );
    const settlement = settleMatchState(
      finalState,
      this.turnOrder,
      actingPlayerId,
      this.connectedMemberIds()
    );
    if (settlement.gameState.phase !== "finished") {
      this.advanceNormalTurnAfterAction(
        settlement.gameState,
        actingPlayerId,
        activeConstraint === undefined
      );
    }
    const collectedBonusThisShot =
      bonusOptionCount(settlement.gameState, actingPlayerId) > optionCountBeforeShot;
    if (
      settlement.gameState.phase !== "finished" &&
      collectedBonusThisShot &&
      this.playerCanContinue(settlement.gameState, actingPlayerId)
    ) {
      const nextPlayerId = settlement.gameState.currentPlayerId || undefined;
      settlement.gameState.phase = "choosing_bonus";
      settlement.gameState.currentPlayerId = actingPlayerId;
      settlement.gameState.pendingBonusChoice = createPendingBonusChoice(
        actingPlayerId,
        settlement.gameState.turnIndex,
        nextPlayerId,
        recentAction
      );
      clearActiveActionConstraint(settlement.gameState);
    } else if (settlement.gameState.phase !== "finished") {
      this.activateNextActionOrSpawn(settlement.gameState, actingPlayerId);
    }
    this.gameState = settlement.gameState;
    const resultHash = this.stateHash();
    const resolved: ShotResolvedPayload = {
      shotId: payload.shotId,
      playerId: actingPlayerId,
      initialStateHash,
      initialState: simulationResult.initialState,
      shotIntent: payload.shotIntent,
      finalState: this.cloneState(),
      ...(mapChanged
        ? { finalMapData }
        : {}),
      events: [
        ...simulationEvents,
        ...poisonEvents,
        ...matchSettlementEvents(settlement.eliminatedPlayerIds, settlement.winnerPlayerId)
      ],
      frames: playbackFrames,
      shrinkCircle: this.shrinkCircleState(),
      resultHash
    };

    return { ok: true, started, resolved };
  }

  snapshot(playerId?: string): RoomStatePayload {
    const winnerPlayerId = this.winnerPlayerId();
    const ownerPlayerId = this.members.find((member) => member.isOwner)?.playerId;
    return {
      roomId: this.roomId,
      roomPhase: this.roomPhase(),
      ...(playerId ? { playerId } : {}),
      ...(ownerPlayerId ? { ownerPlayerId } : {}),
      ...(this.gameState.currentPlayerId
        ? { currentPlayerId: this.gameState.currentPlayerId }
        : {}),
      ...(winnerPlayerId ? { winnerPlayerId } : {}),
      players: this.publicMembers(),
      mapData: this.mapData,
      gameState: this.cloneState(),
      shrinkCircle: this.shrinkCircleState(),
      stateHash: this.stateHash()
    };
  }

  stateHash(): string {
    return hashGameState(this.gameState, true);
  }

  playBotTurns(): AcceptedShot[] {
    const shots: AcceptedShot[] = [];
    for (let attempts = 0; attempts < this.turnOrder.length * 4; attempts += 1) {
      if (this.gameState.phase === "choosing_bonus") {
        const member = this.members.find(
          (candidate) => candidate.playerId === this.gameState.pendingBonusChoice?.playerId
        );
        if (!member || member.kind !== "bot") {
          break;
        }
        this.resolveBotBonus(member.playerId);
        continue;
      }

      if (this.gameState.phase !== "waiting_for_shot") {
        break;
      }
      const member = this.currentMember();
      if (!member || member.kind !== "bot") {
        break;
      }
      if (this.resolveBotTargetBonus(member.playerId)) {
        continue;
      }
      if (
        this.gameState.activeActionConstraint?.kind === "teleport" ||
        this.gameState.activeActionConstraint?.kind === "anchor"
      ) {
        break;
      }
      if (playerHasBonusOptions(this.gameState, member.playerId)) {
        this.resolveBotBonus(member.playerId);
        continue;
      }

      const shotIntent = chooseBotShotIntent(
        this.gameState,
        this.mapData,
        member.playerId,
        this.shrinkCircleState()
      );
      if (!shotIntent) {
        this.finishEmptyBotTurn(member.playerId);
        continue;
      }

      const result = this.submitShotForPlayer(member.playerId, {
        shotId: `bot-${member.playerId}-${this.gameState.turnIndex}`,
        turnIndex: this.gameState.turnIndex,
        knownStateHash: this.stateHash(),
        shotIntent
      });
      if (!result.ok) {
        break;
      }
      shots.push(result);
    }
    return shots;
  }

  playerIdForSocket(socketId: string): string | undefined {
    return this.memberBySocket(socketId)?.playerId;
  }

  socketIdForPlayer(playerId: string): string | undefined {
    return this.members.find((member) => member.playerId === playerId && member.kind === "human")
      ?.socketId ?? undefined;
  }

  containsSocket(socketId: string): boolean {
    return this.members.some((member) => member.kind === "human" && member.socketId === socketId);
  }

  isDisposable(): boolean {
    return !this.members.some((member) => member.kind === "human" && member.connected);
  }

  private validateShot(
    playerId: string | undefined,
    payload: ShotSubmitPayload
  ): string | undefined {
    if (!playerId) {
      return "unknown_player";
    }
    if (payload.knownStateHash !== this.stateHash()) {
      return "state_hash_mismatch";
    }
    if (payload.turnIndex !== this.gameState.turnIndex) {
      return "turn_index_mismatch";
    }
    if (this.gameState.phase !== "waiting_for_shot") {
      return "room_not_waiting_for_shot";
    }
    if (this.gameState.currentPlayerId !== playerId) {
      return "not_current_player";
    }
    if (!allBodiesSleeping(this.gameState.bodies)) {
      return "bodies_still_moving";
    }
    if (
      this.gameState.activeActionConstraint?.kind === "teleport" ||
      this.gameState.activeActionConstraint?.kind === "anchor"
    ) {
      return "action_requires_target";
    }

    const player = this.gameState.players.find((candidate) => candidate.id === playerId);
    if (!player || player.connected === false || player.eliminated) {
      return "player_not_active";
    }

    const actor = this.gameState.bodies.find(
      (body) => body.id === payload.shotIntent.actorBodyId
    );
    if (!isBodyOwnedByPlayer(actor, playerId)) {
      return "actor_not_owned";
    }
    if (!actionConstraintAllowsBody(this.gameState, playerId, actor)) {
      return "actor_not_allowed";
    }
    if (payload.shotIntent.power > shotPowerLimitForPlayer(this.gameState, playerId) + 0.0001) {
      return "shot_power_too_high";
    }

    return undefined;
  }

  private validateTargetBonusAction(
    socketId: string,
    knownStateHash: string,
    kind: "teleport" | "anchor"
  ): RoomActionResult<string> {
    const playerId = this.memberBySocket(socketId)?.playerId;
    if (!playerId) {
      return this.error("unknown_player", "Unknown player.");
    }
    if (knownStateHash !== this.stateHash()) {
      return this.error("state_hash_mismatch", "Your local state is out of date.");
    }
    if (this.gameState.phase !== "waiting_for_shot") {
      return this.error("room_not_waiting_for_shot", "This action is not available now.");
    }
    if (this.gameState.currentPlayerId !== playerId) {
      return this.error("not_current_player", "It is not your turn.");
    }
    if (!allBodiesSleeping(this.gameState.bodies)) {
      return this.error("bodies_still_moving", "Wait for all balls to stop.");
    }
    const player = this.gameState.players.find((candidate) => candidate.id === playerId);
    if (!player || player.connected === false || player.eliminated) {
      return this.error("player_not_active", "This player cannot act.");
    }
    const constraint = this.gameState.activeActionConstraint;
    if (!constraint || constraint.kind !== kind || constraint.ownerPlayerId !== playerId) {
      return this.error("wrong_action_mode", "This bonus action is not active.");
    }
    return { ok: true, payload: playerId };
  }

  private finishTargetBonusAction(
    state: GameState,
    actingPlayerId: string,
    actorBodyId: string,
    optionCountBeforeAction: number
  ): RoomActionResult<RoomStatePayload> {
    state.players = this.playerStatesFromMembers(state);
    state.turnIndex = this.gameState.turnIndex + 1;
    const recentAction = {
      actorBodyId,
      hadElimination: false
    };
    const settlement = settleMatchState(
      state,
      this.turnOrder,
      actingPlayerId,
      this.connectedMemberIds()
    );
    if (settlement.gameState.phase !== "finished") {
      this.advanceNormalTurnAfterAction(settlement.gameState, actingPlayerId, false);
    }
    const collectedBonusThisAction =
      bonusOptionCount(settlement.gameState, actingPlayerId) > optionCountBeforeAction;
    if (
      settlement.gameState.phase !== "finished" &&
      collectedBonusThisAction &&
      this.playerCanContinue(settlement.gameState, actingPlayerId)
    ) {
      const nextPlayerId = settlement.gameState.currentPlayerId || undefined;
      settlement.gameState.phase = "choosing_bonus";
      settlement.gameState.currentPlayerId = actingPlayerId;
      settlement.gameState.pendingBonusChoice = createPendingBonusChoice(
        actingPlayerId,
        settlement.gameState.turnIndex,
        nextPlayerId,
        recentAction
      );
      clearActiveActionConstraint(settlement.gameState);
    } else if (settlement.gameState.phase !== "finished") {
      this.activateNextActionOrSpawn(settlement.gameState, actingPlayerId);
    }
    this.gameState = settlement.gameState;
    return { ok: true, payload: this.snapshot() };
  }

  private advanceNormalTurnAfterAction(
    state: GameState,
    actingPlayerId: string,
    advanceCompletedSlot: boolean
  ): void {
    if (this.turnOrder.length === 0) {
      state.currentPlayerId = "";
      this.syncRoundCounters(state);
      return;
    }

    if (state.roundSlotIndex === undefined) {
      state.roundSlotIndex = this.roundSlotIndexForPlayerSlot(actingPlayerId);
    }
    if (advanceCompletedSlot) {
      state.roundSlotIndex += 1;
    }
    this.selectNextNormalTurnPlayer(state);
  }

  private selectNextNormalTurnPlayer(state: GameState): void {
    if (this.turnOrder.length === 0) {
      state.currentPlayerId = "";
      this.syncRoundCounters(state);
      return;
    }

    state.roundSlotIndex = state.roundSlotIndex ?? 0;
    for (let skipped = 0; skipped < this.turnOrder.length; skipped += 1) {
      this.syncRoundCounters(state);
      const playerId = this.turnOrder[state.roundSlotIndex % this.turnOrder.length]!;
      if (this.playerCanTakeNormalTurn(state, playerId)) {
        state.currentPlayerId = playerId;
        state.phase = "waiting_for_shot";
        return;
      }
      state.roundSlotIndex += 1;
      state.turnIndex += 1;
    }
    state.currentPlayerId = "";
    this.syncRoundCounters(state);
  }

  private playerCanTakeNormalTurn(state: GameState, playerId: string): boolean {
    const member = this.members.find((candidate) => candidate.playerId === playerId);
    const player = state.players.find((candidate) => candidate.id === playerId);
    const ballCounts = countAliveOwnedBodies(state);
    return Boolean(
      member &&
      this.isActiveRoomMember(member) &&
      player &&
      !player.eliminated &&
      (ballCounts[playerId] ?? 0) > 0
    );
  }

  private roundSlotIndexForPlayerSlot(playerId: string): number {
    const orderLength = Math.max(1, this.turnOrder.length);
    const currentSlot = this.gameState.roundSlotIndex ?? 0;
    const playerIndex = Math.max(0, this.turnOrder.indexOf(playerId));
    const currentRoundStart = currentSlot - (currentSlot % orderLength);
    const candidate = currentRoundStart + playerIndex;
    return candidate < currentSlot ? candidate + orderLength : candidate;
  }

  private syncRoundCounters(state: GameState): void {
    const orderLength = Math.max(1, this.turnOrder.length || this.members.length || 1);
    const slotIndex = state.roundSlotIndex ?? 0;
    state.roundSlotIndex = slotIndex;
    state.roundIndex = Math.floor(slotIndex / orderLength);
  }

  private refreshCurrentPlayerIfNeeded(): void {
    if (this.gameState.phase !== "waiting_for_shot") {
      return;
    }

    const currentMember = this.members.find(
      (member) => member.playerId === this.gameState.currentPlayerId
    );
    if (
      currentMember &&
      this.isActiveRoomMember(currentMember) &&
      this.playerCanTakeNormalTurn(this.gameState, currentMember.playerId)
    ) {
      return;
    }

    this.selectNextNormalTurnPlayer(this.gameState);
  }

  private syncMembersToGameState(): void {
    this.gameState.players = this.playerStatesFromMembers(this.gameState);
  }

  private playerStatesFromMembers(sourceState: GameState): GameState["players"] {
    return this.members.map((member, index) => {
      const existing = sourceState.players.find((player) => player.id === member.playerId);
      const turnOrderIndex = this.turnOrder.indexOf(member.playerId);
      return {
        id: member.playerId,
        teamId: member.playerId,
        name: member.name,
        color: member.color,
        connected: member.connected,
        isBot: member.kind === "bot",
        eliminated: existing?.eliminated ?? false,
        turnOrderIndex: turnOrderIndex >= 0 ? turnOrderIndex : index
      };
    });
  }

  private publicMembers(): RoomMember[] {
    const ballCounts = countAliveOwnedBodies(this.gameState);
    return this.members
      .map((member) => {
        const player = this.gameState.players.find((candidate) => candidate.id === member.playerId);
        return {
          playerId: member.playerId,
          name: member.name,
          color: member.color,
          kind: member.kind,
          connected: member.connected,
          joinIndex: member.joinIndex,
          isOwner: member.isOwner,
          eliminated: player?.eliminated ?? false,
          ballCount: ballCounts[member.playerId] ?? 0
        };
      })
      .sort((a, b) => a.joinIndex - b.joinIndex);
  }

  private memberBySocket(socketId: string): RoomMemberState | undefined {
    return this.members.find((member) => member.kind === "human" && member.socketId === socketId);
  }

  private connectedMemberIds(): ReadonlySet<string> {
    return new Set(
      this.members
        .filter((member) => this.isActiveRoomMember(member))
        .map((member) => member.playerId)
    );
  }

  private shrinkCircleState(turnIndex = this.gameState.roundSlotIndex ?? this.gameState.turnIndex) {
    return shrinkCircleStateForTurn(
      this.mapData,
      turnIndex,
      this.turnOrder.length || this.members.length || 1,
      this.shrinkCircleSettings
    );
  }

  private poisonCoveredBodyIdsForPlayer(
    playerId: string,
    state: GameState,
    turnIndex: number
  ): ReadonlySet<string> {
    const circle = this.shrinkCircleState(turnIndex);
    return new Set(
      state.bodies
        .filter(
          (body) =>
            body.alive &&
            body.ownerPlayerId === playerId &&
            isBodyFullyCoveredByPoison(body, circle)
        )
        .map((body) => body.id)
    );
  }

  private applyPoisonEliminations(
    state: GameState,
    playerId: string,
    coveredAtStart: ReadonlySet<string>,
    turnIndex: number,
    step: number
  ): SimulationEvent[] {
    if (coveredAtStart.size === 0) {
      return [];
    }

    const circle = this.shrinkCircleState(turnIndex);
    const events: SimulationEvent[] = [];
    for (const body of state.bodies) {
      if (
        !body.alive ||
        body.ownerPlayerId !== playerId ||
        !coveredAtStart.has(body.id) ||
        !isBodyFullyCoveredByPoison(body, circle)
      ) {
        continue;
      }

      markBodyOutOfBounds(body);
      events.push({
        type: "body_out_of_bounds",
        step,
        bodyIds: [body.id],
        bodySnapshots: [bodySnapshot(body)],
        data: {
          reason: "shrink_circle",
          turnIndex,
          playerId,
          progress: circle.progress
        }
      });
    }
    return events;
  }

  private isActiveRoomMember(member: RoomMemberState): boolean {
    return member.kind === "bot" || member.connected;
  }

  private currentMember(): RoomMemberState | undefined {
    return this.members.find((member) => member.playerId === this.gameState.currentPlayerId);
  }

  private beginWaitingAction(state: GameState): void {
    delete state.pendingBonusChoice;
    if (state.phase !== "waiting_for_shot" || !state.currentPlayerId) {
      return;
    }
    clearAnchorModifiersForPlayer(state, state.currentPlayerId);
    spawnPickupForTurn(state, this.mapData);
  }

  private activateNextActionOrSpawn(state: GameState, actingPlayerId: string): void {
    if (state.phase !== "waiting_for_shot") {
      return;
    }
    const token = takeNextUsableActionToken(state, actingPlayerId);
    if (token) {
      state.currentPlayerId = actingPlayerId;
      state.phase = "waiting_for_shot";
    }
    this.beginWaitingAction(state);
  }

  private finishPendingBonusChoice(playerId: string): void {
    const pendingChoice = this.gameState.pendingBonusChoice;
    if (!pendingChoice || pendingChoice.playerId !== playerId) {
      return;
    }

    const token = takeNextUsableActionToken(this.gameState, playerId);
    if (token) {
      this.gameState.currentPlayerId = playerId;
      this.gameState.phase = "waiting_for_shot";
    } else if (pendingChoice.nextPlayerId) {
      this.gameState.currentPlayerId = pendingChoice.nextPlayerId;
      this.gameState.phase = "waiting_for_shot";
      clearActiveActionConstraint(this.gameState);
    } else {
      this.gameState.currentPlayerId = "";
      this.gameState.phase = "finished";
      clearActiveActionConstraint(this.gameState);
    }
    delete this.gameState.pendingBonusChoice;
    this.beginWaitingAction(this.gameState);
  }

  private resolveBotBonus(playerId: string): void {
    const options = getPlayerBonusState(this.gameState, playerId).options;
    const option = options[botBonusOptionIndex(this.seed, this.gameState.turnIndex, options.length)];
    if (option) {
      resolveBonusOption(
        this.gameState,
        playerId,
        option.id,
        this.gameState.phase === "choosing_bonus"
          ? this.gameState.pendingBonusChoice?.recentAction
          : undefined
      );
    } else {
      keepBonusOptions(this.gameState, playerId);
    }
    if (this.gameState.phase === "choosing_bonus") {
      this.finishPendingBonusChoice(playerId);
    }
  }

  private resolveBotTargetBonus(playerId: string): boolean {
    const constraint = this.gameState.activeActionConstraint;
    if (!constraint || constraint.ownerPlayerId !== playerId) {
      return false;
    }
    if (constraint.kind === "teleport") {
      const body = this.gameState.bodies.find(
        (candidate) => candidate.alive && candidate.ownerPlayerId === playerId
      );
      if (!body || !isBodyTeleportTargetLegal(this.gameState, this.mapData, body.id, body.position)) {
        return false;
      }
      const state = this.cloneState();
      const optionCountBeforeAction = bonusOptionCount(state, playerId);
      clearActiveActionConstraint(state);
      teleportBody(state, body.id, body.position, 0);
      this.finishTargetBonusAction(state, playerId, body.id, optionCountBeforeAction);
      return true;
    }
    if (constraint.kind === "anchor") {
      const body =
        this.gameState.bodies.find(
          (candidate) => candidate.alive && candidate.ownerPlayerId !== playerId
        ) ??
        this.gameState.bodies.find((candidate) => candidate.alive);
      if (!body) {
        return false;
      }
      const state = this.cloneState();
      const optionCountBeforeAction = bonusOptionCount(state, playerId);
      clearActiveActionConstraint(state);
      applyAnchorModifier(state, body.id, playerId, 0);
      this.finishTargetBonusAction(state, playerId, body.id, optionCountBeforeAction);
      return true;
    }
    return false;
  }

  private playerCanContinue(state: GameState, playerId: string): boolean {
    const player = state.players.find((candidate) => candidate.id === playerId);
    return Boolean(
      player &&
      !player.eliminated &&
      state.bodies.some((body) => body.alive && body.ownerPlayerId === playerId)
    );
  }

  private finishEmptyBotTurn(botPlayerId: string): void {
    this.gameState.turnIndex += 1;
    const settlement = settleMatchState(
      this.gameState,
      this.turnOrder,
      botPlayerId,
      this.connectedMemberIds()
    );
    if (settlement.gameState.phase !== "finished") {
      this.advanceNormalTurnAfterAction(settlement.gameState, botPlayerId, true);
      this.activateNextActionOrSpawn(settlement.gameState, botPlayerId);
    }
    this.gameState = settlement.gameState;
  }

  private roomPhase(): RoomStatePayload["roomPhase"] {
    if (this.gameState.phase === "lobby") {
      return "lobby";
    }
    if (this.gameState.phase === "finished") {
      return "finished";
    }
    return "playing";
  }

  private winnerPlayerId(): string | undefined {
    if (!this.gameState.winnerTeamId) {
      return undefined;
    }
    return this.gameState.players.find(
      (player) => player.teamId === this.gameState.winnerTeamId
    )?.id;
  }

  private ensureOwner(): void {
    if (this.members.some((member) => member.isOwner && member.kind === "human" && member.connected)) {
      return;
    }
    const nextOwner =
      this.members.find((member) => member.kind === "human" && member.connected) ??
      this.members.find((member) => member.kind === "human") ??
      this.members[0];
    this.members = this.members.map((member) => ({
      ...member,
      isOwner: member.playerId === nextOwner?.playerId
    }));
  }

  private cloneState(): GameState {
    return JSON.parse(JSON.stringify(this.gameState)) as GameState;
  }

  private loadMapSetup(mapData: MapData, sourceState: GameState): void {
    this.mapData = cloneJson(mapData);
    this.baseGameState = createRoomBaseState(this.roomId, sourceState, this.seed);
    this.gameState = createLobbyGameState(this.roomId, this.baseGameState);
    this.turnOrder = [];
    this.syncMembersToGameState();
  }

  private joinedPayload(member: RoomMemberState): RoomJoinedPayload {
    if (!member.rejoinToken) {
      throw new Error("Only human members can receive joined payloads.");
    }
    return {
      ...this.snapshot(member.playerId),
      playerId: member.playerId,
      rejoinToken: member.rejoinToken
    };
  }

  private error(reason: string, message: string): RoomActionError {
    return { ok: false, error: { reason, message, roomId: this.roomId } };
  }
}

function createRoomBaseState(roomId: string, source: GameState, seed: number): GameState {
  const cloned = JSON.parse(JSON.stringify(source)) as GameState;
  const state: GameState = {
    ...cloned,
    gameId: `room-${roomId}`,
    turnIndex: 0,
    roundSlotIndex: 0,
    roundIndex: 0,
    currentPlayerId: "",
    phase: "lobby",
    players: [],
    bodies: cloned.bodies.map((body) => ({
      ...body,
      velocity: { x: 0, y: 0 },
      spin: 0,
      alive: true,
      sleep: true
    })),
    pickups: [],
    playerBonuses: [],
    rngSeed: seed
  };
  delete state.pendingBonusChoice;
  delete state.activeActionConstraint;
  delete state.winnerTeamId;
  return state;
}

function createLobbyGameState(roomId: string, baseState: GameState): GameState {
  const state: GameState = {
    ...(JSON.parse(JSON.stringify(baseState)) as GameState),
    gameId: `room-${roomId}`,
    turnIndex: 0,
    roundSlotIndex: 0,
    roundIndex: 0,
    currentPlayerId: "",
    phase: "lobby",
    players: [],
    pickups: [],
    playerBonuses: []
  };
  delete state.pendingBonusChoice;
  delete state.activeActionConstraint;
  delete state.winnerTeamId;
  return state;
}

function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase();
}

function normalizeName(name: string | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed.slice(0, 24) : fallback;
}

function createToken(): string {
  return randomBytes(12).toString("hex");
}

function botBonusOptionIndex(seed: number, turnIndex: number, optionCount: number): number {
  if (optionCount <= 0) {
    return -1;
  }
  return Math.abs(Math.imul(seed >>> 0, 1103515245) + turnIndex * 12345) % optionCount;
}

function matchSettlementEvents(
  eliminatedPlayerIds: readonly string[],
  winnerPlayerId: string | undefined
): SimulationEvent[] {
  const events: SimulationEvent[] = eliminatedPlayerIds.map((playerId) => ({
    type: "player_eliminated",
    step: 0,
    data: { playerId }
  }));
  if (winnerPlayerId) {
    events.push({
      type: "match_finished",
      step: 0,
      data: { winnerPlayerId }
    });
  }
  return events;
}

function nextEventStep(events: readonly SimulationEvent[]): number {
  return Math.max(0, ...events.map((event) => event.step)) + 1;
}

function simulationChangedMap(events: readonly SimulationEvent[]): boolean {
  return events.some(
    (event) => event.type === "terrain_changed" || event.type === "obstacle_changed"
  );
}

function markBodyOutOfBounds(body: BodyState): void {
  body.alive = false;
  body.sleep = true;
  body.velocity = { x: 0, y: 0 };
  body.spin = 0;
}

function bodySnapshot(body: BodyState) {
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
