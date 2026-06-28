# Disc Arena

Disc Arena is a planned web turn-based 2D disc physics arena game.

This repository currently contains the first-stage core architecture skeleton plus a minimal test map, Canvas test client, local map editor, and Socket.IO test server. It is not a complete game and does not include precise portal collision clipping, production matchmaking, or full gameplay rules.

## Current Scope

- `packages/core` is a pure TypeScript logic library.
- Core physics state stores body `position` and `velocity` as `Vec2`.
- The test map uses scaled physics units (`1000x`) for distances, radii, masses, and velocity-like thresholds while keeping the same approximate on-screen behavior.
- `ShotIntent.power` also uses the `1000x` player-facing scale; core converts it to velocity with mass inside the shot physics helper.
- `ShotIntent` uses `angle`, `power`, and `spinOffset`, then converts that intent into velocity and spin changes for simulation.
- The client includes a local first-pass grid map editor with encoded string import/export, draft saving, and maps up to `128x128` cells.
- The same core library is shaped for three future callers:
  - server authoritative settlement
  - client playback
  - bot fast evaluation

## Workspace Layout

```text
apps/
  client/   # reserved for a future Vite client
  server/   # reserved for a future Node + Socket.IO server
packages/
  core/     # shared pure game logic
```

## Commands

```bash
npm install
npm test
npm run typecheck
npm run build
npm run server:dev
npm run client:dev
```

## Network Config

Network settings are documented in `config/`:

- `config/network.local.env` keeps the current local test defaults.
- `config/network.production.env.example` is a production placeholder.

The server reads `PORT` and `CLIENT_ORIGIN`. The client reads `VITE_SOCKET_URL`.

## Notes

The first physics pass intentionally keeps collision and trigger behavior small. The structure reserves extension points for portals, resources, bombs, gravity bombs, splitting, extra turns, map triggers, effect hooks, and richer bot scoring without committing to those mechanics yet.
