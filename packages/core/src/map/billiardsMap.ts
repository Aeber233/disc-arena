import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { EditableGroundCell, EditableMapDocument, EditableObstacleCell } from "./editableMap";
import { EDITABLE_MAP_VERSION, EDITOR_MAP_CELL_SIZE, editableMapToMapData } from "./editableMap";
import type { MapData } from "../types/map";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import { pixelBodyRadius, type PixelBodyRadiusTierId } from "./pixelBodySizes";

export const BILLIARDS_MAP_ID = "billiards_table";
export const BILLIARDS_MAP_WIDTH_CELLS = 48;
export const BILLIARDS_MAP_HEIGHT_CELLS = 28;
export const BILLIARDS_CELL_SIZE = EDITOR_MAP_CELL_SIZE;

const grassLeft = 3;
const grassRight = BILLIARDS_MAP_WIDTH_CELLS - 4;
const grassTop = 3;
const grassBottom = BILLIARDS_MAP_HEIGHT_CELLS - 4;
const pocketRadiusCells = 1.15;
const pocketVoidRadiusCells = 1.45;
const pocketWoodClearRadiusCells = 1.9;
const ballRadiusTier: PixelBodyRadiusTierId = "18px";
const ballRadius = pixelBodyRadius(ballRadiusTier);
const rackSpacing = ballRadius * 2.5;
const rackColumnSpacing = rackSpacing * 1.05;

const pockets = [
  { id: "corner-top-left", x: grassLeft, y: grassTop },
  { id: "side-top", x: BILLIARDS_MAP_WIDTH_CELLS / 2, y: grassTop - 0.5 },
  { id: "corner-top-right", x: grassRight, y: grassTop },
  { id: "corner-bottom-left", x: grassLeft, y: grassBottom },
  { id: "side-bottom", x: BILLIARDS_MAP_WIDTH_CELLS / 2, y: grassBottom + 0.5 },
  { id: "corner-bottom-right", x: grassRight, y: grassBottom }
] as const;

export const billiardsEditableMapDocument: EditableMapDocument =
  createBilliardsEditableMapDocument();

export const billiardsMapData: MapData = {
  ...editableMapToMapData(billiardsEditableMapDocument),
  triggers: pockets.map((pocket) => ({
    type: "hole",
    id: `pocket-${pocket.id}`,
    position: cellCenter(pocket.x, pocket.y),
    radius: pocketRadiusCells * BILLIARDS_CELL_SIZE
  }))
};

/**
 * Creates a pool-table-like editor document used as the default Play map.
 */
export function createBilliardsEditableMapDocument(): EditableMapDocument {
  const groundLayer: EditableGroundCell[] = Array.from(
    { length: BILLIARDS_MAP_WIDTH_CELLS * BILLIARDS_MAP_HEIGHT_CELLS },
    () => ({ material: "void" as const, shape: 0 as const })
  );
  const obstacleLayer: (EditableObstacleCell | null)[] = Array.from(
    { length: BILLIARDS_MAP_WIDTH_CELLS * BILLIARDS_MAP_HEIGHT_CELLS },
    () => null
  );

  for (let y = grassTop; y <= grassBottom; y += 1) {
    for (let x = grassLeft; x <= grassRight; x += 1) {
      if (!isNearPocket(x + 0.5, y + 0.5, pocketVoidRadiusCells)) {
        groundLayer[cellIndex(x, y)] = { material: "grass", shape: 0 };
      }
    }
  }

  for (let x = grassLeft - 1; x <= grassRight + 1; x += 1) {
    placeWoodIfRailCell(obstacleLayer, x, grassTop - 1);
    placeWoodIfRailCell(obstacleLayer, x, grassBottom + 1);
  }
  for (let y = grassTop; y <= grassBottom; y += 1) {
    placeWoodIfRailCell(obstacleLayer, grassLeft - 1, y);
    placeWoodIfRailCell(obstacleLayer, grassRight + 1, y);
  }

  return {
    version: EDITABLE_MAP_VERSION,
    id: BILLIARDS_MAP_ID,
    name: "Billiards Table",
    widthCells: BILLIARDS_MAP_WIDTH_CELLS,
    heightCells: BILLIARDS_MAP_HEIGHT_CELLS,
    cellSize: BILLIARDS_CELL_SIZE,
    groundLayer,
    portalLayer: [],
    obstacleLayer
  };
}

export function createBilliardsGameState(): GameState {
  return {
    gameId: "billiards-local",
    mapId: BILLIARDS_MAP_ID,
    turnIndex: 0,
    currentPlayerId: "player",
    phase: "waiting_for_shot",
    players: [{ id: "player", teamId: "white" }],
    bodies: createBilliardsBodies(),
    effects: [],
    rngSeed: 20260628
  };
}

function createBilliardsBodies(): BodyState[] {
  const bodies: BodyState[] = [
    createBall("ball-0", 0, "#f8f8f3", { x: 12.5, y: 14 })
  ];
  const rackStart = { x: 31.4, y: 14 };
  let number = 1;

  for (let column = 0; column < 4; column += 1) {
    const count = column + 1;
    const x = rackStart.x * BILLIARDS_CELL_SIZE + column * rackColumnSpacing;
    const startY = rackStart.y * BILLIARDS_CELL_SIZE - ((count - 1) * rackSpacing) / 2;

    for (let row = 0; row < count; row += 1) {
      bodies.push(
        createBall(`ball-${number}`, number, "#050505", {
          x,
          y: startY + row * rackSpacing
        })
      );
      number += 1;
    }
  }

  return bodies;
}

function createBall(
  id: string,
  number: number,
  outerColor: string,
  position: { readonly x: number; readonly y: number }
): BodyState {
  const worldPosition =
    position.x > BILLIARDS_MAP_WIDTH_CELLS
      ? position
      : {
          x: position.x * BILLIARDS_CELL_SIZE,
          y: position.y * BILLIARDS_CELL_SIZE
        };

  return {
    id,
    kind: "disc",
    ownerPlayerId: "player",
    teamId: "white",
    position: worldPosition,
    velocity: { x: 0, y: 0 },
    radius: ballRadius,
    mass: PHYSICS_UNIT_SCALE,
    damping: 1.18,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: true,
    tags: [`number:${number}`, `outerColor:${outerColor}`],
    modifiers: []
  };
}

function placeWoodIfRailCell(
  obstacleLayer: (EditableObstacleCell | null)[],
  x: number,
  y: number
): void {
  if (
    x < 0 ||
    y < 0 ||
    x >= BILLIARDS_MAP_WIDTH_CELLS ||
    y >= BILLIARDS_MAP_HEIGHT_CELLS ||
    isNearPocket(x + 0.5, y + 0.5, pocketWoodClearRadiusCells)
  ) {
    return;
  }
  obstacleLayer[cellIndex(x, y)] = { material: "wood", shape: 0 };
}

function isNearPocket(x: number, y: number, radiusCells: number): boolean {
  return pockets.some((pocket) => Math.hypot(x - pocket.x, y - pocket.y) <= radiusCells);
}

function cellCenter(x: number, y: number) {
  return {
    x: x * BILLIARDS_CELL_SIZE,
    y: y * BILLIARDS_CELL_SIZE
  };
}

function cellIndex(x: number, y: number): number {
  return y * BILLIARDS_MAP_WIDTH_CELLS + x;
}
