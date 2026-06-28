import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import { applyDamping } from "../physics/systems/damping";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import {
  createOutOfBoundsTracker,
  updateOutOfBoundsBodies
} from "../rules/outOfBounds";
import {
  applyEditableMapBrush,
  createDefaultEditableMapDocument,
  decodeEditableMapDocument,
  encodeEditableMapDocument,
  EDITOR_MAP_CELL_SIZE,
  EDITOR_MAP_MAX_WIDTH_CELLS,
  editableMapToMapData,
  parseEditableMapDocument,
  resizeEditableMapDocument,
  terrainDampingMultiplierAtPoint,
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

  it("encodes maps as a long string and decodes them without JSON", () => {
    const document = applyEditableMapBrush(createDefaultEditableMapDocument(), {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 8,
      cellY: 8,
      groundMaterial: "grass",
      obstacleMaterial: "wood"
    });

    const encoded = encodeEditableMapDocument(document);
    const decoded = decodeEditableMapDocument(encoded);

    expect(encoded.startsWith("DAEM1|")).toBe(true);
    expect(encoded).not.toContain("{");
    expect(encoded).not.toContain("[");
    expect(decoded).toEqual(document);
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

  it("converts full and triangular wood cells to static wall colliders", () => {
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

    expect(mapData.colliders.every((collider) => collider.type === "static_wall")).toBe(true);
    expect(mapData.colliders.length).toBe(baselineWallCount + 7);
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
