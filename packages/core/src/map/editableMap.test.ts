import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import type { EditableMapDocument } from "./editableMap";
import { applyDamping } from "../physics/systems/damping";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import {
  createOutOfBoundsTracker,
  updateOutOfBoundsBodies
} from "../rules/outOfBounds";
import {
  addEditableBallPlacement,
  applyEditableMapBrush,
  canPlaceEditableBall,
  createDefaultEditableMapDocument,
  decodeEditableMapDocument,
  EDITABLE_MAP_ENCODED_PREFIX,
  EDITABLE_MAP_LEGACY_ENCODED_PREFIX,
  EDITABLE_MAP_PREVIOUS_ENCODED_PREFIX,
  EDITABLE_MAP_V2_ENCODED_PREFIX,
  EDITABLE_PORTAL_MIN_LENGTH_CELLS,
  encodeEditableMapDocument,
  EDITOR_MAP_CELL_SIZE,
  EDITOR_MAP_MAX_WIDTH_CELLS,
  editableMapToMapData,
  parseEditableMapDocument,
  removeEditableBallPlacement,
  resizeEditableMapDocument,
  setEditablePortalPair,
  terrainDampingMultiplierAtPoint,
  toggleEditablePortalPair,
  validateEditableMapDocument
} from "./editableMap";

describe("editable map", () => {
  it("rejects invalid materials, shapes, and dimensions", () => {
    const valid = createDefaultEditableMapDocument();
    const oversized = {
      ...valid,
      widthCells: EDITOR_MAP_MAX_WIDTH_CELLS + 1
    };
    const invalidCells = {
      ...valid,
      groundLayer: [
        { material: "lava", shape: 0 },
        ...valid.groundLayer.slice(1)
      ],
      obstacleLayer: [
        { material: "wood", shape: 9 },
        ...valid.obstacleLayer.slice(1)
      ]
    };

    const oversizedResult = validateEditableMapDocument(oversized);
    const cellResult = validateEditableMapDocument(invalidCells);

    expect(oversizedResult.ok).toBe(false);
    expect(oversizedResult.errors.join(" ")).toContain("widthCells");
    expect(cellResult.ok).toBe(false);
    expect(cellResult.errors.join(" ")).toContain("groundLayer[0]");
    expect(cellResult.errors.join(" ")).toContain("obstacleLayer[0]");
    expect(() => parseEditableMapDocument(invalidCells)).toThrow();
  });

  it("resizes maps up to the 128x128 limit while preserving overlapping cells", () => {
    const painted = applyEditableMapBrush(createDefaultEditableMapDocument(), {
      layer: "ground",
      tool: "add",
      brushSize: 1,
      cellX: 6,
      cellY: 6,
      groundMaterial: "ice",
      obstacleMaterial: "wood"
    });

    const resized = resizeEditableMapDocument(painted, 999, 999);

    expect(resized.widthCells).toBe(128);
    expect(resized.heightCells).toBe(128);
    expect(resized.groundLayer[6 + 6 * resized.widthCells]).toEqual({
      material: "ice",
      shape: 0
    });
    expect(resized.groundLayer).toHaveLength(128 * 128);
    expect(resized.obstacleLayer).toHaveLength(128 * 128);
  });

  it("encodes DAEM4 maps as a compressed string and decodes portals and balls without JSON", () => {
    const painted = applyEditableMapBrush(createDefaultEditableMapDocument(), {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 8,
      cellY: 8,
      groundMaterial: "grass",
      obstacleMaterial: "wood"
    });
    const withPortal = toggleEditablePortalPair(painted, "portal1");
    const document = addEditableBallPlacement(withPortal, { x: 12.5, y: 12.5 }, "18px");
    expect(document).toBeDefined();

    const encoded = encodeEditableMapDocument(document!);
    const decoded = decodeEditableMapDocument(encoded);

    expect(encoded.startsWith(`${EDITABLE_MAP_ENCODED_PREFIX}|`)).toBe(true);
    expect(encoded).not.toContain("{");
    expect(encoded).not.toContain("[");
    expect(decoded).toEqual(document);
    expect(decoded.ballLayer).toHaveLength(1);
  });

  it("roundtrips cloud terrain and obstacle material variants", () => {
    let document = createDefaultEditableMapDocument();
    document = applyEditableMapBrush(document, {
      layer: "ground",
      tool: "add",
      brushSize: 1,
      cellX: 7,
      cellY: 7,
      groundMaterial: "cloud",
      obstacleMaterial: "wood"
    });
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 8,
      cellY: 7,
      groundMaterial: "grass",
      obstacleMaterial: "elastic_wall"
    });
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 9,
      cellY: 7,
      groundMaterial: "grass",
      obstacleMaterial: "sticky_wall"
    });
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 10,
      cellY: 7,
      groundMaterial: "grass",
      obstacleMaterial: "airbag"
    });

    const decoded = decodeEditableMapDocument(encodeEditableMapDocument(document));

    expect(decoded.groundLayer[7 + 7 * decoded.widthCells]).toEqual({
      material: "cloud",
      shape: 0
    });
    expect(decoded.obstacleLayer[8 + 7 * decoded.widthCells]?.material).toBe(
      "elastic_wall"
    );
    expect(decoded.obstacleLayer[9 + 7 * decoded.widthCells]?.material).toBe(
      "sticky_wall"
    );
    expect(decoded.obstacleLayer[10 + 7 * decoded.widthCells]?.material).toBe(
      "airbag"
    );
  });

  it("compresses noisy maps better than the previous RLE layer encoding", () => {
    let document = resizeEditableMapDocument(createDefaultEditableMapDocument(), 64, 64);
    for (let y = 0; y < document.heightCells; y += 1) {
      for (let x = 0; x < document.widthCells; x += 1) {
        if ((x + y) % 3 === 0) {
          document = applyEditableMapBrush(document, {
            layer: "ground",
            tool: "add",
            brushSize: 1,
            cellX: x,
            cellY: y,
            groundMaterial: "ice",
            obstacleMaterial: "wood"
          });
        }
      }
    }

    const compressed = encodeEditableMapDocument(document);
    const previous = encodeDaem3LikeDocument(document);

    expect(compressed.length).toBeLessThan(previous.length);
  });

  it("imports previous DAEM3 RLE strings", () => {
    const document = addEditableBallPlacement(
      toggleEditablePortalPair(createDefaultEditableMapDocument(), "portal1"),
      { x: 12.5, y: 12.5 },
      "18px"
    )!;
    const previous = encodeDaem3LikeDocument(document);

    const decoded = decodeEditableMapDocument(previous);

    expect(decoded.portalLayer).toHaveLength(1);
    expect(decoded.ballLayer).toHaveLength(1);
    expect(encodeEditableMapDocument(decoded).startsWith(`${EDITABLE_MAP_ENCODED_PREFIX}|`)).toBe(
      true
    );
  });

  it("imports DAEM2 strings with an empty ball layer", () => {
    const previous = encodeDaem2LikeDocument(toggleEditablePortalPair(createDefaultEditableMapDocument(), "portal1"));

    const decoded = decodeEditableMapDocument(previous);

    expect(decoded.portalLayer).toHaveLength(1);
    expect(decoded.ballLayer).toEqual([]);
    expect(encodeEditableMapDocument(decoded).startsWith(`${EDITABLE_MAP_ENCODED_PREFIX}|`)).toBe(
      true
    );
  });

  it("imports legacy DAEM1 strings with an empty portal layer", () => {
    const legacy = encodeDaem1LikeDocument(createDefaultEditableMapDocument());

    const decoded = decodeEditableMapDocument(legacy);

    expect(decoded.portalLayer).toEqual([]);
    expect(decoded.ballLayer).toEqual([]);
    expect(encodeEditableMapDocument(decoded).startsWith(`${EDITABLE_MAP_ENCODED_PREFIX}|`)).toBe(
      true
    );
  });

  it("rejects invalid portal ids, duplicates, lengths, centers, and angles", () => {
    const valid = toggleEditablePortalPair(createDefaultEditableMapDocument(), "portal1");
    const portal = valid.portalLayer[0]!;
    const invalidFields = {
      ...valid,
      portalLayer: [
        portal,
        {
          ...portal,
          lengthCells: EDITABLE_PORTAL_MIN_LENGTH_CELLS - 1,
          a: {
            center: { x: -1, y: 1 },
            angle: Number.POSITIVE_INFINITY
          }
        }
      ]
    };
    const invalidId = {
      ...valid,
      portalLayer: [{ ...portal, id: "portal3" }]
    };
    const tooMany = {
      ...valid,
      portalLayer: [portal, { ...portal, id: "portal2" }, portal]
    };

    const fieldsResult = validateEditableMapDocument(invalidFields);
    const idResult = validateEditableMapDocument(invalidId);
    const tooManyResult = validateEditableMapDocument(tooMany);

    expect(fieldsResult.ok).toBe(false);
    expect(fieldsResult.errors.join(" ")).toContain("portalLayer");
    expect(fieldsResult.errors.join(" ")).toContain("duplicated");
    expect(fieldsResult.errors.join(" ")).toContain("lengthCells");
    expect(fieldsResult.errors.join(" ")).toContain("center.x");
    expect(fieldsResult.errors.join(" ")).toContain("angle");
    expect(idResult.ok).toBe(false);
    expect(idResult.errors.join(" ")).toContain("id");
    expect(tooManyResult.ok).toBe(false);
    expect(tooManyResult.errors.join(" ")).toContain("at most two");
  });

  it("toggles portal pairs on and off", () => {
    const empty = createDefaultEditableMapDocument();
    const added = toggleEditablePortalPair(empty, "portal2");
    const removed = toggleEditablePortalPair(added, "portal2");

    expect(added.portalLayer).toHaveLength(1);
    expect(added.portalLayer[0]?.id).toBe("portal2");
    expect(removed.portalLayer).toHaveLength(0);
  });

  it("adds and removes balls only at playable empty positions", () => {
    const base = createDefaultEditableMapDocument();
    const voidPoint = { x: 1.5, y: 1.5 };
    const playablePoint = { x: 12.5, y: 12.5 };

    expect(canPlaceEditableBall(base, voidPoint, "18px")).toBe(false);
    expect(canPlaceEditableBall(base, playablePoint, "18px")).toBe(true);

    const withBall = addEditableBallPlacement(base, playablePoint, "18px");
    expect(withBall?.ballLayer).toHaveLength(1);
    expect(withBall?.ballLayer[0]?.center).toEqual(playablePoint);
    expect(withBall ? canPlaceEditableBall(withBall, playablePoint, "18px") : false).toBe(
      false
    );

    const blocked = applyEditableMapBrush(base, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 12,
      cellY: 12,
      groundMaterial: "grass",
      obstacleMaterial: "wood"
    });
    expect(canPlaceEditableBall(blocked, playablePoint, "18px")).toBe(false);

    const removed = removeEditableBallPlacement(withBall!, withBall!.ballLayer[0]!.id);
    expect(removed.ballLayer).toHaveLength(0);
  });

  it("clamps portals when resizing maps", () => {
    const document = toggleEditablePortalPair(createDefaultEditableMapDocument(), "portal1");
    const resized = resizeEditableMapDocument(document, 4, 4);
    const portal = resized.portalLayer[0]!;

    expect(portal.lengthCells).toBeGreaterThanOrEqual(EDITABLE_PORTAL_MIN_LENGTH_CELLS);
    expect(portal.lengthCells).toBeLessThanOrEqual(4);
    for (const endpoint of [portal.a, portal.b]) {
      expect(endpoint.center.x).toBeGreaterThanOrEqual(0);
      expect(endpoint.center.x).toBeLessThanOrEqual(4);
      expect(endpoint.center.y).toBeGreaterThanOrEqual(0);
      expect(endpoint.center.y).toBeLessThanOrEqual(4);
    }
  });

  it("converts editable portal pairs to MapData portals", () => {
    const document = setEditablePortalPair(createDefaultEditableMapDocument(), {
      id: "portal1",
      lengthCells: 3,
      a: {
        center: { x: 10, y: 12 },
        angle: 0
      },
      b: {
        center: { x: 20, y: 14 },
        angle: Math.PI / 2
      }
    });

    const mapData = editableMapToMapData(document);

    expect(mapData.portals).toHaveLength(1);
    expect(mapData.portals[0]?.id).toBe("portal1");
    expect(mapData.portals[0]?.a.width).toBe(3 * EDITOR_MAP_CELL_SIZE);
    expect(mapData.portals[0]?.a.position).toEqual({
      x: 10 * EDITOR_MAP_CELL_SIZE,
      y: 12 * EDITOR_MAP_CELL_SIZE
    });
    expect(mapData.portals[0]?.a.normal.x).toBeCloseTo(0);
    expect(mapData.portals[0]?.a.normal.y).toBeCloseTo(1);
    expect(mapData.portals[0]?.b.normal.x).toBeCloseTo(-1);
    expect(mapData.portals[0]?.b.normal.y).toBeCloseTo(0);
  });

  it("add overwrites triangular ground cells with full cells", () => {
    const shaped = applyEditableMapBrush(createDefaultEditableMapDocument(), {
      layer: "ground",
      tool: "shape",
      brushSize: 1,
      cellX: 5,
      cellY: 5,
      groundMaterial: "grass",
      obstacleMaterial: "wood"
    });

    const added = applyEditableMapBrush(shaped, {
      layer: "ground",
      tool: "add",
      brushSize: 1,
      cellX: 5,
      cellY: 5,
      groundMaterial: "sand",
      obstacleMaterial: "wood"
    });

    const cell = added.groundLayer[5 + 5 * added.widthCells];
    expect(cell).toEqual({ material: "sand", shape: 0 });
  });

  it("cycles shape values from square through four triangles", () => {
    let document = createDefaultEditableMapDocument();
    const shapes: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      document = applyEditableMapBrush(document, {
        layer: "ground",
        tool: "shape",
        brushSize: 1,
        cellX: 5,
        cellY: 5,
        groundMaterial: "grass",
        obstacleMaterial: "wood"
      });
      shapes.push(document.groundLayer[5 + 5 * document.widthCells]?.shape ?? -1);
    }

    expect(shapes).toEqual([1, 2, 3, 4, 0]);
  });

  it("converts full and triangular wood cells to obstacle geometry and boundary colliders", () => {
    let document = createDefaultEditableMapDocument();
    const baselineWallCount = editableMapToMapData(document).colliders.length;
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 10,
      cellY: 10,
      groundMaterial: "grass",
      obstacleMaterial: "wood"
    });
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 12,
      cellY: 10,
      groundMaterial: "grass",
      obstacleMaterial: "wood"
    });
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "shape",
      brushSize: 1,
      cellX: 12,
      cellY: 10,
      groundMaterial: "grass",
      obstacleMaterial: "wood"
    });

    const mapData = editableMapToMapData(document);
    const fullWoodIndex = 10 + 10 * document.widthCells;
    const triangleWoodIndex = 12 + 10 * document.widthCells;

    expect(mapData.obstacles?.widthCells).toBe(document.widthCells);
    expect(mapData.obstacles?.heightCells).toBe(document.heightCells);
    expect(mapData.obstacles?.cells[fullWoodIndex]).toEqual({
      material: "wood",
      shape: 0
    });
    expect(mapData.obstacles?.cells[triangleWoodIndex]).toEqual({
      material: "wood",
      shape: 1
    });
    expect(mapData.colliders.every((collider) => collider.type === "static_wall")).toBe(true);
    expect(mapData.colliders.length).toBe(baselineWallCount + 7);
    for (const collider of mapData.colliders) {
      expect(collider.solidSideNormal).toBeDefined();
      expect(
        Math.hypot(collider.solidSideNormal?.x ?? 0, collider.solidSideNormal?.y ?? 0)
      ).toBeCloseTo(1);
    }
  });

  it("assigns restitution values from obstacle materials", () => {
    let document = createDefaultEditableMapDocument();
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 14,
      cellY: 10,
      groundMaterial: "grass",
      obstacleMaterial: "elastic_wall"
    });
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 16,
      cellY: 10,
      groundMaterial: "grass",
      obstacleMaterial: "sticky_wall"
    });
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 18,
      cellY: 10,
      groundMaterial: "grass",
      obstacleMaterial: "airbag"
    });

    const colliders = editableMapToMapData(document).colliders;

    expect(colliders.some((collider) => collider.material === "elastic_wall" && collider.restitution === 1.6)).toBe(true);
    expect(colliders.some((collider) => collider.material === "sticky_wall" && collider.restitution === 0.4)).toBe(true);
    expect(colliders.some((collider) => collider.material === "airbag" && collider.restitution === 1)).toBe(true);
  });

  it("uses ground material to reduce or increase damping", () => {
    let document = createDefaultEditableMapDocument();
    document = applyEditableMapBrush(document, {
      layer: "ground",
      tool: "add",
      brushSize: 1,
      cellX: 8,
      cellY: 8,
      groundMaterial: "ice",
      obstacleMaterial: "wood"
    });
    document = applyEditableMapBrush(document, {
      layer: "ground",
      tool: "add",
      brushSize: 1,
      cellX: 9,
      cellY: 8,
      groundMaterial: "sand",
      obstacleMaterial: "wood"
    });
    const mapData = editableMapToMapData(document);
    const grass = makeBody(centerOf(7, 8));
    const ice = makeBody(centerOf(8, 8));
    const sand = makeBody(centerOf(9, 8));

    applyDamping(
      [grass, ice, sand],
      1 / 10,
      undefined,
      (body) => terrainDampingMultiplierAtPoint(mapData, body.position)
    );

    expect(ice.velocity.x).toBeGreaterThan(grass.velocity.x);
    expect(grass.velocity.x).toBeGreaterThan(sand.velocity.x);
  });

  it("treats void ground as out of bounds", () => {
    const mapData = editableMapToMapData(createDefaultEditableMapDocument());
    const body = makeBody(centerOf(0, 0));
    const tracker = createOutOfBoundsTracker();

    updateOutOfBoundsBodies([body], mapData, tracker, 0.2, 1);
    const events = updateOutOfBoundsBodies([body], mapData, tracker, 0.21, 2);

    expect(events[0]?.type).toBe("body_out_of_bounds");
    expect(body.alive).toBe(false);
  });
});

function centerOf(cellX: number, cellY: number) {
  return {
    x: (cellX + 0.5) * EDITOR_MAP_CELL_SIZE,
    y: (cellY + 0.5) * EDITOR_MAP_CELL_SIZE
  };
}

function makeBody(position: { readonly x: number; readonly y: number }): BodyState {
  return {
    id: `body-${position.x}-${position.y}`,
    kind: "disc",
    position,
    velocity: { x: 100 * PHYSICS_UNIT_SCALE, y: 0 },
    radius: 0.3 * EDITOR_MAP_CELL_SIZE,
    mass: PHYSICS_UNIT_SCALE,
    damping: 1,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: false,
    tags: [],
    modifiers: []
  };
}

function encodeDaem3LikeDocument(document: EditableMapDocument): string {
  return [
    EDITABLE_MAP_PREVIOUS_ENCODED_PREFIX,
    encodeTextForTest(document.id),
    encodeTextForTest(document.name),
    toBase36ForTest(document.widthCells),
    toBase36ForTest(document.heightCells),
    toBase36ForTest(document.cellSize),
    encodeRleForTest(document.groundLayer.map((cell) => `${groundCode(cell.material)}${cell.shape}`)),
    encodeRleForTest(document.obstacleLayer.map((cell) => (cell ? `1${cell.shape}` : "00"))),
    encodePortalLayerForTest(document),
    encodeBallLayerForTest(document)
  ].join("|");
}

function encodeDaem2LikeDocument(document: EditableMapDocument): string {
  return [
    EDITABLE_MAP_V2_ENCODED_PREFIX,
    encodeTextForTest(document.id),
    encodeTextForTest(document.name),
    toBase36ForTest(document.widthCells),
    toBase36ForTest(document.heightCells),
    toBase36ForTest(document.cellSize),
    encodeRleForTest(document.groundLayer.map((cell) => `${groundCode(cell.material)}${cell.shape}`)),
    encodeRleForTest(document.obstacleLayer.map((cell) => (cell ? `1${cell.shape}` : "00"))),
    encodePortalLayerForTest(document)
  ].join("|");
}

function encodeDaem1LikeDocument(document: EditableMapDocument): string {
  return [
    EDITABLE_MAP_LEGACY_ENCODED_PREFIX,
    encodeTextForTest(document.id),
    encodeTextForTest(document.name),
    toBase36ForTest(document.widthCells),
    toBase36ForTest(document.heightCells),
    toBase36ForTest(document.cellSize),
    encodeRleForTest(document.groundLayer.map((cell) => `${groundCode(cell.material)}${cell.shape}`)),
    encodeRleForTest(document.obstacleLayer.map((cell) => (cell ? `1${cell.shape}` : "00")))
  ].join("|");
}

function encodePortalLayerForTest(document: EditableMapDocument): string {
  if (document.portalLayer.length === 0) {
    return "-";
  }
  return document.portalLayer
    .map((pair) =>
      [
        pair.id === "portal1" ? "1" : "2",
        encodeTextForTest(String(pair.lengthCells)),
        encodeTextForTest(String(pair.a.center.x)),
        encodeTextForTest(String(pair.a.center.y)),
        encodeTextForTest(String(pair.a.angle)),
        encodeTextForTest(String(pair.b.center.x)),
        encodeTextForTest(String(pair.b.center.y)),
        encodeTextForTest(String(pair.b.angle))
      ].join("~")
    )
    .join(",");
}

function encodeBallLayerForTest(document: EditableMapDocument): string {
  if (document.ballLayer.length === 0) {
    return "-";
  }
  return document.ballLayer
    .map((ball) =>
      [
        encodeTextForTest(ball.id),
        encodeTextForTest(ball.radiusTierId),
        encodeTextForTest(String(ball.center.x)),
        encodeTextForTest(String(ball.center.y)),
        encodeTextForTest(String(ball.number)),
        encodeTextForTest(ball.outerColor ?? "")
      ].join("~")
    )
    .join(",");
}

function encodeRleForTest(tokens: readonly string[]): string {
  const runs: string[] = [];
  let current = tokens[0] ?? "";
  let count = 0;
  for (const token of tokens) {
    if (token === current) {
      count += 1;
      continue;
    }
    runs.push(`${toBase36ForTest(count)}.${current}`);
    current = token;
    count = 1;
  }
  runs.push(`${toBase36ForTest(count)}.${current}`);
  return runs.join(",");
}

function groundCode(material: EditableMapDocument["groundLayer"][number]["material"]): string {
  return { void: "0", grass: "1", ice: "2", sand: "3", cloud: "4" }[material];
}

function encodeTextForTest(value: string): string {
  return encodeURIComponent(value);
}

function toBase36ForTest(value: number): string {
  return Math.floor(value).toString(36);
}
