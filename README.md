# Disc Arena

Disc Arena is a planned web turn-based 2D disc physics arena game.

This repository currently contains only the first-stage core architecture skeleton. It is not a complete game and does not include UI, Canvas rendering, Socket.IO networking, a server runtime, a map editor, precise portal collision clipping, or full gameplay rules.

## Current Scope

- `packages/core` is a pure TypeScript logic library.
- Core physics state stores body `position` and `velocity` as `Vec2`.
- `ShotIntent` uses `angle`, `power`, and `spinOffset`, then converts that intent into velocity and spin changes for simulation.
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
```

## Notes

The first physics pass intentionally keeps collision and trigger behavior small. The structure reserves extension points for portals, resources, bombs, gravity bombs, splitting, extra turns, map triggers, effect hooks, and richer bot scoring without committing to those mechanics yet.
