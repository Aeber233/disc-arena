import {
  allBodiesSleeping,
  billiardsMapData,
  createBilliardsGameState,
  hashGameState,
  simulateShot
} from "@disc-arena/core";
import type {
  GameState,
  RoomJoinedPayload,
  RoomPlayer,
  RoomStatePayload,
  ShotRejectedPayload,
  ShotResolvedPayload,
  ShotStartedPayload,
  ShotSubmitPayload,
  SimulationOptions
} from "@disc-arena/core";

const ROOM_ID = "public-testmap";

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

const authoritativeSimulationOptions: SimulationOptions = {
  mode: "authoritative",
  fixedDt: 1 / 60,
  maxSteps: 1800,
  collisionIterations: 3,
  recordFrames: false,
  frameIntervalSteps: 1,
  quantize: true
};

export class PublicTestMapRoom {
  private gameState: GameState = createBilliardsGameState();
  private readonly players = new Map<string, RoomPlayer>();
  private readonly socketToPlayer = new Map<string, string>();
  private nextJoinIndex = 1;

  join(socketId: string): RoomJoinedPayload {
    const playerId = `player-${this.nextJoinIndex}`;
    const player: RoomPlayer = {
      playerId,
      connected: true,
      joinIndex: this.nextJoinIndex
    };
    this.nextJoinIndex += 1;
    this.players.set(playerId, player);
    this.socketToPlayer.set(socketId, playerId);
    this.syncPlayersToGameState();

    if (!this.connectedPlayers().some((candidate) => candidate.playerId === this.gameState.currentPlayerId)) {
      this.gameState.currentPlayerId = playerId;
    }

    return {
      ...this.snapshot(),
      playerId
    };
  }

  leave(socketId: string): RoomStatePayload {
    const playerId = this.socketToPlayer.get(socketId);
    if (playerId) {
      const player = this.players.get(playerId);
      if (player) {
        this.players.set(playerId, { ...player, connected: false });
      }
      this.socketToPlayer.delete(socketId);
    }

    this.syncPlayersToGameState();
    if (this.gameState.phase === "waiting_for_shot" && playerId === this.gameState.currentPlayerId) {
      this.gameState.currentPlayerId = this.nextConnectedPlayerId(playerId) ?? "";
    }

    return this.snapshot();
  }

  reset(): RoomStatePayload {
    const currentPlayers = this.connectedPlayers();
    this.gameState = createBilliardsGameState();
    this.syncPlayersToGameState();
    this.gameState.currentPlayerId = currentPlayers[0]?.playerId ?? "";
    this.gameState.phase = "waiting_for_shot";
    return this.snapshot();
  }

  submitShot(socketId: string, payload: ShotSubmitPayload): ShotSubmissionResult {
    const playerId = this.socketToPlayer.get(socketId);
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

    const simulationResult = simulateShot(
      this.gameState,
      billiardsMapData,
      payload.shotIntent,
      authoritativeSimulationOptions
    );
    const finalState = simulationResult.finalState;
    finalState.players = this.gameState.players;
    finalState.turnIndex = this.gameState.turnIndex + 1;
    finalState.currentPlayerId =
      this.nextConnectedPlayerId(this.gameState.currentPlayerId) ?? actingPlayerId;
    finalState.phase = "waiting_for_shot";

    this.gameState = finalState;
    const resultHash = this.stateHash();
    const resolved: ShotResolvedPayload = {
      shotId: payload.shotId,
      playerId: actingPlayerId,
      initialStateHash,
      shotIntent: payload.shotIntent,
      finalState: this.cloneState(),
      events: simulationResult.events,
      resultHash
    };

    return { ok: true, started, resolved };
  }

  snapshot(playerId?: string): RoomStatePayload {
    const payload: RoomStatePayload = {
      roomId: ROOM_ID,
      players: this.publicPlayers(),
      mapData: billiardsMapData,
      gameState: this.cloneState(),
      stateHash: this.stateHash()
    };

    if (playerId) {
      return { ...payload, playerId };
    }

    return payload;
  }

  playerIdForSocket(socketId: string): string | undefined {
    return this.socketToPlayer.get(socketId);
  }

  stateHash(): string {
    return hashGameState(this.gameState, true);
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

    const actor = this.gameState.bodies.find(
      (body) => body.id === payload.shotIntent.actorBodyId
    );
    if (!actor || !actor.alive) {
      return "actor_not_selectable";
    }

    return undefined;
  }

  private nextConnectedPlayerId(afterPlayerId: string): string | undefined {
    const players = this.publicPlayers();
    if (!players.some((player) => player.connected)) {
      return undefined;
    }

    const currentIndex = players.findIndex(
      (player) => player.playerId === afterPlayerId
    );
    if (currentIndex < 0) {
      return players.find((player) => player.connected)?.playerId;
    }

    for (let offset = 1; offset <= players.length; offset += 1) {
      const candidate = players[(currentIndex + offset) % players.length];
      if (candidate?.connected) {
        return candidate.playerId;
      }
    }

    return undefined;
  }

  private connectedPlayers(): RoomPlayer[] {
    return this.publicPlayers().filter((player) => player.connected);
  }

  private publicPlayers(): RoomPlayer[] {
    return [...this.players.values()].sort((a, b) => a.joinIndex - b.joinIndex);
  }

  private syncPlayersToGameState(): void {
    this.gameState.players = this.publicPlayers().map((player) => ({
      id: player.playerId,
      teamId: player.playerId,
      connected: player.connected
    }));

    if (!this.gameState.currentPlayerId) {
      this.gameState.currentPlayerId = this.connectedPlayers()[0]?.playerId ?? "";
    }
  }

  private cloneState(): GameState {
    return JSON.parse(JSON.stringify(this.gameState)) as GameState;
  }
}
