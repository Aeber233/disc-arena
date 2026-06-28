import type { Vec2 } from "../math/vec2";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import type {
  GroundMaterial,
  MapCellShape,
  MapData,
  MapTerrainData,
  ObstacleMaterial,
  StaticWallCollider
} from "../types/map";

export const EDITABLE_MAP_VERSION = 1;
export const EDITOR_MAP_DEFAULT_WIDTH_CELLS = 48;
export const EDITOR_MAP_DEFAULT_HEIGHT_CELLS = 28;
export const EDITOR_MAP_MAX_WIDTH_CELLS = 128;
export const EDITOR_MAP_MAX_HEIGHT_CELLS = 128;
export const EDITOR_MAP_CELL_SIZE = 40 * PHYSICS_UNIT_SCALE;
export const EDITABLE_MAP_ENCODED_PREFIX = "DAEM1";

export type EditableLayer = "ground" | "obstacle";
export type EditableTool = "add" | "remove" | "shape";
export type EditableBrushSize = 1 | 2 | 4;

export interface EditableMapDocument {
  readonly version: typeof EDITABLE_MAP_VERSION;
  readonly id: string;
  readonly name: string;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellSize: number;
  readonly groundLayer: readonly EditableGroundCell[];
  readonly obstacleLayer: readonly (EditableObstacleCell | null)[];
}

export interface EditableGroundCell {
  readonly material: GroundMaterial;
  readonly shape: MapCellShape;
}

export interface EditableObstacleCell {
  readonly material: ObstacleMaterial;
  readonly shape: MapCellShape;
}

export interface EditableBrushIntent {
  readonly layer: EditableLayer;
  readonly tool: EditableTool;
  readonly brushSize: EditableBrushSize;
  readonly cellX: number;
  readonly cellY: number;
  readonly groundMaterial: GroundMaterial;
  readonly obstacleMaterial: ObstacleMaterial;
}

export interface EditableMapValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export const GROUND_DAMPING_MULTIPLIERS: Record<GroundMaterial, number> = {
  void: 1,
  grass: 1,
  ice: 0.35,
  sand: 2.25
};

const GROUND_MATERIALS = new Set<GroundMaterial>(["void", "grass", "ice", "sand"]);
const OBSTACLE_MATERIALS = new Set<ObstacleMaterial>(["wood"]);
const CELL_SHAPES = new Set<MapCellShape>([0, 1, 2, 3, 4]);
const GROUND_TO_CODE: Record<GroundMaterial, string> = {
  void: "0",
  grass: "1",
  ice: "2",
  sand: "3"
};
const CODE_TO_GROUND: Record<string, GroundMaterial | undefined> = {
  "0": "void",
  "1": "grass",
  "2": "ice",
  "3": "sand"
};

/**
 * Creates the first editor sandbox: a large grid with a grass table area and
 * two simple wood side walls.
 */
export function createDefaultEditableMapDocument(): EditableMapDocument {
  const widthCells = EDITOR_MAP_DEFAULT_WIDTH_CELLS;
  const heightCells = EDITOR_MAP_DEFAULT_HEIGHT_CELLS;
  const groundLayer = createFilledGroundLayer(widthCells, heightCells, "void");
  const obstacleLayer = createEmptyObstacleLayer(widthCells, heightCells);
  const grassLeft = 4;
  const grassRight = widthCells - 5;
  const grassTop = 4;
  const grassBottom = heightCells - 5;

  for (let y = grassTop; y <= grassBottom; y += 1) {
    for (let x = grassLeft; x <= grassRight; x += 1) {
      groundLayer[cellIndex(x, y, widthCells)] = { material: "grass", shape: 0 };
    }
  }

  for (let y = grassTop + 1; y <= grassBottom - 1; y += 1) {
    obstacleLayer[cellIndex(grassLeft, y, widthCells)] = { material: "wood", shape: 0 };
    obstacleLayer[cellIndex(grassRight, y, widthCells)] = { material: "wood", shape: 0 };
  }

  return {
    version: EDITABLE_MAP_VERSION,
    id: "editable-test-map",
    name: "Editable Test Map",
    widthCells,
    heightCells,
    cellSize: EDITOR_MAP_CELL_SIZE,
    groundLayer,
    obstacleLayer
  };
}

export function resizeEditableMapDocument(
  document: EditableMapDocument,
  widthCells: number,
  heightCells: number
): EditableMapDocument {
  const nextWidth = clampDimension(widthCells, EDITOR_MAP_MAX_WIDTH_CELLS);
  const nextHeight = clampDimension(heightCells, EDITOR_MAP_MAX_HEIGHT_CELLS);
  const groundLayer = createFilledGroundLayer(nextWidth, nextHeight, "void");
  const obstacleLayer = createEmptyObstacleLayer(nextWidth, nextHeight);
  const copyWidth = Math.min(document.widthCells, nextWidth);
  const copyHeight = Math.min(document.heightCells, nextHeight);

  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      const fromIndex = cellIndex(x, y, document.widthCells);
      const toIndex = cellIndex(x, y, nextWidth);
      const ground = document.groundLayer[fromIndex];
      const obstacle = document.obstacleLayer[fromIndex];
      if (ground) {
        groundLayer[toIndex] = { ...ground };
      }
      obstacleLayer[toIndex] = obstacle ? { ...obstacle } : null;
    }
  }

  return {
    ...document,
    widthCells: nextWidth,
    heightCells: nextHeight,
    groundLayer,
    obstacleLayer
  };
}

export function cloneEditableMapDocument(
  document: EditableMapDocument
): EditableMapDocument {
  return {
    ...document,
    groundLayer: document.groundLayer.map((cell) => ({ ...cell })),
    obstacleLayer: document.obstacleLayer.map((cell) => (cell ? { ...cell } : null))
  };
}

export function validateEditableMapDocument(
  value: unknown
): EditableMapValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["document must be an object"] };
  }

  if (value.version !== EDITABLE_MAP_VERSION) {
    errors.push(`version must be ${EDITABLE_MAP_VERSION}`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    errors.push("id must be a non-empty string");
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    errors.push("name must be a non-empty string");
  }
  if (
    typeof value.widthCells !== "number" ||
    !Number.isInteger(value.widthCells) ||
    value.widthCells < 1 ||
    value.widthCells > EDITOR_MAP_MAX_WIDTH_CELLS
  ) {
    errors.push(`widthCells must be between 1 and ${EDITOR_MAP_MAX_WIDTH_CELLS}`);
  }
  if (
    typeof value.heightCells !== "number" ||
    !Number.isInteger(value.heightCells) ||
    value.heightCells < 1 ||
    value.heightCells > EDITOR_MAP_MAX_HEIGHT_CELLS
  ) {
    errors.push(`heightCells must be between 1 and ${EDITOR_MAP_MAX_HEIGHT_CELLS}`);
  }
  if (value.cellSize !== EDITOR_MAP_CELL_SIZE) {
    errors.push(`cellSize must be ${EDITOR_MAP_CELL_SIZE}`);
  }

  const expectedLength =
    typeof value.widthCells === "number" && typeof value.heightCells === "number"
      ? value.widthCells * value.heightCells
      : 0;
  if (!Array.isArray(value.groundLayer) || value.groundLayer.length !== expectedLength) {
    errors.push(`groundLayer must contain ${expectedLength} cells`);
  } else {
    value.groundLayer.forEach((cell, index) => {
      if (!isGroundCell(cell)) {
        errors.push(`groundLayer[${index}] is invalid`);
      }
    });
  }

  if (
    !Array.isArray(value.obstacleLayer) ||
    value.obstacleLayer.length !== expectedLength
  ) {
    errors.push(`obstacleLayer must contain ${expectedLength} cells`);
  } else {
    value.obstacleLayer.forEach((cell, index) => {
      if (cell !== null && !isObstacleCell(cell)) {
        errors.push(`obstacleLayer[${index}] is invalid`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

export function parseEditableMapDocument(value: unknown): EditableMapDocument {
  const validation = validateEditableMapDocument(value);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const document = value as EditableMapDocument;
  return cloneEditableMapDocument(document);
}

export function encodeEditableMapDocument(document: EditableMapDocument): string {
  const validated = parseEditableMapDocument(document);
  return [
    EDITABLE_MAP_ENCODED_PREFIX,
    encodeText(validated.id),
    encodeText(validated.name),
    toBase36(validated.widthCells),
    toBase36(validated.heightCells),
    toBase36(validated.cellSize),
    encodeRle(validated.groundLayer.map(encodeGroundCell)),
    encodeRle(validated.obstacleLayer.map(encodeObstacleCell))
  ].join("|");
}

export function decodeEditableMapDocument(encoded: string): EditableMapDocument {
  const parts = encoded.trim().split("|");
  if (parts.length !== 8 || parts[0] !== EDITABLE_MAP_ENCODED_PREFIX) {
    throw new Error("Invalid encoded map string");
  }

  const widthCells = fromBase36(parts[3] ?? "");
  const heightCells = fromBase36(parts[4] ?? "");
  const cellSize = fromBase36(parts[5] ?? "");
  const expectedLength = widthCells * heightCells;
  const groundTokens = decodeRle(parts[6] ?? "", expectedLength);
  const obstacleTokens = decodeRle(parts[7] ?? "", expectedLength);
  const document: EditableMapDocument = {
    version: EDITABLE_MAP_VERSION,
    id: decodeText(parts[1] ?? ""),
    name: decodeText(parts[2] ?? ""),
    widthCells,
    heightCells,
    cellSize,
    groundLayer: groundTokens.map(decodeGroundCell),
    obstacleLayer: obstacleTokens.map(decodeObstacleCell)
  };

  return parseEditableMapDocument(document);
}

export function applyEditableMapBrush(
  document: EditableMapDocument,
  intent: EditableBrushIntent
): EditableMapDocument {
  const next = cloneEditableMapDocument(document);
  const startX = clampCell(intent.cellX, next.widthCells);
  const startY = clampCell(intent.cellY, next.heightCells);

  for (let y = startY; y < Math.min(startY + intent.brushSize, next.heightCells); y += 1) {
    for (let x = startX; x < Math.min(startX + intent.brushSize, next.widthCells); x += 1) {
      applyBrushToCell(next, intent, x, y);
    }
  }

  return next;
}

export function editableMapToMapData(document: EditableMapDocument): MapData {
  const colliders = woodCellsToWallColliders(document);
  const right = document.widthCells * document.cellSize;
  const bottom = document.heightCells * document.cellSize;

  return {
    id: document.id,
    name: document.name,
    tableBounds: { left: 0, top: 0, right, bottom },
    terrain: editableGroundToTerrain(document),
    colliders,
    triggers: [],
    portals: []
  };
}

export function editableGroundToTerrain(
  document: EditableMapDocument
): MapTerrainData {
  return {
    origin: { x: 0, y: 0 },
    widthCells: document.widthCells,
    heightCells: document.heightCells,
    cellSize: document.cellSize,
    cells: document.groundLayer.map((cell) => ({ ...cell }))
  };
}

export function getGroundMaterialAtPoint(
  mapData: MapData,
  point: Vec2
): GroundMaterial {
  const terrain = mapData.terrain;
  if (!terrain) {
    return "grass";
  }

  const cell = terrainCellAtPoint(terrain, point);
  if (!cell || !isPointInsideCellShape(point, terrain, cell.x, cell.y, cell.shape)) {
    return "void";
  }

  return cell.material;
}

export function isPointPlayableOnMap(mapData: MapData, point: Vec2): boolean {
  if (mapData.tableBounds) {
    const bounds = mapData.tableBounds;
    if (
      point.x < bounds.left ||
      point.x > bounds.right ||
      point.y < bounds.top ||
      point.y > bounds.bottom
    ) {
      return false;
    }
  }

  return getGroundMaterialAtPoint(mapData, point) !== "void";
}

export function terrainDampingMultiplierAtPoint(
  mapData: MapData,
  point: Vec2
): number {
  return GROUND_DAMPING_MULTIPLIERS[getGroundMaterialAtPoint(mapData, point)];
}

export function nextCellShape(shape: MapCellShape): MapCellShape {
  return (((shape + 1) % 5) as MapCellShape);
}

function applyBrushToCell(
  document: EditableMapDocument,
  intent: EditableBrushIntent,
  x: number,
  y: number
): void {
  const index = cellIndex(x, y, document.widthCells);

  if (intent.layer === "ground") {
    if (intent.tool === "add") {
      groundCells(document)[index] = { material: intent.groundMaterial, shape: 0 };
      return;
    }
    if (intent.tool === "remove") {
      groundCells(document)[index] = { material: "void", shape: 0 };
      return;
    }
    const current = document.groundLayer[index];
    if (current && current.material !== "void") {
      groundCells(document)[index] = { ...current, shape: nextCellShape(current.shape) };
    }
    return;
  }

  if (intent.tool === "add") {
    obstacleCells(document)[index] = { material: intent.obstacleMaterial, shape: 0 };
    return;
  }
  if (intent.tool === "remove") {
    obstacleCells(document)[index] = null;
    return;
  }

  const current = document.obstacleLayer[index];
  if (current) {
    obstacleCells(document)[index] = { ...current, shape: nextCellShape(current.shape) };
  }
}

function woodCellsToWallColliders(
  document: EditableMapDocument
): StaticWallCollider[] {
  const edgeCounts = new Map<string, { readonly start: Vec2; readonly end: Vec2; count: number }>();

  document.obstacleLayer.forEach((cell, index) => {
    if (!cell || cell.material !== "wood") {
      return;
    }

    const x = index % document.widthCells;
    const y = Math.floor(index / document.widthCells);
    for (const edge of obstacleEdgesForCell(document, x, y, cell.shape)) {
      const key = normalizedEdgeKey(edge.start, edge.end);
      const existing = edgeCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edgeCounts.set(key, { ...edge, count: 1 });
      }
    }
  });

  return [...edgeCounts.values()]
    .filter((edge) => edge.count === 1)
    .map((edge, index) => ({
      type: "static_wall",
      id: `wood-wall-${index}`,
      start: edge.start,
      end: edge.end,
      restitution: 1
    }));
}

function obstacleEdgesForCell(
  document: EditableMapDocument,
  x: number,
  y: number,
  shape: MapCellShape
): readonly { readonly start: Vec2; readonly end: Vec2 }[] {
  const left = x * document.cellSize;
  const top = y * document.cellSize;
  const right = left + document.cellSize;
  const bottom = top + document.cellSize;
  const topLeft = { x: left, y: top };
  const topRight = { x: right, y: top };
  const bottomRight = { x: right, y: bottom };
  const bottomLeft = { x: left, y: bottom };

  if (shape === 1) {
    return edges([topLeft, topRight, bottomLeft]);
  }
  if (shape === 2) {
    return edges([topLeft, topRight, bottomRight]);
  }
  if (shape === 3) {
    return edges([topRight, bottomRight, bottomLeft]);
  }
  if (shape === 4) {
    return edges([topLeft, bottomRight, bottomLeft]);
  }

  return edges([topLeft, topRight, bottomRight, bottomLeft]);
}

function edges(points: readonly Vec2[]) {
  return points.map((point, index) => ({
    start: point,
    end: points[(index + 1) % points.length] ?? point
  }));
}

function normalizedEdgeKey(start: Vec2, end: Vec2): string {
  const a = `${start.x},${start.y}`;
  const b = `${end.x},${end.y}`;
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function terrainCellAtPoint(terrain: MapTerrainData, point: Vec2) {
  const localX = point.x - terrain.origin.x;
  const localY = point.y - terrain.origin.y;
  const x = Math.floor(localX / terrain.cellSize);
  const y = Math.floor(localY / terrain.cellSize);
  if (x < 0 || y < 0 || x >= terrain.widthCells || y >= terrain.heightCells) {
    return undefined;
  }

  const cell = terrain.cells[cellIndex(x, y, terrain.widthCells)];
  return cell ? { ...cell, x, y } : undefined;
}

export function isPointInsideCellShape(
  point: Vec2,
  terrain: Pick<MapTerrainData, "origin" | "cellSize">,
  cellX: number,
  cellY: number,
  shape: MapCellShape
): boolean {
  if (shape === 0) {
    return true;
  }

  const left = terrain.origin.x + cellX * terrain.cellSize;
  const top = terrain.origin.y + cellY * terrain.cellSize;
  const u = (point.x - left) / terrain.cellSize;
  const v = (point.y - top) / terrain.cellSize;

  if (shape === 1) {
    return u + v <= 1;
  }
  if (shape === 2) {
    return u >= v;
  }
  if (shape === 3) {
    return u + v >= 1;
  }
  return u <= v;
}

function createFilledGroundLayer(
  widthCells: number,
  heightCells: number,
  material: GroundMaterial
): EditableGroundCell[] {
  return Array.from({ length: widthCells * heightCells }, () => ({
    material,
    shape: 0
  }));
}

function createEmptyObstacleLayer(
  widthCells: number,
  heightCells: number
): (EditableObstacleCell | null)[] {
  return Array.from({ length: widthCells * heightCells }, () => null);
}

function cellIndex(x: number, y: number, widthCells: number): number {
  return y * widthCells + x;
}

function clampCell(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor(value)));
}

function clampDimension(value: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function encodeGroundCell(cell: EditableGroundCell): string {
  return `${GROUND_TO_CODE[cell.material]}${cell.shape}`;
}

function decodeGroundCell(token: string): EditableGroundCell {
  const material = CODE_TO_GROUND[token[0] ?? ""];
  const shape = decodeShape(token[1] ?? "");
  if (!material) {
    throw new Error(`Invalid ground token: ${token}`);
  }
  return { material, shape };
}

function encodeObstacleCell(cell: EditableObstacleCell | null): string {
  return cell ? `1${cell.shape}` : "00";
}

function decodeObstacleCell(token: string): EditableObstacleCell | null {
  if (token === "00") {
    return null;
  }
  if (token[0] !== "1") {
    throw new Error(`Invalid obstacle token: ${token}`);
  }
  return { material: "wood", shape: decodeShape(token[1] ?? "") };
}

function decodeShape(value: string): MapCellShape {
  const shape = Number(value);
  if (!CELL_SHAPES.has(shape as MapCellShape)) {
    throw new Error(`Invalid cell shape: ${value}`);
  }
  return shape as MapCellShape;
}

function encodeRle(tokens: readonly string[]): string {
  if (tokens.length === 0) {
    return "";
  }

  const runs: string[] = [];
  let current = tokens[0] ?? "";
  let count = 0;
  for (const token of tokens) {
    if (token === current) {
      count += 1;
      continue;
    }
    runs.push(`${toBase36(count)}.${current}`);
    current = token;
    count = 1;
  }
  runs.push(`${toBase36(count)}.${current}`);
  return runs.join(",");
}

function decodeRle(encoded: string, expectedLength: number): string[] {
  if (expectedLength === 0) {
    return [];
  }

  const tokens: string[] = [];
  for (const run of encoded.split(",")) {
    const [countText, token] = run.split(".");
    if (!countText || !token || token.length !== 2) {
      throw new Error(`Invalid layer run: ${run}`);
    }
    const count = fromBase36(countText);
    for (let i = 0; i < count; i += 1) {
      tokens.push(token);
    }
  }

  if (tokens.length !== expectedLength) {
    throw new Error(`Layer has ${tokens.length} cells, expected ${expectedLength}`);
  }
  return tokens;
}

function encodeText(value: string): string {
  return encodeURIComponent(value);
}

function decodeText(value: string): string {
  return decodeURIComponent(value);
}

function toBase36(value: number): string {
  return Math.floor(value).toString(36);
}

function fromBase36(value: string): number {
  const parsed = Number.parseInt(value, 36);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid base36 number: ${value}`);
  }
  return parsed;
}

function isGroundCell(value: unknown): value is EditableGroundCell {
  return (
    isRecord(value) &&
    GROUND_MATERIALS.has(value.material as GroundMaterial) &&
    CELL_SHAPES.has(value.shape as MapCellShape)
  );
}

function isObstacleCell(value: unknown): value is EditableObstacleCell {
  return (
    isRecord(value) &&
    OBSTACLE_MATERIALS.has(value.material as ObstacleMaterial) &&
    CELL_SHAPES.has(value.shape as MapCellShape)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function groundCells(document: EditableMapDocument): EditableGroundCell[] {
  return document.groundLayer as EditableGroundCell[];
}

function obstacleCells(document: EditableMapDocument): (EditableObstacleCell | null)[] {
  return document.obstacleLayer as (EditableObstacleCell | null)[];
}
