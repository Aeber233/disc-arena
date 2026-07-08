import { describe, expect, it } from "vitest";
import {
  addEditableBallPlacement,
  billiardsEditableMapDocument,
  createDefaultEditableMapDocument,
  encodeEditableMapDocument,
  PICKUP_RADIUS,
  PHYSICS_POWER_SCALE
} from "@disc-arena/core";
import type { GameState } from "@disc-arena/core";
import { DiscArenaRoom } from "./room";

function createStartedRoom() {
  const room = new DiscArenaRoom("1234", 20260701);
  const playerOne = room.join({ socketId: "socket-1", playerName: "One" });
  const playerTwo = room.join({ socketId: "socket-2", playerName: "Two" });
  if (!playerOne.ok || !playerTwo.ok) {
    throw new Error("failed to join test room");
  }
  const started = room.start("socket-1");
  if (!started.ok) {
    throw new Error(`failed to start test room: ${started.error.reason}`);
  }
  return { room, playerOne: playerOne.payload, playerTwo: playerTwo.payload };
}

function mutableGameState(room: DiscArenaRoom): GameState {
  return (room as unknown as { gameState: GameState }).gameState;
}

function createBotTestMap(): string {
  let document = createDefaultEditableMapDocument();
  for (const center of [
    { x: 12, y: 12 },
    { x: 18, y: 12 },
    { x: 24, y: 12 }
  ]) {
    const next = addEditableBallPlacement(document, center, "10px");
    if (!next) {
      throw new Error("failed to place bot test ball");
    }
    document = next;
  }

  return encodeEditableMapDocument({
    ...document,
    id: "bot-test-map",
    name: "Bot Test Map"
  });
}

describe("DiscArenaRoom", () => {
  it("creates a lobby and joins members by room code", () => {
    const room = new DiscArenaRoom("1234", 1);
    const joined = room.join({ socketId: "socket-1", playerName: "Host" });

    expect(joined.ok).toBe(true);
    if (joined.ok) {
      expect(joined.payload.roomId).toBe("1234");
      expect(joined.payload.roomPhase).toBe("lobby");
      expect(joined.payload.playerId).toBe("player-1");
      expect(joined.payload.rejoinToken).toMatch(/^[0-9a-f]+$/);
      expect(joined.payload.players[0]?.isOwner).toBe(true);
    }
  });

  it("treats a connected lobby rejoin token as a new tab joining", () => {
    const room = new DiscArenaRoom("1234", 1);
    const firstTab = room.join({ socketId: "socket-1", playerName: "Host" });
    if (!firstTab.ok) {
      throw new Error("failed to join test room");
    }

    const secondTab = room.join({
      socketId: "socket-2",
      playerName: "Guest",
      rejoinToken: firstTab.payload.rejoinToken
    });

    expect(secondTab.ok).toBe(true);
    if (secondTab.ok) {
      expect(secondTab.payload.playerId).toBe("player-2");
      expect(secondTab.payload.players).toHaveLength(2);
    }
  });

  it("rejects starting with only one player", () => {
    const room = new DiscArenaRoom("1234", 1);
    room.join({ socketId: "socket-1" });

    const result = room.start("socket-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("not_enough_players");
    }
  });

  it("allows six members and rejects the seventh", () => {
    const room = new DiscArenaRoom("1234", 1);
    const joins = Array.from({ length: 6 }, (_, index) =>
      room.join({ socketId: `socket-${index + 1}` })
    );
    const full = room.join({ socketId: "socket-7" });

    expect(joins.every((join) => join.ok)).toBe(true);
    expect(full.ok).toBe(false);
    if (!full.ok) {
      expect(full.error.reason).toBe("room_full");
    }
  });

  it("rejects non-owner start and kick actions", () => {
    const room = new DiscArenaRoom("1234", 1);
    const host = room.join({ socketId: "socket-1" });
    const guest = room.join({ socketId: "socket-2" });
    if (!host.ok || !guest.ok) {
      throw new Error("failed to join test room");
    }

    const start = room.start("socket-2");
    const kick = room.kick("socket-2", host.payload.playerId);

    expect(start.ok).toBe(false);
    expect(kick.ok).toBe(false);
    if (!start.ok) expect(start.error.reason).toBe("not_room_owner");
    if (!kick.ok) expect(kick.error.reason).toBe("not_room_owner");
  });

  it("adds lobby bots as members and lets the owner kick them", () => {
    const room = new DiscArenaRoom("1234", 1);
    const host = room.join({ socketId: "socket-1" });
    if (!host.ok) {
      throw new Error("failed to join test room");
    }

    const added = room.addBot("socket-1");
    expect(added.ok).toBe(true);
    if (added.ok) {
      const bot = added.payload.players.find((player) => player.kind === "bot");
      expect(bot?.name).toBe("Bot 1");
      expect(bot?.connected).toBe(true);

      const kicked = room.kick("socket-1", bot!.playerId);
      expect(kicked.ok).toBe(true);
      if (kicked.ok) {
        expect(kicked.payload.players.some((player) => player.kind === "bot")).toBe(false);
      }
    }
  });

  it("rejects non-owner bot additions", () => {
    const room = new DiscArenaRoom("1234", 1);
    room.join({ socketId: "socket-1" });
    room.join({ socketId: "socket-2" });

    const added = room.addBot("socket-2");

    expect(added.ok).toBe(false);
    if (!added.ok) {
      expect(added.error.reason).toBe("not_room_owner");
    }
  });

  it("runs bot turns through the same shot intent pipeline as humans", () => {
    const room = new DiscArenaRoom("1234", 4, {
      simulationOptions: {
        mode: "authoritative",
        fixedDt: 1 / 20,
        maxSteps: 1,
        collisionIterations: 1,
        recordFrames: false,
        frameIntervalSteps: 1,
        quantize: true
      }
    });
    const host = room.join({ socketId: "socket-1" });
    if (!host.ok) {
      throw new Error("failed to join test room");
    }
    const bot = room.addBot("socket-1");
    if (!bot.ok) {
      throw new Error("failed to add bot");
    }
    const imported = room.importMap("socket-1", createBotTestMap());
    if (!imported.ok) {
      throw new Error("failed to import bot test map");
    }

    const started = room.start("socket-1");

    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.payload.players).toHaveLength(2);
      expect(started.payload.players.some((player) => player.kind === "bot")).toBe(true);
    }
    const botShots = room.playBotTurns();

    expect(botShots).toHaveLength(1);
    expect(botShots[0]?.started.playerId).toMatch(/^bot-/);
    expect(botShots[0]?.started.shotIntent).toEqual(botShots[0]?.resolved.shotIntent);
    expect(botShots[0]?.resolved.shotIntent.actorBodyId).toBeTruthy();
    expect(botShots[0]?.resolved.shotIntent.power).toBeGreaterThanOrEqual(0);
    expect(botShots[0]?.resolved.shotIntent.power).toBeLessThanOrEqual(1500 * PHYSICS_POWER_SCALE);
    expect(botShots[0]?.resolved.frames).toHaveLength(0);
    expect(room.snapshot().currentPlayerId).toBe(host.payload.playerId);
  });

  it("waits for a human bonus choice in a human versus bot room", () => {
    const room = new DiscArenaRoom("1234", 20260703);
    const host = room.join({ socketId: "socket-1", playerName: "Host" });
    if (!host.ok) {
      throw new Error("failed to join test room");
    }
    const bot = room.addBot("socket-1");
    if (!bot.ok) {
      throw new Error("failed to add bot");
    }
    const started = room.start("socket-1");
    if (!started.ok) {
      throw new Error(`failed to start test room: ${started.error.reason}`);
    }

    const state = mutableGameState(room);
    state.currentPlayerId = host.payload.playerId;
    state.phase = "waiting_for_shot";
    const ownedBody = state.bodies.find(
      (body) => body.ownerPlayerId === host.payload.playerId
    );
    if (!ownedBody) {
      throw new Error("host should own at least one body");
    }
    state.pickups = [
      {
        id: "human-bot-forced-pickup",
        position: { ...ownedBody.position },
        radius: PICKUP_RADIUS,
        spawnedTurnIndex: state.turnIndex
      }
    ];

    const shot = room.submitShot("socket-1", {
      shotId: "human-bot-pickup",
      turnIndex: state.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: ownedBody.id,
        angle: 0,
        power: 1,
        spinOffset: 0
      }
    });

    expect(shot.ok).toBe(true);
    if (!shot.ok) {
      throw new Error("pickup shot should be accepted");
    }
    expect(shot.resolved.finalState.phase).toBe("choosing_bonus");
    expect(shot.resolved.finalState.pendingBonusChoice?.playerId).toBe(host.payload.playerId);

    const staleChoice = room.resolveBonus("socket-1", { knownStateHash: "stale" });
    expect(staleChoice.ok).toBe(false);
    if (!staleChoice.ok) {
      expect(staleChoice.error.reason).toBe("state_hash_mismatch");
    }

    const botShots = room.playBotTurns();
    expect(botShots).toHaveLength(0);
    expect(room.snapshot().gameState.phase).toBe("choosing_bonus");

    const option = room
      .snapshot()
      .gameState.playerBonuses?.find((bonusState) => bonusState.playerId === host.payload.playerId)
      ?.options[0];
    if (!option) {
      throw new Error("host should have a bonus option");
    }

    const choice = room.resolveBonus("socket-1", {
      knownStateHash: room.stateHash(),
      optionId: option.id
    });

    expect(choice.ok).toBe(true);
    if (choice.ok) {
      expect(choice.payload.gameState.phase).toBe("waiting_for_shot");
      expect(
        choice.payload.gameState.playerBonuses?.find(
          (bonusState) => bonusState.playerId === host.payload.playerId
        )?.options
      ).toHaveLength(0);
    }
  });

  it("rejects adding bots after the match starts", () => {
    const { room } = createStartedRoom();

    const added = room.addBot("socket-1");

    expect(added.ok).toBe(false);
    if (!added.ok) {
      expect(added.error.reason).toBe("room_in_progress");
    }
  });

  it("counts eliminated players as skipped normal action slots for round progression", () => {
    const room = new DiscArenaRoom("1234", 20260707, {
      simulationOptions: {
        mode: "authoritative",
        fixedDt: 1 / 20,
        maxSteps: 1,
        collisionIterations: 1,
        recordFrames: false,
        frameIntervalSteps: 1,
        quantize: true
      }
    });
    const one = room.join({ socketId: "socket-1" });
    const two = room.join({ socketId: "socket-2" });
    const three = room.join({ socketId: "socket-3" });
    if (!one.ok || !two.ok || !three.ok) {
      throw new Error("failed to join three-player room");
    }
    const started = room.start("socket-1");
    if (!started.ok) {
      throw new Error(`failed to start: ${started.error.reason}`);
    }

    const state = mutableGameState(room);
    const orderedPlayers = [...state.players].sort(
      (a, b) => (a.turnOrderIndex ?? 0) - (b.turnOrderIndex ?? 0)
    );
    const currentPlayerId = orderedPlayers[0]!.id;
    const skippedPlayerId = orderedPlayers[1]!.id;
    const nextActivePlayerId = orderedPlayers[2]!.id;
    state.currentPlayerId = currentPlayerId;
    state.turnIndex = 0;
    state.roundSlotIndex = 0;
    state.roundIndex = 0;
    for (const body of state.bodies) {
      if (body.ownerPlayerId === skippedPlayerId) {
        body.alive = false;
        body.sleep = true;
      }
    }
    const actor = state.bodies.find(
      (body) => body.alive && body.ownerPlayerId === currentPlayerId
    );
    if (!actor) {
      throw new Error("current player needs an actor");
    }

    const result = room.submitShot(
      currentPlayerId === one.payload.playerId
        ? "socket-1"
        : currentPlayerId === two.payload.playerId
          ? "socket-2"
          : "socket-3",
      {
        shotId: "shot-skip-eliminated",
        turnIndex: state.turnIndex,
        knownStateHash: room.stateHash(),
        shotIntent: {
          actorBodyId: actor.id,
          angle: 0,
          power: 1,
          spinOffset: 0
        }
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("shot should be accepted");
    }
    expect(result.resolved.finalState.turnIndex).toBe(2);
    expect(result.resolved.finalState.roundSlotIndex).toBe(2);
    expect(result.resolved.finalState.roundIndex).toBe(0);
    expect(result.resolved.finalState.currentPlayerId).toBe(nextActivePlayerId);
  });

  it("lets the owner configure shrinking circle only in the lobby", () => {
    const room = new DiscArenaRoom("1234", 1);
    room.join({ socketId: "socket-1" });
    room.join({ socketId: "socket-2" });

    const nonOwner = room.updateShrinkCircle("socket-2", {
      enabled: true,
      collapseRounds: 3
    });
    const owner = room.updateShrinkCircle("socket-1", {
      enabled: true,
      collapseRounds: 3
    });
    const started = room.start("socket-1");
    const playing = room.updateShrinkCircle("socket-1", {
      enabled: false,
      collapseRounds: 2
    });

    expect(nonOwner.ok).toBe(false);
    if (!nonOwner.ok) expect(nonOwner.error.reason).toBe("not_room_owner");
    expect(owner.ok).toBe(true);
    if (owner.ok) {
      expect(owner.payload.shrinkCircle.enabled).toBe(true);
      expect(owner.payload.shrinkCircle.collapseRounds).toBe(3);
    }
    expect(started.ok).toBe(true);
    expect(playing.ok).toBe(false);
    if (!playing.ok) expect(playing.error.reason).toBe("room_in_progress");
  });

  it("eliminates balls that start and end their owner's action fully in poison", () => {
    const room = new DiscArenaRoom("1234", 4);
    const playerOne = room.join({ socketId: "socket-1" });
    const playerTwo = room.join({ socketId: "socket-2" });
    if (!playerOne.ok || !playerTwo.ok) {
      throw new Error("failed to join test room");
    }
    const shrink = room.updateShrinkCircle("socket-1", {
      enabled: true,
      collapseRounds: 1
    });
    if (!shrink.ok) {
      throw new Error(`failed to update shrink circle: ${shrink.error.reason}`);
    }
    const started = room.start("socket-1");
    if (!started.ok) {
      throw new Error(`failed to start test room: ${started.error.reason}`);
    }

    let shrinkEventFound = false;
    for (let attempt = 0; attempt < 6 && !shrinkEventFound; attempt += 1) {
      const snapshot = room.snapshot();
      if (snapshot.gameState.phase === "finished") {
        break;
      }
      const ownedBody = snapshot.gameState.bodies.find(
        (body) => body.ownerPlayerId === snapshot.currentPlayerId && body.alive
      );
      if (!ownedBody) {
        break;
      }
      const currentSocket =
        snapshot.currentPlayerId === playerOne.payload.playerId ? "socket-1" : "socket-2";
      const result = room.submitShot(currentSocket, {
        shotId: `shrink-shot-${attempt}`,
        turnIndex: snapshot.gameState.turnIndex,
        knownStateHash: room.stateHash(),
        shotIntent: {
          actorBodyId: ownedBody.id,
          angle: 0,
          power: PHYSICS_POWER_SCALE,
          spinOffset: 0
        }
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        shrinkEventFound = result.resolved.events.some(
          (event) =>
            event.type === "body_out_of_bounds" &&
            event.data?.reason === "shrink_circle"
        );
      }
    }

    expect(shrinkEventFound).toBe(true);
  });

  it("starts a match with even ownership and fewer-ball player first", () => {
    const room = new DiscArenaRoom("1234", 4);
    room.join({ socketId: "socket-1" });
    room.join({ socketId: "socket-2" });
    room.join({ socketId: "socket-3" });
    room.join({ socketId: "socket-4" });

    const result = room.start("socket-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const counts = result.payload.players.map((player) => player.ballCount);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      expect(result.payload.currentPlayerId).toBe(
        result.payload.players.reduce((best, player) =>
          player.ballCount < best.ballCount ? player : best
        ).playerId
      );
      expect(result.payload.gameState.bodies.every((body) => body.ownerPlayerId)).toBe(true);
    }
  });

  it("lets the owner import a valid lobby map", () => {
    const room = new DiscArenaRoom("1234", 1);
    room.join({ socketId: "socket-1" });
    const imported = room.importMap(
      "socket-1",
      encodeEditableMapDocument({
        ...billiardsEditableMapDocument,
        id: "imported-table",
        name: "Imported Table"
      })
    );

    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.payload.mapData.id).toBe("imported-table");
      expect(imported.payload.gameState.mapId).toBe("imported-table");
      expect(imported.payload.gameState.bodies).toHaveLength(
        billiardsEditableMapDocument.ballLayer.length
      );
    }
  });

  it("lets the owner select official maps in the lobby", () => {
    const room = new DiscArenaRoom("1234", 1);
    room.join({ socketId: "socket-1" });
    room.join({ socketId: "socket-2" });

    const selected = room.selectOfficialMap("socket-1", "airbag_square");

    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.payload.mapData.id).toBe("airbag_square");
      expect(selected.payload.gameState.mapId).toBe("airbag_square");
      expect(
        selected.payload.mapData.obstacles?.cells.some(
          (cell) => cell?.material === "airbag"
        )
      ).toBe(true);
    }
  });

  it("rejects non-owner, playing, and invalid official map selection", () => {
    const room = new DiscArenaRoom("1234", 1);
    room.join({ socketId: "socket-1" });
    room.join({ socketId: "socket-2" });

    const nonOwner = room.selectOfficialMap("socket-2", "airbag_square");
    const invalid = room.selectOfficialMap("socket-1", "missing-map");
    const started = room.start("socket-1");
    const playing = room.selectOfficialMap("socket-1", "portal_cloud_square");

    expect(nonOwner.ok).toBe(false);
    if (!nonOwner.ok) expect(nonOwner.error.reason).toBe("not_room_owner");
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.reason).toBe("invalid_map");
    expect(started.ok).toBe(true);
    expect(playing.ok).toBe(false);
    if (!playing.ok) expect(playing.error.reason).toBe("room_in_progress");
  });

  it("rejects non-owner, playing, invalid, and empty map imports", () => {
    const room = new DiscArenaRoom("1234", 1);
    room.join({ socketId: "socket-1" });
    room.join({ socketId: "socket-2" });

    const encoded = encodeEditableMapDocument(billiardsEditableMapDocument);
    const nonOwner = room.importMap("socket-2", encoded);
    const invalid = room.importMap("socket-1", "not-a-map");
    const empty = room.importMap("socket-1", encodeEditableMapDocument(createDefaultEditableMapDocument()));
    const started = room.start("socket-1");
    const playing = room.importMap("socket-1", encoded);

    expect(nonOwner.ok).toBe(false);
    if (!nonOwner.ok) expect(nonOwner.error.reason).toBe("not_room_owner");
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.reason).toBe("invalid_map");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.reason).toBe("map_has_no_balls");
    expect(started.ok).toBe(true);
    expect(playing.ok).toBe(false);
    if (!playing.ok) expect(playing.error.reason).toBe("room_in_progress");
  });

  it("starts and settles shots using an imported room map", () => {
    const room = new DiscArenaRoom("1234", 2);
    const playerOne = room.join({ socketId: "socket-1" });
    room.join({ socketId: "socket-2" });
    if (!playerOne.ok) {
      throw new Error("failed to join test room");
    }
    const imported = room.importMap(
      "socket-1",
      encodeEditableMapDocument({
        ...billiardsEditableMapDocument,
        id: "shot-imported-table",
        name: "Shot Imported Table"
      })
    );
    if (!imported.ok) {
      throw new Error(`failed to import test map: ${imported.error.reason}`);
    }
    const started = room.start("socket-1");
    if (!started.ok) {
      throw new Error(`failed to start test room: ${started.error.reason}`);
    }
    const snapshot = room.snapshot();
    const currentSocket = snapshot.currentPlayerId === playerOne.payload.playerId ? "socket-1" : "socket-2";
    const ownedBody = snapshot.gameState.bodies.find(
      (body) => body.ownerPlayerId === snapshot.currentPlayerId
    )!;

    const result = room.submitShot(currentSocket, {
      shotId: "shot-imported",
      turnIndex: snapshot.gameState.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: ownedBody.id,
        angle: 0,
        power: 1500 * PHYSICS_POWER_SCALE,
        spinOffset: 0
      }
    });

    expect(snapshot.mapData.id).toBe("shot-imported-table");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.finalState.mapId).toBe("shot-imported-table");
    }
  });

  it("rejects ordinary joins after the match starts but accepts rejoin tokens", () => {
    const { room, playerOne } = createStartedRoom();

    const ordinaryJoin = room.join({ socketId: "socket-3" });
    room.disconnect("socket-1");
    const rejoin = room.join({
      socketId: "socket-1b",
      rejoinToken: playerOne.rejoinToken
    });

    expect(ordinaryJoin.ok).toBe(false);
    if (!ordinaryJoin.ok) expect(ordinaryJoin.error.reason).toBe("room_in_progress");
    expect(rejoin.ok).toBe(true);
    if (rejoin.ok) expect(rejoin.payload.playerId).toBe(playerOne.playerId);
  });

  it("rejects rejoin tokens that target an online player after the match starts", () => {
    const { room, playerOne } = createStartedRoom();

    const result = room.join({
      socketId: "socket-3",
      rejoinToken: playerOne.rejoinToken
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("member_already_online");
    }
  });

  it("rejects shots from non-current players and from non-owned balls", () => {
    const { room, playerOne, playerTwo } = createStartedRoom();
    const snapshot = room.snapshot();
    const currentPlayerId = snapshot.currentPlayerId!;
    const nonCurrentSocket = currentPlayerId === playerOne.playerId ? "socket-2" : "socket-1";
    const currentSocket = currentPlayerId === playerOne.playerId ? "socket-1" : "socket-2";
    const nonOwnedBody = snapshot.gameState.bodies.find(
      (body) => body.ownerPlayerId !== currentPlayerId
    )!;

    const notCurrent = room.submitShot(nonCurrentSocket, {
      shotId: "shot-1",
      turnIndex: snapshot.gameState.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: snapshot.gameState.bodies.find(
          (body) => body.ownerPlayerId === playerTwo.playerId
        )!.id,
        angle: 0,
        power: 100,
        spinOffset: 0
      }
    });
    const notOwned = room.submitShot(currentSocket, {
      shotId: "shot-2",
      turnIndex: snapshot.gameState.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: nonOwnedBody.id,
        angle: 0,
        power: 100,
        spinOffset: 0
      }
    });

    expect(notCurrent.ok).toBe(false);
    if (!notCurrent.ok) expect(notCurrent.rejected.reason).toBe("not_current_player");
    expect(notOwned.ok).toBe(false);
    if (!notOwned.ok) expect(notOwned.rejected.reason).toBe("actor_not_owned");
  });

  it("accepts a legal shot, advances turn, and sends authoritative playback data", () => {
    const { room, playerOne } = createStartedRoom();
    const snapshot = room.snapshot();
    const currentSocket = snapshot.currentPlayerId === playerOne.playerId ? "socket-1" : "socket-2";
    const ownedBody = snapshot.gameState.bodies.find(
      (body) => body.ownerPlayerId === snapshot.currentPlayerId
    )!;

    const result = room.submitShot(currentSocket, {
      shotId: "shot-1",
      turnIndex: snapshot.gameState.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: ownedBody.id,
        angle: 0,
        power: 1500 * PHYSICS_POWER_SCALE,
        spinOffset: 0
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.initialStateHash).toBe(snapshot.stateHash);
      expect(result.resolved.initialState).toBeDefined();
      expect(result.resolved.frames?.length).toBeGreaterThan(0);
      expect(result.resolved.finalState.turnIndex).toBe(snapshot.gameState.turnIndex + 1);
      expect(result.resolved.finalState.currentPlayerId).not.toBe(snapshot.currentPlayerId);
      expect(result.resolved.events.length).toBeGreaterThan(0);
      expect(result.resolved.resultHash).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("rejects shots above the authoritative power cap", () => {
    const { room, playerOne } = createStartedRoom();
    const snapshot = room.snapshot();
    const currentSocket = snapshot.currentPlayerId === playerOne.playerId ? "socket-1" : "socket-2";
    const ownedBody = snapshot.gameState.bodies.find(
      (body) => body.ownerPlayerId === snapshot.currentPlayerId
    )!;

    const result = room.submitShot(currentSocket, {
      shotId: "shot-overpowered",
      turnIndex: snapshot.gameState.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: ownedBody.id,
        angle: 0,
        power: 1600 * PHYSICS_POWER_SCALE,
        spinOffset: 0
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected.reason).toBe("shot_power_too_high");
    }
  });

  it("enters bonus choice after collecting a pickup and keeps options on skip", () => {
    const { room, playerOne } = createStartedRoom();
    const state = mutableGameState(room);
    const currentPlayerId = state.currentPlayerId;
    const currentSocket = currentPlayerId === playerOne.playerId ? "socket-1" : "socket-2";
    const ownedBody = state.bodies.find((body) => body.ownerPlayerId === currentPlayerId)!;
    state.pickups = [
      {
        id: "forced-pickup",
        position: { ...ownedBody.position },
        radius: PICKUP_RADIUS,
        spawnedTurnIndex: state.turnIndex
      }
    ];

    const result = room.submitShot(currentSocket, {
      shotId: "shot-pickup",
      turnIndex: state.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: ownedBody.id,
        angle: 0,
        power: 1,
        spinOffset: 0
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("pickup shot should be accepted");
    }
    expect(result.resolved.finalState.phase).toBe("choosing_bonus");
    expect(result.resolved.finalState.currentPlayerId).toBe(currentPlayerId);
    expect(
      result.resolved.finalState.playerBonuses?.find((bonus) => bonus.playerId === currentPlayerId)
        ?.options
    ).toHaveLength(2);

    const rejected = room.submitShot(currentSocket, {
      shotId: "shot-before-choice",
      turnIndex: result.resolved.finalState.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: ownedBody.id,
        angle: 0,
        power: 1,
        spinOffset: 0
      }
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.rejected.reason).toBe("room_not_waiting_for_shot");
    }

    const kept = room.resolveBonus(currentSocket, { knownStateHash: room.stateHash() });
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.payload.gameState.phase).toBe("waiting_for_shot");
      expect(
        kept.payload.gameState.playerBonuses?.find((bonus) => bonus.playerId === currentPlayerId)
          ?.options
      ).toHaveLength(2);
    }
  });

  it("fires shuriken as a temporary projectile instead of moving the source ball back", () => {
    const { room, playerOne } = createStartedRoom();
    const state = mutableGameState(room);
    state.currentPlayerId = playerOne.playerId;
    state.phase = "waiting_for_shot";
    const ownedBody = state.bodies.find((body) => body.ownerPlayerId === playerOne.playerId)!;
    const originalPosition = { ...ownedBody.position };
    state.activeActionConstraint = {
      id: "test-shuriken",
      kind: "shuriken",
      ownerPlayerId: playerOne.playerId,
      createdTurnIndex: state.turnIndex,
      actorBodyId: ownedBody.id
    };

    const result = room.submitShot("socket-1", {
      shotId: "shot-shuriken",
      turnIndex: state.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: ownedBody.id,
        angle: 0,
        power: 900 * PHYSICS_POWER_SCALE,
        spinOffset: 0
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("shuriken shot should be accepted");
    }
    const spawned = result.resolved.events.find((event) => event.type === "body_spawned");
    expect(spawned?.data?.reason).toBe("shuriken");
    expect(result.resolved.events.some((event) => event.type === "body_destroyed")).toBe(true);
    const finalSource = result.resolved.finalState.bodies.find((body) => body.id === ownedBody.id);
    expect(finalSource?.position).toEqual(originalPosition);
    expect(
      result.resolved.finalState.bodies.some((body) => body.id === spawned?.data?.bodyId)
    ).toBe(false);
  });

  it("summons a persistent half-size ball with shuriken launch rules", () => {
    const { room, playerOne } = createStartedRoom();
    const state = mutableGameState(room);
    state.currentPlayerId = playerOne.playerId;
    state.phase = "waiting_for_shot";
    const ownedBody = state.bodies.find((body) => body.ownerPlayerId === playerOne.playerId)!;
    state.activeActionConstraint = {
      id: "test-summon",
      kind: "summon_half_ball",
      ownerPlayerId: playerOne.playerId,
      createdTurnIndex: state.turnIndex,
      actorBodyId: ownedBody.id
    };

    const result = room.submitShot("socket-1", {
      shotId: "shot-summon",
      turnIndex: state.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: ownedBody.id,
        angle: 0,
        power: 900 * PHYSICS_POWER_SCALE,
        spinOffset: 0
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("summon shot should be accepted");
    }
    const spawned = result.resolved.events.find((event) => event.type === "body_spawned");
    const spawnedBody = result.resolved.finalState.bodies.find(
      (body) => body.id === spawned?.data?.bodyId
    );
    expect(spawned?.data?.reason).toBe("summon_half_ball");
    expect(spawnedBody?.alive).toBe(true);
    expect(spawnedBody?.ownerPlayerId).toBe(playerOne.playerId);
    expect(spawnedBody?.radius ?? Number.POSITIVE_INFINITY).toBeLessThan(ownedBody.radius);
    expect(spawnedBody?.mass ?? Number.POSITIVE_INFINITY).toBeLessThan(ownedBody.mass);
  });

  it("resolves teleport and anchor target bonus actions", () => {
    const { room, playerOne, playerTwo } = createStartedRoom();
    const state = mutableGameState(room);
    state.currentPlayerId = playerOne.playerId;
    state.phase = "waiting_for_shot";
    const ownedBody = state.bodies.find((body) => body.ownerPlayerId === playerOne.playerId)!;
    state.activeActionConstraint = {
      id: "test-teleport",
      kind: "teleport",
      ownerPlayerId: playerOne.playerId,
      createdTurnIndex: state.turnIndex
    };

    const teleported = room.resolveTeleport("socket-1", {
      knownStateHash: room.stateHash(),
      bodyId: ownedBody.id,
      position: { ...ownedBody.position }
    });

    expect(teleported.ok).toBe(true);
    if (!teleported.ok) {
      throw new Error("teleport should resolve");
    }
    expect(teleported.payload.gameState.activeActionConstraint).toBeUndefined();

    const nextState = mutableGameState(room);
    nextState.currentPlayerId = playerOne.playerId;
    nextState.phase = "waiting_for_shot";
    const targetBody = nextState.bodies.find((body) => body.ownerPlayerId === playerTwo.playerId)!;
    nextState.activeActionConstraint = {
      id: "test-anchor",
      kind: "anchor",
      ownerPlayerId: playerOne.playerId,
      createdTurnIndex: nextState.turnIndex
    };

    const anchored = room.resolveAnchor("socket-1", {
      knownStateHash: room.stateHash(),
      bodyId: targetBody.id
    });

    expect(anchored.ok).toBe(true);
    if (anchored.ok) {
      const anchoredBody = anchored.payload.gameState.bodies.find(
        (body) => body.id === targetBody.id
      );
      expect(
        anchoredBody?.modifiers.some(
          (modifier) => modifier.kind === "anchor" && modifier.ownerId === playerOne.playerId
        )
      ).toBe(true);
    }
  });

  it("adds body snapshots to authoritative physical events", () => {
    const { room, playerOne } = createStartedRoom();
    const snapshot = room.snapshot();
    const currentSocket = snapshot.currentPlayerId === playerOne.playerId ? "socket-1" : "socket-2";
    const ownedBody = snapshot.gameState.bodies.find(
      (body) => body.ownerPlayerId === snapshot.currentPlayerId
    )!;

    const result = room.submitShot(currentSocket, {
      shotId: "shot-1",
      turnIndex: snapshot.gameState.turnIndex,
      knownStateHash: room.stateHash(),
      shotIntent: {
        actorBodyId: ownedBody.id,
        angle: 0,
        power: 1500 * PHYSICS_POWER_SCALE,
        spinOffset: 0
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const physicalEvent = result.resolved.events.find((event) =>
        ["collision", "wall_collision", "body_out_of_bounds"].includes(event.type)
      );
      expect(physicalEvent).toBeDefined();
      expect(physicalEvent?.bodySnapshots?.length).toBeGreaterThan(0);
    }
  });

  it("skips disconnected current players while keeping their balls alive", () => {
    const { room } = createStartedRoom();
    const before = room.snapshot();
    const currentSocket = before.currentPlayerId === "player-1" ? "socket-1" : "socket-2";
    const currentOwnedAlive = before.gameState.bodies.filter(
      (body) => body.ownerPlayerId === before.currentPlayerId && body.alive
    ).length;

    const after = room.disconnect(currentSocket);

    expect(after.currentPlayerId).not.toBe(before.currentPlayerId);
    expect(
      after.gameState.bodies.filter(
        (body) => body.ownerPlayerId === before.currentPlayerId && body.alive
      )
    ).toHaveLength(currentOwnedAlive);
  });
});
