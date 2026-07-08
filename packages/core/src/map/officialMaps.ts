import type { GameState } from "../types/game";
import type { GroundMaterial, MapData, ObstacleMaterial } from "../types/map";
import {
  billiardsEditableMapDocument,
  billiardsMapData,
  createBilliardsGameState
} from "./billiardsMap";
import {
  EDITABLE_MAP_VERSION,
  EDITOR_MAP_CELL_SIZE,
  editableBallPlacementsToBodies,
  editableMapToMapData,
  type EditableBallPlacement,
  type EditableGroundCell,
  type EditableMapDocument,
  type EditableObstacleCell,
  type EditablePortalPair
} from "./editableMap";
import type { PixelBodyRadiusTierId } from "./pixelBodySizes";

export type OfficialMapId =
  | "billiards_table"
  | "airbag_square"
  | "portal_cloud_square"
  | "elastic_pinball";

export interface OfficialMapSummary {
  readonly id: OfficialMapId;
  readonly name: string;
  readonly description: string;
}

export interface OfficialMapSetup {
  readonly summary: OfficialMapSummary;
  readonly editableMapDocument: EditableMapDocument;
  readonly mapData: MapData;
  readonly gameState: GameState;
}

export const OFFICIAL_MAP_SUMMARIES: readonly OfficialMapSummary[] = [
  {
    id: "billiards_table",
    name: "Billiards Table",
    description: "Classic table with pockets and a compact rack."
  },
  {
    id: "airbag_square",
    name: "Airbag Square",
    description: "A square arena fully wrapped by one-shot airbag walls."
  },
  {
    id: "portal_cloud_square",
    name: "Portal Cloud Square",
    description: "Opposite portals with fragile cloud holes inside the field."
  },
  {
    id: "elastic_pinball",
    name: "Elastic Pinball",
    description: "Elastic bumpers, sticky brakes, ice lanes, and sand traps."
  }
];

const ballRadiusTier: PixelBodyRadiusTierId = "16px";

/**
 * Creates a fresh official map setup. MapData can mutate during simulation, so
 * rooms should call this instead of sharing singleton map objects.
 */
export function createOfficialMapSetup(mapId: string): OfficialMapSetup {
  if (!isOfficialMapId(mapId)) {
    throw new Error(`Unknown official map: ${mapId}`);
  }

  if (mapId === "billiards_table") {
    return {
      summary: summaryFor(mapId),
      editableMapDocument: cloneEditableMapDocument(billiardsEditableMapDocument),
      mapData: cloneJson(billiardsMapData),
      gameState: cloneJson(createBilliardsGameState())
    };
  }

  const editableMapDocument = createOfficialEditableMapDocument(mapId);
  const mapData = editableMapToMapData(editableMapDocument);
  const gameState = createGameStateFromDocument(editableMapDocument);
  return {
    summary: summaryFor(mapId),
    editableMapDocument,
    mapData,
    gameState
  };
}

export function isOfficialMapId(value: string): value is OfficialMapId {
  return OFFICIAL_MAP_SUMMARIES.some((summary) => summary.id === value);
}

function createOfficialEditableMapDocument(mapId: Exclude<OfficialMapId, "billiards_table">) {
  if (mapId === "airbag_square") {
    return createAirbagSquareDocument();
  }
  if (mapId === "portal_cloud_square") {
    return createPortalCloudSquareDocument();
  }
  return createElasticPinballDocument();
}

function createAirbagSquareDocument(): EditableMapDocument {
  const builder = createBuilder("airbag_square", "Airbag Square", 40, 40);
  fillRect(builder, "ground", 5, 5, 34, 34, "grass");
  fillRect(builder, "ground", 12, 12, 27, 27, "ice");
  outlineRect(builder, 4, 4, 35, 35, "airbag");
  placeBallLine(builder, 0, 12, 20, 1.8, 0, 5, "#f8f8f3");
  placeBallLine(builder, 5, 27, 15.5, 0, 1.8, 5, "#050505");
  return finishBuilder(builder);
}

function createPortalCloudSquareDocument(): EditableMapDocument {
  const builder = createBuilder("portal_cloud_square", "Portal Cloud Square", 44, 32);
  fillRect(builder, "ground", 4, 4, 39, 27, "grass");
  fillRect(builder, "ground", 9, 9, 34, 22, "ice");
  outlineHorizontal(builder, 3, 3, 40, "wood");
  outlineHorizontal(builder, 28, 3, 40, "wood");
  outlineVertical(builder, 4, 4, 27, "wood");
  outlineVertical(builder, 39, 4, 27, "wood");
  cutPortalOpening(builder, 4, 11, 20);
  cutPortalOpening(builder, 39, 11, 20);
  paintCloudCircle(builder, 17, 12, 2.1);
  paintCloudCircle(builder, 27, 20, 2.4);
  paintCloudCircle(builder, 22, 16, 1.6);
  builder.portalLayer.push({
    id: "portal1",
    lengthCells: 10,
    a: {
      center: { x: 4.5, y: 16 },
      angle: -Math.PI / 2
    },
    b: {
      center: { x: 38.5, y: 16 },
      angle: Math.PI / 2
    }
  });
  placeBallTriangle(builder, 0, 12, 16, 1.55, "#f8f8f3", "#050505");
  return finishBuilder(builder);
}

function createElasticPinballDocument(): EditableMapDocument {
  const builder = createBuilder("elastic_pinball", "Elastic Pinball", 48, 30);
  fillRect(builder, "ground", 4, 4, 43, 25, "grass");
  fillRect(builder, "ground", 8, 8, 18, 21, "ice");
  fillRect(builder, "ground", 31, 8, 39, 21, "sand");
  outlineRect(builder, 3, 3, 44, 26, "wood");
  placeObstacleBlock(builder, 18, 9, 20, 11, "elastic_wall");
  placeObstacleBlock(builder, 27, 18, 29, 20, "elastic_wall");
  placeObstacleBlock(builder, 23, 6, 24, 8, "sticky_wall");
  placeObstacleBlock(builder, 23, 21, 24, 23, "sticky_wall");
  placeObstacleBlock(builder, 11, 14, 12, 15, "airbag");
  placeObstacleBlock(builder, 35, 14, 36, 15, "airbag");
  placeBallLine(builder, 0, 10, 15, 1.7, 0, 4, "#f8f8f3");
  placeBallLine(builder, 4, 37, 12, 0, 1.55, 4, "#050505");
  placeBallLine(builder, 8, 34, 19, 1.55, 0, 3, "#050505");
  return finishBuilder(builder);
}

interface MapBuilder {
  readonly id: OfficialMapId;
  readonly name: string;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly groundLayer: EditableGroundCell[];
  readonly obstacleLayer: (EditableObstacleCell | null)[];
  readonly portalLayer: EditablePortalPair[];
  readonly ballLayer: EditableBallPlacement[];
}

function createBuilder(
  id: Exclude<OfficialMapId, "billiards_table">,
  name: string,
  widthCells: number,
  heightCells: number
): MapBuilder {
  return {
    id,
    name,
    widthCells,
    heightCells,
    groundLayer: Array.from({ length: widthCells * heightCells }, () => ({
      material: "void" as const,
      shape: 0 as const
    })),
    obstacleLayer: Array.from({ length: widthCells * heightCells }, () => null),
    portalLayer: [],
    ballLayer: []
  };
}

function finishBuilder(builder: MapBuilder): EditableMapDocument {
  return {
    version: EDITABLE_MAP_VERSION,
    id: builder.id,
    name: builder.name,
    widthCells: builder.widthCells,
    heightCells: builder.heightCells,
    cellSize: EDITOR_MAP_CELL_SIZE,
    groundLayer: builder.groundLayer,
    portalLayer: builder.portalLayer,
    ballLayer: builder.ballLayer,
    obstacleLayer: builder.obstacleLayer
  };
}

function fillRect(
  builder: MapBuilder,
  layer: "ground",
  left: number,
  top: number,
  right: number,
  bottom: number,
  material: GroundMaterial
): void;
function fillRect(
  builder: MapBuilder,
  layer: "obstacle",
  left: number,
  top: number,
  right: number,
  bottom: number,
  material: ObstacleMaterial
): void;
function fillRect(
  builder: MapBuilder,
  layer: "ground" | "obstacle",
  left: number,
  top: number,
  right: number,
  bottom: number,
  material: GroundMaterial | ObstacleMaterial
): void {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (!inBounds(builder, x, y)) {
        continue;
      }
      const index = cellIndex(builder, x, y);
      if (layer === "ground") {
        builder.groundLayer[index] = { material: material as GroundMaterial, shape: 0 };
      } else {
        builder.obstacleLayer[index] = { material: material as ObstacleMaterial, shape: 0 };
      }
    }
  }
}

function outlineRect(
  builder: MapBuilder,
  left: number,
  top: number,
  right: number,
  bottom: number,
  material: ObstacleMaterial
): void {
  outlineHorizontal(builder, top, left, right, material);
  outlineHorizontal(builder, bottom, left, right, material);
  outlineVertical(builder, left, top + 1, bottom - 1, material);
  outlineVertical(builder, right, top + 1, bottom - 1, material);
}

function outlineHorizontal(
  builder: MapBuilder,
  y: number,
  left: number,
  right: number,
  material: ObstacleMaterial
): void {
  for (let x = left; x <= right; x += 1) {
    placeObstacleCell(builder, x, y, material);
  }
}

function outlineVertical(
  builder: MapBuilder,
  x: number,
  top: number,
  bottom: number,
  material: ObstacleMaterial
): void {
  for (let y = top; y <= bottom; y += 1) {
    placeObstacleCell(builder, x, y, material);
  }
}

function placeObstacleBlock(
  builder: MapBuilder,
  left: number,
  top: number,
  right: number,
  bottom: number,
  material: ObstacleMaterial
): void {
  fillRect(builder, "obstacle", left, top, right, bottom, material);
}

function placeObstacleCell(
  builder: MapBuilder,
  x: number,
  y: number,
  material: ObstacleMaterial
): void {
  if (inBounds(builder, x, y)) {
    builder.obstacleLayer[cellIndex(builder, x, y)] = { material, shape: 0 };
  }
}

function cutPortalOpening(builder: MapBuilder, x: number, top: number, bottom: number): void {
  for (let y = top; y <= bottom; y += 1) {
    if (inBounds(builder, x, y)) {
      builder.obstacleLayer[cellIndex(builder, x, y)] = null;
    }
  }
}

function paintCloudCircle(builder: MapBuilder, centerX: number, centerY: number, radius: number): void {
  const left = Math.floor(centerX - radius);
  const right = Math.ceil(centerX + radius);
  const top = Math.floor(centerY - radius);
  const bottom = Math.ceil(centerY + radius);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (!inBounds(builder, x, y)) {
        continue;
      }
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      if (distance <= radius) {
        builder.groundLayer[cellIndex(builder, x, y)] = { material: "cloud", shape: 0 };
      }
    }
  }
}

function placeBallLine(
  builder: MapBuilder,
  startNumber: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  count: number,
  outerColor: string
): void {
  for (let index = 0; index < count; index += 1) {
    const number = startNumber + index;
    builder.ballLayer.push(createBall(`ball-${number}`, number, outerColor, {
      x: x + dx * index,
      y: y + dy * index
    }));
  }
}

function placeBallTriangle(
  builder: MapBuilder,
  startNumber: number,
  x: number,
  y: number,
  spacing: number,
  firstColor: string,
  otherColor: string
): void {
  let number = startNumber;
  for (let column = 0; column < 4; column += 1) {
    const count = column + 1;
    const columnX = x + column * spacing;
    const startY = y - ((count - 1) * spacing) / 2;
    for (let row = 0; row < count; row += 1) {
      builder.ballLayer.push(
        createBall(`ball-${number}`, number, number === startNumber ? firstColor : otherColor, {
          x: columnX,
          y: startY + row * spacing
        })
      );
      number += 1;
    }
  }
}

function createBall(
  id: string,
  number: number,
  outerColor: string,
  center: { readonly x: number; readonly y: number }
): EditableBallPlacement {
  return {
    id,
    number,
    center,
    radiusTierId: ballRadiusTier,
    outerColor
  };
}

function createGameStateFromDocument(document: EditableMapDocument): GameState {
  return {
    gameId: `${document.id}-local`,
    mapId: document.id,
    turnIndex: 0,
    currentPlayerId: "player",
    phase: "waiting_for_shot",
    players: [{ id: "player", teamId: "white" }],
    bodies: editableBallPlacementsToBodies(document, {
      ownerPlayerId: "player",
      teamId: "white"
    }),
    effects: [],
    rngSeed: 20260702
  };
}

function inBounds(builder: Pick<MapBuilder, "widthCells" | "heightCells">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < builder.widthCells && y < builder.heightCells;
}

function cellIndex(builder: Pick<MapBuilder, "widthCells">, x: number, y: number): number {
  return y * builder.widthCells + x;
}

function summaryFor(mapId: OfficialMapId): OfficialMapSummary {
  const summary = OFFICIAL_MAP_SUMMARIES.find((candidate) => candidate.id === mapId);
  if (!summary) {
    throw new Error(`Missing official map summary: ${mapId}`);
  }
  return summary;
}

function cloneEditableMapDocument(document: EditableMapDocument): EditableMapDocument {
  return cloneJson(document);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
