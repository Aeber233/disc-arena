import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import type { SimulationEvent } from "../types/simulation";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import {
  applyEditableMapBrush,
  createDefaultEditableMapDocument,
  editableMapToMapData,
  EDITOR_MAP_CELL_SIZE
} from "./editableMap";
import { dissipateCloudTerrain, popAirbagsFromCollisions } from "./dynamicMaterials";

describe("dynamic map materials", () => {
  it("dissipates cloud terrain under a swept body path", () => {
    let document = createDefaultEditableMapDocument();
    document = applyEditableMapBrush(document, {
      layer: "ground",
      tool: "add",
      brushSize: 1,
      cellX: 12,
      cellY: 12,
      groundMaterial: "cloud",
      obstacleMaterial: "wood"
    });
    const mapData = editableMapToMapData(document);
    const body = makeBody("body-cloud", centerOf(12, 12));

    const events = dissipateCloudTerrain(
      mapData,
      [body],
      new Map([[body.id, { ...body.position }]]),
      4
    );

    expect(mapData.terrain?.cells[12 + 12 * document.widthCells]).toEqual({
      material: "void",
      shape: 0
    });
    expect(events[0]?.type).toBe("terrain_changed");
    expect(events[0]?.data?.reason).toBe("cloud_dissipated");
  });

  it("removes hit airbag obstacle cells and rebuilds colliders", () => {
    let document = createDefaultEditableMapDocument();
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 12,
      cellY: 12,
      groundMaterial: "grass",
      obstacleMaterial: "airbag"
    });
    const mapData = editableMapToMapData(document);
    const body = makeBody("body-airbag", centerOf(12, 12));
    const collision: SimulationEvent = {
      type: "wall_collision",
      step: 3,
      bodyIds: [body.id],
      data: {
        material: "airbag",
        collisionPoint: centerOf(12, 12)
      }
    };

    const events = popAirbagsFromCollisions(mapData, [body], [collision], 3);

    expect(mapData.obstacles?.cells[12 + 12 * document.widthCells]).toBeNull();
    expect(mapData.colliders.some((collider) => collider.material === "airbag")).toBe(
      false
    );
    expect(events[0]?.type).toBe("obstacle_changed");
    expect(events[0]?.data?.reason).toBe("airbag_popped");
    expect(events[0]?.step).toBe(collision.step);
  });

  it("pops airbag cells even when the collision is on a cell corner", () => {
    let document = createDefaultEditableMapDocument();
    document = applyEditableMapBrush(document, {
      layer: "obstacle",
      tool: "add",
      brushSize: 1,
      cellX: 12,
      cellY: 12,
      groundMaterial: "grass",
      obstacleMaterial: "airbag"
    });
    const mapData = editableMapToMapData(document);
    const body = makeBody("body-airbag-corner", {
      x: 12 * EDITOR_MAP_CELL_SIZE,
      y: 12 * EDITOR_MAP_CELL_SIZE
    });
    const collision: SimulationEvent = {
      type: "wall_collision",
      step: 5,
      bodyIds: [body.id],
      data: {
        material: "airbag",
        collisionPoint: {
          x: 12 * EDITOR_MAP_CELL_SIZE,
          y: 12 * EDITOR_MAP_CELL_SIZE
        }
      }
    };

    const events = popAirbagsFromCollisions(mapData, [body], [collision], collision.step);

    expect(mapData.obstacles?.cells[12 + 12 * document.widthCells]).toBeNull();
    expect(events[0]?.type).toBe("obstacle_changed");
  });
});

function centerOf(cellX: number, cellY: number) {
  return {
    x: (cellX + 0.5) * EDITOR_MAP_CELL_SIZE,
    y: (cellY + 0.5) * EDITOR_MAP_CELL_SIZE
  };
}

function makeBody(id: string, position: BodyState["position"]): BodyState {
  return {
    id,
    kind: "disc",
    position,
    velocity: { x: 0, y: 0 },
    radius: 0.45 * EDITOR_MAP_CELL_SIZE,
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
