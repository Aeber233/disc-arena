import type { BodyState } from "../types/body";
import type { GameState, PlayerState } from "../types/game";

export const DEFAULT_PLAYER_COLORS = [
  "#e84d4f",
  "#4d9fff",
  "#f4d35e",
  "#66c17a",
  "#c77dff",
  "#ff9f45"
] as const;

export interface MatchSetupPlayer {
  readonly id: string;
  readonly name?: string;
  readonly connected?: boolean;
  readonly color?: string;
  readonly isBot?: boolean;
  readonly joinIndex?: number;
}

export interface MatchSetupResult {
  readonly gameState: GameState;
  readonly turnOrder: readonly string[];
  readonly ballCounts: Readonly<Record<string, number>>;
}

export interface MatchSettlementResult {
  readonly gameState: GameState;
  readonly eliminatedPlayerIds: readonly string[];
  readonly winnerPlayerId?: string;
}

/**
 * Builds the authoritative starting state for a multiplayer match.
 */
export function setupMatchGameState(
  baseState: GameState,
  players: readonly MatchSetupPlayer[],
  seed: number
): MatchSetupResult {
  const playerStates = players.map((player, index) =>
    createPlayerState(player, index)
  );
  const bodies = assignBodiesToPlayers(baseState.bodies, playerStates, seed);
  const nextState: GameState = {
    ...cloneGameState(baseState),
    players: playerStates,
    bodies,
    phase: "waiting_for_shot"
  };
  delete nextState.winnerTeamId;
  const ballCounts = countAliveOwnedBodies(nextState);
  const turnOrder = orderPlayersForOpeningTurn(playerStates, ballCounts);
  const currentPlayerId = nextTurnPlayerId(nextState, turnOrder, "", connectedPlayerIds(nextState));

  nextState.currentPlayerId = currentPlayerId ?? "";
  if (!currentPlayerId) {
    nextState.phase = "finished";
  }

  return { gameState: nextState, turnOrder, ballCounts };
}

/**
 * Applies ownership and ring color tags to every alive disc body.
 */
export function assignBodiesToPlayers(
  bodies: readonly BodyState[],
  players: readonly PlayerState[],
  seed: number
): BodyState[] {
  if (players.length === 0) {
    return bodies.map(cloneBody);
  }

  const assignableIds = shuffle(
    bodies
      .filter((body) => body.kind === "disc" && body.alive)
      .map((body) => body.id),
    seed
  );
  const assignment = new Map<string, PlayerState>();
  assignableIds.forEach((bodyId, index) => {
    assignment.set(bodyId, players[index % players.length]!);
  });

  return bodies.map((body) => {
    const owner = assignment.get(body.id);
    if (!owner) {
      return cloneBody(body);
    }

    return {
      ...cloneBody(body),
      ownerPlayerId: owner.id,
      teamId: owner.teamId,
      tags: withOuterColorTag(body.tags, owner.color ?? DEFAULT_PLAYER_COLORS[0])
    };
  });
}

export function countAliveOwnedBodies(state: GameState): Record<string, number> {
  const counts = Object.fromEntries(state.players.map((player) => [player.id, 0])) as Record<
    string,
    number
  >;

  for (const body of state.bodies) {
    if (!body.alive || !body.ownerPlayerId || !(body.ownerPlayerId in counts)) {
      continue;
    }
    counts[body.ownerPlayerId] = (counts[body.ownerPlayerId] ?? 0) + 1;
  }

  return counts;
}

export function orderPlayersForOpeningTurn(
  players: readonly PlayerState[],
  ballCounts: Readonly<Record<string, number>>
): string[] {
  return [...players]
    .sort((a, b) => {
      const countDiff = (ballCounts[a.id] ?? 0) - (ballCounts[b.id] ?? 0);
      if (countDiff !== 0) {
        return countDiff;
      }
      return (a.turnOrderIndex ?? 0) - (b.turnOrderIndex ?? 0);
    })
    .map((player) => player.id);
}

export function nextTurnPlayerId(
  state: GameState,
  turnOrder: readonly string[],
  afterPlayerId: string,
  connectedIds?: ReadonlySet<string>
): string | undefined {
  if (turnOrder.length === 0) {
    return undefined;
  }

  const ballCounts = countAliveOwnedBodies(state);
  const startIndex = Math.max(-1, turnOrder.indexOf(afterPlayerId));

  for (let offset = 1; offset <= turnOrder.length; offset += 1) {
    const playerId = turnOrder[(startIndex + offset + turnOrder.length) % turnOrder.length]!;
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (!player || player.eliminated || (ballCounts[playerId] ?? 0) <= 0) {
      continue;
    }
    if (connectedIds && !connectedIds.has(playerId)) {
      continue;
    }
    return playerId;
  }

  return undefined;
}

export function settleMatchState(
  state: GameState,
  turnOrder: readonly string[],
  afterPlayerId: string,
  connectedIds?: ReadonlySet<string>
): MatchSettlementResult {
  const ballCounts = countAliveOwnedBodies(state);
  const eliminatedPlayerIds: string[] = [];
  state.players = state.players.map((player) => {
    const eliminated = (ballCounts[player.id] ?? 0) <= 0;
    if (eliminated && !player.eliminated) {
      eliminatedPlayerIds.push(player.id);
    }
    return { ...player, eliminated };
  });

  const contenders = state.players.filter((player) => (ballCounts[player.id] ?? 0) > 0);
  if (contenders.length <= 1) {
    const winner = contenders[0];
    state.phase = "finished";
    state.currentPlayerId = "";
    if (winner) {
      state.winnerTeamId = winner.teamId;
    } else {
      delete state.winnerTeamId;
    }
    return winner ? {
      gameState: state,
      eliminatedPlayerIds,
      winnerPlayerId: winner.id
    } : { gameState: state, eliminatedPlayerIds };
  }

  state.phase = "waiting_for_shot";
  delete state.winnerTeamId;
  state.currentPlayerId = nextTurnPlayerId(state, turnOrder, afterPlayerId, connectedIds) ?? "";
  return { gameState: state, eliminatedPlayerIds };
}

export function isBodyOwnedByPlayer(body: BodyState | undefined, playerId: string): boolean {
  return Boolean(body?.alive && body.ownerPlayerId === playerId);
}

export function connectedPlayerIds(state: GameState): ReadonlySet<string> {
  return new Set(
    state.players
      .filter((player) => player.connected !== false)
      .map((player) => player.id)
  );
}

export function withOuterColorTag(tags: readonly string[], color: string): string[] {
  return [...tags.filter((tag) => !tag.startsWith("outerColor:")), `outerColor:${color}`];
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

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function cloneBody(body: BodyState): BodyState {
  return JSON.parse(JSON.stringify(body)) as BodyState;
}

function createPlayerState(player: MatchSetupPlayer, index: number): PlayerState {
    const state: PlayerState = {
    id: player.id,
    teamId: player.id,
    color: player.color ?? DEFAULT_PLAYER_COLORS[index % DEFAULT_PLAYER_COLORS.length]!,
    connected: player.connected ?? true,
    eliminated: false,
    isBot: player.isBot ?? false,
    turnOrderIndex: index
  };
  if (player.name) {
    return { ...state, name: player.name };
  }
  return state;
}
