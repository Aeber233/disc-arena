import { describe, expect, it } from "vitest";
import { PublicTestMapRoom } from "./room";

describe("PublicTestMapRoom", () => {
  it("rejects shots from non-active players", () => {
    const room = new PublicTestMapRoom();
    room.join("socket-1");
    room.join("socket-2");

    const result = room.submitShot("socket-2", {
      shotId: "shot-1",
      turnIndex: 0,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: "ball-1",
        angle: 0,
        power: 100,
        spinOffset: 0
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected.reason).toBe("not_current_player");
    }
  });

  it("accepts active player shots and advances turn", () => {
    const room = new PublicTestMapRoom();
    const playerOne = room.join("socket-1");
    const playerTwo = room.join("socket-2");

    const result = room.submitShot("socket-1", {
      shotId: "shot-1",
      turnIndex: playerOne.gameState.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: "ball-1",
        angle: 0,
        power: 180,
        spinOffset: 0
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.started.initialStateHash).toBe(playerTwo.stateHash);
      expect(result.resolved.finalState.turnIndex).toBe(1);
      expect(result.resolved.finalState.currentPlayerId).toBe(playerTwo.playerId);
    }
  });

  it("returns low-bandwidth shot results without frames", () => {
    const room = new PublicTestMapRoom();
    room.join("socket-1");

    const result = room.submitShot("socket-1", {
      shotId: "shot-1",
      turnIndex: 0,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: "ball-1",
        angle: 0,
        power: 180,
        spinOffset: 0
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.finalState).toBeDefined();
      expect(result.resolved.events.length).toBeGreaterThan(0);
      expect(result.resolved.resultHash).toMatch(/^[0-9a-f]{8}$/);
      expect("frames" in result.resolved).toBe(false);
    }
  });

  it("advances current player when the active player disconnects while waiting", () => {
    const room = new PublicTestMapRoom();
    room.join("socket-1");
    const playerTwo = room.join("socket-2");

    const state = room.leave("socket-1");

    expect(state.gameState.currentPlayerId).toBe(playerTwo.playerId);
  });

  it("keeps turn order moving forward when the middle player disconnects", () => {
    const room = new PublicTestMapRoom();
    room.join("socket-1");
    const playerTwo = room.join("socket-2");
    const playerThree = room.join("socket-3");
    room.submitShot("socket-1", {
      shotId: "shot-1",
      turnIndex: 0,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: "ball-1",
        angle: 0,
        power: 180,
        spinOffset: 0
      }
    });

    expect(room.snapshot().gameState.currentPlayerId).toBe(playerTwo.playerId);
    const state = room.leave("socket-2");

    expect(state.gameState.currentPlayerId).toBe(playerThree.playerId);
  });
});
