import { createServer } from "node:http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents
} from "@disc-arena/core";
import { PublicTestMapRoom } from "./room";

const port = Number(process.env.PORT ?? 3000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173";
const room = new PublicTestMapRoom();
const httpServer = createServer();

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: clientOrigin
  }
});

io.on("connection", (socket) => {
  const joined = room.join(socket.id);
  socket.emit("room:joined", joined);
  io.emit("room:state", room.snapshot());

  socket.on("shot:submit", (payload) => {
    const result = room.submitShot(socket.id, payload);
    if (!result.ok) {
      socket.emit("shot:rejected", result.rejected);
      return;
    }

    io.emit("shot:started", result.started);
    io.emit("shot:resolved", result.resolved);
  });

  socket.on("room:reset", () => {
    io.emit("room:state", room.reset());
  });

  socket.on("disconnect", () => {
    io.emit("room:state", room.leave(socket.id));
  });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Disc Arena server listening on http://127.0.0.1:${port}`);
});
