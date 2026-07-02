import {
  allBodiesSleeping,
  billiardsMapData,
  countAliveOwnedBodies,
  createBilliardsGameState,
  decodeEditableMapDocument,
  DEFAULT_SHRINK_CIRCLE_SETTINGS,
  DEFAULT_PLAYER_COLORS,
  editableBallPlacementsToBodies,
  editableMapToMapData,
  hashGameState,
  isBodyFullyCoveredByPoison,
  isBodyOwnedByPlayer,
  nextTurnPlayerId,
  normalizeShrinkCircleSettings,
  setupMatchGameState,
  settleMatchState,
  shrinkCircleStateForTurn,
  simulateShot
} from "@disc-arena/core";
import type {
  BodyState,
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

/**
 * Owns lobby membership plus one authoritative Disc Arena match.
 */
export class DiscArenaRoom {
  private readonly roomId: string;
  private readonly seed: number;
  private members: RoomMemberState[] = [];
  private mapData: MapData = billiardsMapData;
  private baseGameState: GameState = createBilliardsGameState();
  private gameState: GameState = createLobbyGameState("lobby", this.baseGameState);
  private shrinkCircleSettings: ShrinkCircleSettings = DEFAULT_SHRINK_CIRCLE_SETTINGS;
  private turnOrder: string[] = [];
  private nextJoinIndex = 1;
  private nextBotIndex = 1;

  constructor(roomId: string, seed = Date.now()) {
    this.roomId = normalizeRoomId(roomId);
    this.seed = seed;
    this.baseGameState = createRoomBaseState(this.roomId, createBilliardsGameState(), this.seed);
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

      this.mapData = editableMapToMapData(document);
      this.baseGameState = createRoomBaseState(
        this.roomId,
        {
          ...createBilliardsGameState(),
          mapId: this.mapData.id,
          bodies
        },
        this.seed
      );
      this.gameState = createLobbyGameState(this.roomId, this.baseGameState);
      this.turnOrder = [];
      this.syncMembersToGameState();
      return { ok: true, payload: this.snapshot() };
    } catch {
      return this.error("invalid_map", "Could not import this map.");
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
    this.turnOrder = [...setup.turnOrder];
    this.refreshCurrentPlayerIfNeeded();
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

    const poisonCoveredAtStart = this.poisonCoveredBodyIdsForPlayer(
      actingPlayerId,
      this.gameState,
      this.gameState.turnIndex
    );
    const simulationResult = simulateShot(
      this.gameState,
      this.mapData,
      payload.shotIntent,
      authoritativeSimulationOptions
    );
    const mapChanged = simulationChangedMap(simulationResult.events);
    if (mapChanged && simulationResult.finalMapData) {
      this.mapData = simulationResult.finalMapData;
    }
    const finalState = simulationResult.finalState;
    finalState.players = this.playerStatesFromMembers(finalState);
    finalState.turnIndex = this.gameState.turnIndex + 1;
    const poisonEvents = this.applyPoisonEliminations(
      finalState,
      actingPlayerId,
      poisonCoveredAtStart,
      finalState.turnIndex,
      nextEventStep(simulationResult.events)
    );
    const settlement = settleMatchState(
      finalState,
      this.turnOrder,
      actingPlayerId,
      this.connectedMemberIds()
    );
    this.gameState = settlement.gameState;
    const resultHash = this.stateHash();
    const resolved: ShotResolvedPayload = {
      shotId: payload.shotId,
      playerId: actingPlayerId,
      initialStateHash,
      initialState: simulationResult.initialState,
      shotIntent: payload.shotIntent,
      finalState: this.cloneState(),
      ...(mapChanged && simulationResult.finalMapData
        ? { finalMapData: simulationResult.finalMapData }
        : {}),
      events: [
        ...simulationResult.events,
        ...poisonEvents,
        ...matchSettlementEvents(settlement.eliminatedPlayerIds, settlement.winnerPlayerId)
      ],
      frames: simulationResult.frames ?? [],
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
    for (let attempts = 0; attempts < this.turnOrder.length; attempts += 1) {
      if (this.gameState.phase !== "waiting_for_shot") {
        break;
      }
      const member = this.currentMember();
      if (!member || member.kind !== "bot") {
        break;
      }

      const shotIntent = chooseBotShotIntent(this.gameState, this.mapData, member.playerId);
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

    return undefined;
  }

  private refreshCurrentPlayerIfNeeded(): void {
    if (this.gameState.phase !== "waiting_for_shot") {
      return;
    }

    const currentMember = this.members.find(
      (member) => member.playerId === this.gameState.currentPlayerId
    );
    if (currentMember && this.isActiveRoomMember(currentMember)) {
      return;
    }

    this.gameState.currentPlayerId =
      nextTurnPlayerId(
        this.gameState,
        this.turnOrder.length ? this.turnOrder : this.members.map((member) => member.playerId),
        this.gameState.currentPlayerId,
        this.connectedMemberIds()
      ) ?? "";
  }

  private syncMembersToGameState(): void {
    this.gameState.players = this.playerStatesFromMembers(this.gameState);
  }

  private playerStatesFromMembers(sourceState: GameState): GameState["players"] {
    return this.members.map((member, index) => {
      const existing = sourceState.players.find((player) => player.id === member.playerId);
      return {
        id: member.playerId,
        teamId: member.playerId,
        name: member.name,
        color: member.color,
        connected: member.connected,
        isBot: member.kind === "bot",
        eliminated: existing?.eliminated ?? false,
        turnOrderIndex: index
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

  private shrinkCircleState(turnIndex = this.gameState.turnIndex) {
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

  private finishEmptyBotTurn(botPlayerId: string): void {
    this.gameState.turnIndex += 1;
    const settlement = settleMatchState(
      this.gameState,
      this.turnOrder,
      botPlayerId,
      this.connectedMemberIds()
    );
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
    rngSeed: seed
  };
  delete state.winnerTeamId;
  return state;
}

function createLobbyGameState(roomId: string, baseState: GameState): GameState {
  const state: GameState = {
    ...(JSON.parse(JSON.stringify(baseState)) as GameState),
    gameId: `room-${roomId}`,
    turnIndex: 0,
    currentPlayerId: "",
    phase: "lobby",
    players: []
  };
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
