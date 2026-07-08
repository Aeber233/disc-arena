import { createServer } from "node:http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents
} from "@disc-arena/core";
import { RoomManager } from "./roomManager";

const port = Number(process.env.PORT ?? 3000);
const clientOrigins = (process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173,http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const httpServer = createServer();

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: clientOrigins
  }
});
const roomManager = new RoomManager(io);

io.on("connection", (socket) => {
  socket.on("room:create", (payload) => {
    roomManager.handleCreate(socket, payload);
  });

  socket.on("room:join", (payload) => {
    roomManager.handleJoin(socket, payload);
  });

  socket.on("room:leave", () => {
    roomManager.handleLeave(socket);
  });

  socket.on("room:kick", (payload) => {
    roomManager.handleKick(socket, payload);
  });

  socket.on("room:import_map", (payload) => {
    roomManager.handleImportMap(socket, payload);
  });

  socket.on("room:select_official_map", (payload) => {
    roomManager.handleSelectOfficialMap(socket, payload);
  });

  socket.on("room:add_bot", (payload) => {
    roomManager.handleAddBot(socket, payload);
  });

  socket.on("room:update_shrink_circle", (payload) => {
    roomManager.handleUpdateShrinkCircle(socket, payload);
  });

  socket.on("room:start", () => {
    roomManager.handleStart(socket);
  });

  socket.on("bonus:resolve", (payload) => {
    roomManager.handleResolveBonus(socket, payload);
  });

  socket.on("bonus:teleport", (payload) => {
    roomManager.handleTeleportBonus(socket, payload);
  });

  socket.on("bonus:anchor", (payload) => {
    roomManager.handleAnchorBonus(socket, payload);
  });

  socket.on("room:reset", () => {
    roomManager.handleReset(socket);
  });

  socket.on("shot:submit", (payload) => {
    roomManager.handleSubmitShot(socket, payload);
  });

  socket.on("disconnect", () => {
    roomManager.handleDisconnect(socket);
  });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Disc Arena server listening on http://127.0.0.1:${port}`);
});
