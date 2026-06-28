import type { Vec2 } from "../math/vec2";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import type {
  GroundMaterial,
  MapCellShape,
  MapData,
  MapObstacleData,
  MapTerrainData,
  ObstacleMaterial,
  StaticWallCollider
} from "../types/map";

export const EDITABLE_MAP_VERSION = 2;
export const EDITABLE_MAP_LEGACY_VERSION = 1;
export const EDITOR_MAP_DEFAULT_WIDTH_CELLS = 48;
export const EDITOR_MAP_DEFAULT_HEIGHT_CELLS = 28;
export const EDITOR_MAP_MAX_WIDTH_CELLS = 128;
export const EDITOR_MAP_MAX_HEIGHT_CELLS = 128;
export const EDITOR_MAP_CELL_SIZE = 40 * PHYSICS_UNIT_SCALE;
export const EDITABLE_MAP_ENCODED_PREFIX = "DAEM2";
export const EDITABLE_MAP_LEGACY_ENCODED_PREFIX = "DAEM1";
export const EDITABLE_PORTAL_MIN_LENGTH_CELLS = 3;
export const EDITABLE_PORTAL_WIDTH_CELLS = 1;

export type EditableLayer = "ground" | "obstacle";
export type EditableTool = "add" | "remove" | "shape";
export type EditableBrushSize = 1 | 2 | 4;
export type EditablePortalPairId = "portal1" | "portal2";
export type EditablePortalEndpointId = "a" | "b";

export interface EditableMapDocument {
  readonly version: typeof EDITABLE_MAP_VERSION;
  readonly id: string;
  readonly name: string;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellSize: number;
  readonly groundLayer: readonly EditableGroundCell[];
  readonly portalLayer: readonly EditablePortalPair[];
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

export interface EditablePortalEndpoint {
  readonly center: Vec2;
  readonly angle: number;
}

export interface EditablePortalPair {
  readonly id: EditablePortalPairId;
  readonly lengthCells: number;
  readonly a: EditablePortalEndpoint;
  readonly b: EditablePortalEndpoint;
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
const PORTAL_PAIR_IDS = new Set<EditablePortalPairId>(["portal1", "portal2"]);
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
    portalLayer: [],
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
    portalLayer: document.portalLayer.map((pair) =>
      clampEditablePortalPair(pair, nextWidth, nextHeight)
    ),
    obstacleLayer
  };
}

export function cloneEditableMapDocument(
  document: EditableMapDocument
): EditableMapDocument {
  return {
    ...document,
    groundLayer: document.groundLayer.map((cell) => ({ ...cell })),
    portalLayer: document.portalLayer.map(cloneEditablePortalPair),
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

  if (!Array.isArray(value.portalLayer) || value.portalLayer.length > 2) {
    errors.push("portalLayer must contain at most two portal pairs");
  } else {
    const ids = new Set<string>();
    value.portalLayer.forEach((pair, index) => {
      const pairErrors = validateEditablePortalPair(
        pair,
        value.widthCells,
        value.heightCells
      );
      if (isRecord(pair) && typeof pair.id === "string") {
        if (ids.has(pair.id)) {
          pairErrors.push(`portalLayer[${index}].id is duplicated`);
        }
        ids.add(pair.id);
      }
      errors.push(...pairErrors.map((error) => `portalLayer[${index}]: ${error}`));
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
    encodeRle(validated.obstacleLayer.map(encodeObstacleCell)),
    encodePortalLayer(validated.portalLayer)
  ].join("|");
}

export function decodeEditableMapDocument(encoded: string): EditableMapDocument {
  const parts = encoded.trim().split("|");
  if (parts[0] === EDITABLE_MAP_LEGACY_ENCODED_PREFIX) {
    return decodeLegacyEditableMapDocument(parts);
  }

  if (parts.length !== 9 || parts[0] !== EDITABLE_MAP_ENCODED_PREFIX) {
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
    portalLayer: decodePortalLayer(parts[8] ?? ""),
    obstacleLayer: obstacleTokens.map(decodeObstacleCell)
  };

  return parseEditableMapDocument(document);
}

function decodeLegacyEditableMapDocument(parts: readonly string[]): EditableMapDocument {
  if (parts.length !== 8) {
    throw new Error("Invalid legacy encoded map string");
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
    portalLayer: [],
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
    obstacles: editableObstaclesToObstacleData(document),
    colliders,
    triggers: [],
    portals: document.portalLayer.map((pair) => editablePortalPairToPortalPair(pair, document))
  };
}

export function toggleEditablePortalPair(
  document: EditableMapDocument,
  portalPairId: EditablePortalPairId
): EditableMapDocument {
  const existing = document.portalLayer.some((pair) => pair.id === portalPairId);
  if (existing) {
    return {
      ...cloneEditableMapDocument(document),
      portalLayer: document.portalLayer.filter((pair) => pair.id !== portalPairId)
    };
  }

  return setEditablePortalPair(
    document,
    createDefaultEditablePortalPair(portalPairId, document.widthCells, document.heightCells)
  );
}

export function setEditablePortalPair(
  document: EditableMapDocument,
  pair: EditablePortalPair
): EditableMapDocument {
  const next = cloneEditableMapDocument(document);
  const clamped = clampEditablePortalPair(pair, next.widthCells, next.heightCells);
  const withoutPair = next.portalLayer.filter((candidate) => candidate.id !== pair.id);
  return {
    ...next,
    portalLayer: [...withoutPair, clamped].sort(
      (a, b) => portalPairSortIndex(a.id) - portalPairSortIndex(b.id)
    )
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

export function editableObstaclesToObstacleData(
  document: EditableMapDocument
): MapObstacleData {
  return {
    origin: { x: 0, y: 0 },
    widthCells: document.widthCells,
    heightCells: document.heightCells,
    cellSize: document.cellSize,
    cells: document.obstacleLayer.map((cell) => (cell ? { ...cell } : null))
  };
}

export function createDefaultEditablePortalPair(
  portalPairId: EditablePortalPairId,
  widthCells: number,
  heightCells: number
): EditablePortalPair {
  const lengthCells = clampPortalLength(5, widthCells, heightCells);
  const centerX = widthCells / 2;
  const centerY = heightCells / 2;
  const horizontalOffset = Math.max(3, Math.min(8, widthCells * 0.18));
  const verticalOffset = Math.max(2, Math.min(6, heightCells * 0.16));

  if (portalPairId === "portal2") {
    return clampEditablePortalPair(
      {
        id: "portal2",
        lengthCells,
        a: {
          center: { x: centerX - horizontalOffset * 0.6, y: centerY - verticalOffset },
          angle: 0
        },
        b: {
          center: { x: centerX + horizontalOffset * 0.6, y: centerY + verticalOffset },
          angle: Math.PI / 2
        }
      },
      widthCells,
      heightCells
    );
  }

  return clampEditablePortalPair(
    {
      id: "portal1",
      lengthCells,
      a: {
        center: { x: centerX - horizontalOffset, y: centerY },
        angle: Math.PI / 2
      },
      b: {
        center: { x: centerX + horizontalOffset, y: centerY },
        angle: 0
      }
    },
    widthCells,
    heightCells
  );
}

export function clampEditablePortalPair(
  pair: EditablePortalPair,
  widthCells: number,
  heightCells: number
): EditablePortalPair {
  return {
    id: pair.id,
    lengthCells: clampPortalLength(pair.lengthCells, widthCells, heightCells),
    a: clampEditablePortalEndpoint(pair.a, widthCells, heightCells),
    b: clampEditablePortalEndpoint(pair.b, widthCells, heightCells)
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
  const edgeCounts = new Map<
    string,
    {
      readonly start: Vec2;
      readonly end: Vec2;
      readonly solidSideNormal: Vec2;
      count: number;
    }
  >();

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
        edgeCounts.set(key, { ...edge, solidSideNormal: edgeSolidSideNormal(edge), count: 1 });
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
      solidSideNormal: edge.solidSideNormal,
      restitution: 1
    }));
}

function editablePortalPairToPortalPair(
  pair: EditablePortalPair,
  document: EditableMapDocument
) {
  return {
    id: pair.id,
    a: editablePortalEndpointToPortal(`${pair.id}-a`, pair.a, pair, document),
    b: editablePortalEndpointToPortal(`${pair.id}-b`, pair.b, pair, document),
    enabled: true
  };
}

function editablePortalEndpointToPortal(
  id: string,
  endpoint: EditablePortalEndpoint,
  pair: EditablePortalPair,
  document: EditableMapDocument
) {
  return {
    id,
    position: {
      x: endpoint.center.x * document.cellSize,
      y: endpoint.center.y * document.cellSize
    },
    normal: portalNormalFromAngle(endpoint.angle),
    width: pair.lengthCells * document.cellSize
  };
}

function portalNormalFromAngle(angle: number): Vec2 {
  return {
    x: -Math.sin(angle),
    y: Math.cos(angle)
  };
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

function edgeSolidSideNormal(edge: { readonly start: Vec2; readonly end: Vec2 }): Vec2 {
  const dx = edge.end.x - edge.start.x;
  const dy = edge.end.y - edge.start.y;
  const normal = { x: -dy, y: dx };
  const normalLength = Math.hypot(normal.x, normal.y);
  return normalLength === 0
    ? { x: 0, y: 1 }
    : { x: normal.x / normalLength, y: normal.y / normalLength };
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

function cloneEditablePortalPair(pair: EditablePortalPair): EditablePortalPair {
  return {
    id: pair.id,
    lengthCells: pair.lengthCells,
    a: {
      center: { ...pair.a.center },
      angle: pair.a.angle
    },
    b: {
      center: { ...pair.b.center },
      angle: pair.b.angle
    }
  };
}

function clampEditablePortalEndpoint(
  endpoint: EditablePortalEndpoint,
  widthCells: number,
  heightCells: number
): EditablePortalEndpoint {
  return {
    center: {
      x: clampNumber(endpoint.center.x, 0, widthCells),
      y: clampNumber(endpoint.center.y, 0, heightCells)
    },
    angle: normalizeAngle(endpoint.angle)
  };
}

function clampPortalLength(
  lengthCells: number,
  widthCells: number,
  heightCells: number
): number {
  const maxLength = Math.max(
    EDITABLE_PORTAL_MIN_LENGTH_CELLS,
    Math.max(widthCells, heightCells)
  );
  return clampNumber(
    Math.round(lengthCells),
    EDITABLE_PORTAL_MIN_LENGTH_CELLS,
    maxLength
  );
}

function portalPairSortIndex(portalPairId: EditablePortalPairId): number {
  return portalPairId === "portal1" ? 0 : 1;
}

function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  let normalized = angle;
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  return normalized;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function encodePortalLayer(portalLayer: readonly EditablePortalPair[]): string {
  if (portalLayer.length === 0) {
    return "-";
  }
  return portalLayer.map(encodePortalPair).join(",");
}

function decodePortalLayer(encoded: string): EditablePortalPair[] {
  if (encoded === "" || encoded === "-") {
    return [];
  }
  return encoded.split(",").map(decodePortalPair);
}

function encodePortalPair(pair: EditablePortalPair): string {
  return [
    encodePortalPairId(pair.id),
    encodeScaledNumber(pair.lengthCells),
    encodeScaledNumber(pair.a.center.x),
    encodeScaledNumber(pair.a.center.y),
    encodeScaledNumber(pair.a.angle),
    encodeScaledNumber(pair.b.center.x),
    encodeScaledNumber(pair.b.center.y),
    encodeScaledNumber(pair.b.angle)
  ].join("~");
}

function decodePortalPair(encoded: string): EditablePortalPair {
  const parts = encoded.split("~");
  if (parts.length !== 8) {
    throw new Error(`Invalid portal pair token: ${encoded}`);
  }

  return {
    id: decodePortalPairId(parts[0] ?? ""),
    lengthCells: decodeScaledNumber(parts[1] ?? ""),
    a: {
      center: {
        x: decodeScaledNumber(parts[2] ?? ""),
        y: decodeScaledNumber(parts[3] ?? "")
      },
      angle: decodeScaledNumber(parts[4] ?? "")
    },
    b: {
      center: {
        x: decodeScaledNumber(parts[5] ?? ""),
        y: decodeScaledNumber(parts[6] ?? "")
      },
      angle: decodeScaledNumber(parts[7] ?? "")
    }
  };
}

function encodePortalPairId(portalPairId: EditablePortalPairId): string {
  return portalPairId === "portal1" ? "1" : "2";
}

function decodePortalPairId(value: string): EditablePortalPairId {
  if (value === "1") {
    return "portal1";
  }
  if (value === "2") {
    return "portal2";
  }
  throw new Error(`Invalid portal pair id: ${value}`);
}

function encodeScaledNumber(value: number): string {
  return encodeURIComponent(String(value));
}

function decodeScaledNumber(value: string): number {
  const parsed = Number(decodeURIComponent(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid portal number: ${value}`);
  }
  return parsed;
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

function validateEditablePortalPair(
  value: unknown,
  widthCells: unknown,
  heightCells: unknown
): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["pair must be an object"];
  }

  if (!PORTAL_PAIR_IDS.has(value.id as EditablePortalPairId)) {
    errors.push("id must be portal1 or portal2");
  }
  if (
    typeof value.lengthCells !== "number" ||
    !Number.isInteger(value.lengthCells) ||
    value.lengthCells < EDITABLE_PORTAL_MIN_LENGTH_CELLS
  ) {
    errors.push(`lengthCells must be at least ${EDITABLE_PORTAL_MIN_LENGTH_CELLS}`);
  }

  errors.push(
    ...validateEditablePortalEndpoint(value.a, "a", widthCells, heightCells),
    ...validateEditablePortalEndpoint(value.b, "b", widthCells, heightCells)
  );
  return errors;
}

function validateEditablePortalEndpoint(
  value: unknown,
  label: EditablePortalEndpointId,
  widthCells: unknown,
  heightCells: unknown
): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return [`${label} must be an object`];
  }

  if (!isRecord(value.center)) {
    errors.push(`${label}.center must be an object`);
  } else {
    if (
      typeof value.center.x !== "number" ||
      !Number.isFinite(value.center.x) ||
      typeof widthCells !== "number" ||
      value.center.x < 0 ||
      value.center.x > widthCells
    ) {
      errors.push(`${label}.center.x is out of bounds`);
    }
    if (
      typeof value.center.y !== "number" ||
      !Number.isFinite(value.center.y) ||
      typeof heightCells !== "number" ||
      value.center.y < 0 ||
      value.center.y > heightCells
    ) {
      errors.push(`${label}.center.y is out of bounds`);
    }
  }

  if (typeof value.angle !== "number" || !Number.isFinite(value.angle)) {
    errors.push(`${label}.angle must be finite`);
  }

  return errors;
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
