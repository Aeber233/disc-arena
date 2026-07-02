import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  RoomAddBotPayload,
  RoomCreatePayload,
  RoomImportMapPayload,
  RoomJoinPayload,
  RoomKickPayload,
  RoomUpdateShrinkCirclePayload,
  ServerToClientEvents,
  ShotSubmitPayload
} from "@disc-arena/core";
import { DiscArenaRoom } from "./room";

type DiscServer = Server<ClientToServerEvents, ServerToClientEvents>;
type DiscSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const ROOM_CODE_PATTERN = /^\d{4}$/;

/**
 * Routes sockets to in-memory rooms and keeps Socket.IO room membership in sync.
 */
export class RoomManager {
  private readonly io: DiscServer;
  private readonly rooms = new Map<string, DiscArenaRoom>();
  private readonly socketToRoom = new Map<string, string>();

  constructor(io: DiscServer) {
    this.io = io;
  }

  handleCreate(socket: DiscSocket, payload: RoomCreatePayload): void {
    if (this.socketToRoom.has(socket.id)) {
      this.emitError(socket, "already_in_room", "Leave your current room first.");
      return;
    }

    const room = new DiscArenaRoom(this.createRoomCode());
    this.rooms.set(room.getRoomId(), room);
    const joined = room.join({
      socketId: socket.id,
      ...(payload.playerName ? { playerName: payload.playerName } : {})
    });
    if (!joined.ok) {
      this.emitError(socket, joined.error.reason, joined.error.message ?? "Could not create room.");
      return;
    }

    socket.join(room.getRoomId());
    this.socketToRoom.set(socket.id, room.getRoomId());
    socket.emit("room:joined", joined.payload);
    this.broadcast(room);
  }

  handleJoin(socket: DiscSocket, payload: RoomJoinPayload): void {
    if (this.socketToRoom.has(socket.id)) {
      this.emitError(socket, "already_in_room", "Leave your current room first.");
      return;
    }

    const roomId = payload.roomId.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(roomId)) {
      this.emitError(socket, "invalid_room_code", "Room code must be four digits.", roomId);
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.emitError(socket, "room_not_found", "Room not found.", roomId);
      return;
    }

    const joined = room.join({
      socketId: socket.id,
      ...(payload.playerName ? { playerName: payload.playerName } : {}),
      ...(payload.rejoinToken ? { rejoinToken: payload.rejoinToken } : {})
    });
    if (!joined.ok) {
      this.emitError(socket, joined.error.reason, joined.error.message ?? "Could not join room.", roomId);
      return;
    }

    socket.join(roomId);
    this.socketToRoom.set(socket.id, roomId);
    socket.emit("room:joined", joined.payload);
    this.broadcast(room);
  }

  handleLeave(socket: DiscSocket): void {
    const room = this.roomForSocket(socket);
    if (!room) {
      return;
    }

    const roomId = room.getRoomId();
    room.leave(socket.id);
    socket.leave(roomId);
    this.socketToRoom.delete(socket.id);
    this.broadcast(room);
    if (this.emitBotTurns(room)) {
      this.broadcast(room);
    }
    this.cleanup(room);
  }

  handleKick(socket: DiscSocket, payload: RoomKickPayload): void {
    const room = this.roomForSocket(socket);
    if (!room) {
      this.emitError(socket, "not_in_room", "You are not in a room.");
      return;
    }

    const targetSocketId = room.socketIdForPlayer(payload.playerId);
    const result = room.kick(socket.id, payload.playerId);
    if (!result.ok) {
      this.emitError(socket, result.error.reason, result.error.message ?? "Could not kick player.");
      return;
    }

    if (targetSocketId) {
      const targetSocket = this.io.sockets.sockets.get(targetSocketId);
      targetSocket?.leave(room.getRoomId());
      targetSocket?.emit("room:error", {
        reason: "kicked",
        message: "You were kicked from the room.",
        roomId: room.getRoomId()
      });
      this.socketToRoom.delete(targetSocketId);
    }

    this.broadcast(room);
    this.cleanup(room);
  }

  handleImportMap(socket: DiscSocket, payload: RoomImportMapPayload): void {
    const room = this.roomForSocket(socket);
    if (!room) {
      this.emitError(socket, "not_in_room", "You are not in a room.");
      return;
    }

    const result = room.importMap(socket.id, payload.encodedMap);
    if (!result.ok) {
      this.emitError(socket, result.error.reason, result.error.message ?? "Could not import map.");
      return;
    }
    this.broadcast(room);
  }

  handleAddBot(socket: DiscSocket, payload: RoomAddBotPayload): void {
    const room = this.roomForSocket(socket);
    if (!room) {
      this.emitError(socket, "not_in_room", "You are not in a room.");
      return;
    }

    const result = room.addBot(socket.id, payload.name);
    if (!result.ok) {
      this.emitError(socket, result.error.reason, result.error.message ?? "Could not add bot.");
      return;
    }
    this.broadcast(room);
  }

  handleUpdateShrinkCircle(socket: DiscSocket, payload: RoomUpdateShrinkCirclePayload): void {
    const room = this.roomForSocket(socket);
    if (!room) {
      this.emitError(socket, "not_in_room", "You are not in a room.");
      return;
    }

    const result = room.updateShrinkCircle(socket.id, payload);
    if (!result.ok) {
      this.emitError(
        socket,
        result.error.reason,
        result.error.message ?? "Could not update shrinking circle."
      );
      return;
    }
    this.broadcast(room);
  }

  handleStart(socket: DiscSocket): void {
    const room = this.roomForSocket(socket);
    if (!room) {
      this.emitError(socket, "not_in_room", "You are not in a room.");
      return;
    }

    const result = room.start(socket.id);
    if (!result.ok) {
      this.emitError(socket, result.error.reason, result.error.message ?? "Could not start room.");
      return;
    }
    this.broadcast(room);
    if (this.emitBotTurns(room)) {
      this.broadcast(room);
    }
  }

  handleReset(socket: DiscSocket): void {
    const room = this.roomForSocket(socket);
    if (!room) {
      this.emitError(socket, "not_in_room", "You are not in a room.");
      return;
    }

    const result = room.reset(socket.id);
    if (!result.ok) {
      this.emitError(socket, result.error.reason, result.error.message ?? "Could not reset room.");
      return;
    }
    this.broadcast(room);
  }

  handleSubmitShot(socket: DiscSocket, payload: ShotSubmitPayload): void {
    const room = this.roomForSocket(socket);
    if (!room) {
      socket.emit("shot:rejected", {
        shotId: payload.shotId,
        reason: "not_in_room",
        gameState: roomlessState(),
        stateHash: "00000000"
      });
      return;
    }

    const result = room.submitShot(socket.id, payload);
    if (!result.ok) {
      socket.emit("shot:rejected", result.rejected);
      return;
    }

    this.io.to(room.getRoomId()).emit("shot:started", result.started);
    this.io.to(room.getRoomId()).emit("shot:resolved", result.resolved);
    if (this.emitBotTurns(room)) {
      this.broadcast(room);
    }
  }

  handleDisconnect(socket: DiscSocket): void {
    const room = this.roomForSocket(socket);
    if (!room) {
      return;
    }

    room.disconnect(socket.id);
    this.socketToRoom.delete(socket.id);
    this.broadcast(room);
    if (this.emitBotTurns(room)) {
      this.broadcast(room);
    }
    this.cleanup(room);
  }

  private roomForSocket(socket: DiscSocket): DiscArenaRoom | undefined {
    const roomId = this.socketToRoom.get(socket.id);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  private broadcast(room: DiscArenaRoom): void {
    this.io.to(room.getRoomId()).emit("room:state", room.snapshot());
  }

  private emitBotTurns(room: DiscArenaRoom): boolean {
    const botShots = room.playBotTurns();
    for (const shot of botShots) {
      this.io.to(room.getRoomId()).emit("shot:started", shot.started);
      this.io.to(room.getRoomId()).emit("shot:resolved", shot.resolved);
    }
    return botShots.length > 0;
  }

  private cleanup(room: DiscArenaRoom): void {
    if (!room.isDisposable()) {
      return;
    }
    this.rooms.delete(room.getRoomId());
  }

  private createRoomCode(): string {
    for (let attempts = 0; attempts < 100; attempts += 1) {
      const code = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error("Could not allocate a room code.");
  }

  private emitError(
    socket: DiscSocket,
    reason: string,
    message: string,
    roomId: string | null = null
  ): void {
    socket.emit("room:error", { reason, message, roomId });
  }
}

function roomlessState() {
  return {
    gameId: "roomless",
    mapId: "none",
    turnIndex: 0,
    currentPlayerId: "",
    phase: "lobby" as const,
    players: [],
    bodies: [],
    effects: [],
    rngSeed: 0
  };
}
