import { describe, expect, it } from "vitest";
import { billiardsEditableMapDocument, createBilliardsGameState } from "../map/billiardsMap";
import { editableBallPlacementsToBodies } from "../map/editableMap";
import {
  DEFAULT_PLAYER_COLORS,
  countAliveOwnedBodies,
  isBodyOwnedByPlayer,
  setupMatchGameState,
  settleMatchState
} from "./matchRules";

const players = [
  { id: "player-1", name: "One", connected: true, color: DEFAULT_PLAYER_COLORS[0], joinIndex: 1 },
  { id: "player-2", name: "Two", connected: true, color: DEFAULT_PLAYER_COLORS[1], joinIndex: 2 },
  { id: "player-3", name: "Three", connected: true, color: DEFAULT_PLAYER_COLORS[2], joinIndex: 3 },
  { id: "player-4", name: "Four", connected: true, color: DEFAULT_PLAYER_COLORS[3], joinIndex: 4 }
];

describe("match rules", () => {
  it("provides colors for six room members", () => {
    expect(DEFAULT_PLAYER_COLORS).toHaveLength(6);
  });

  it("assigns editor document bodies across two to six players", () => {
    const baseState = {
      ...createBilliardsGameState(),
      bodies: editableBallPlacementsToBodies(billiardsEditableMapDocument)
    };

    for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
      const setupPlayers = Array.from({ length: playerCount }, (_, index) => ({
        id: `player-${index + 1}`,
        connected: true,
        color: DEFAULT_PLAYER_COLORS[index]!,
        joinIndex: index + 1
      }));
      const setup = setupMatchGameState(baseState, setupPlayers, 20260702);
      const counts = Object.values(setup.ballCounts);

      expect(setup.gameState.bodies.every((body) => body.ownerPlayerId)).toBe(true);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });

  it("assigns map balls deterministically and as evenly as possible", () => {
    const first = setupMatchGameState(createBilliardsGameState(), players, 1234);
    const second = setupMatchGameState(createBilliardsGameState(), players, 1234);
    const counts = Object.values(first.ballCounts);

    expect(first.gameState.bodies.map((body) => body.ownerPlayerId)).toEqual(
      second.gameState.bodies.map((body) => body.ownerPlayerId)
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(first.gameState.bodies[0]?.tags).toContain(
      `outerColor:${first.gameState.players.find(
        (player) => player.id === first.gameState.bodies[0]?.ownerPlayerId
      )?.color}`
    );
  });

  it("orders fewer-ball players first, then by join order", () => {
    const setup = setupMatchGameState(createBilliardsGameState(), players, 99);
    const orderedCounts = setup.turnOrder.map((playerId) => setup.ballCounts[playerId]);

    expect(orderedCounts).toEqual([...orderedCounts].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(setup.gameState.currentPlayerId).toBe(setup.turnOrder[0]);
  });

  it("checks body ownership for shot validation", () => {
    const setup = setupMatchGameState(createBilliardsGameState(), players.slice(0, 2), 55);
    const ownedBody = setup.gameState.bodies.find(
      (body) => body.ownerPlayerId === setup.gameState.currentPlayerId
    );
    const otherBody = setup.gameState.bodies.find(
      (body) => body.ownerPlayerId !== setup.gameState.currentPlayerId
    );

    expect(isBodyOwnedByPlayer(ownedBody, setup.gameState.currentPlayerId)).toBe(true);
    expect(isBodyOwnedByPlayer(otherBody, setup.gameState.currentPlayerId)).toBe(false);
  });

  it("eliminates players with no balls and finishes with one remaining owner", () => {
    const setup = setupMatchGameState(createBilliardsGameState(), players.slice(0, 2), 77);
    const survivorId = setup.gameState.players[0]!.id;

    for (const body of setup.gameState.bodies) {
      if (body.ownerPlayerId !== survivorId) {
        body.alive = false;
      }
    }

    const result = settleMatchState(
      setup.gameState,
      setup.turnOrder,
      survivorId,
      new Set(players.map((player) => player.id))
    );
    const counts = countAliveOwnedBodies(result.gameState);

    expect(counts[survivorId]).toBeGreaterThan(0);
    expect(result.gameState.phase).toBe("finished");
    expect(result.winnerPlayerId).toBe(survivorId);
    expect(result.eliminatedPlayerIds).toEqual([
      setup.gameState.players.find((player) => player.id !== survivorId)?.id
    ]);
  });
});
