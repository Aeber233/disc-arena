import { describe, expect, it } from "vitest";
import {
  createOfficialMapSetup,
  OFFICIAL_MAP_SUMMARIES
} from "./officialMaps";

describe("official maps", () => {
  it("creates playable setup data for every official map", () => {
    for (const summary of OFFICIAL_MAP_SUMMARIES) {
      const setup = createOfficialMapSetup(summary.id);

      expect(setup.mapData.id).toBe(summary.id);
      expect(setup.gameState.mapId).toBe(summary.id);
      expect(setup.gameState.bodies.length).toBeGreaterThan(1);
      expect(setup.mapData.terrain?.cells.some((cell) => cell.material !== "void")).toBe(true);
    }
  });

  it("includes maps that exercise the newer material mechanics", () => {
    const airbag = createOfficialMapSetup("airbag_square");
    const portalCloud = createOfficialMapSetup("portal_cloud_square");
    const pinball = createOfficialMapSetup("elastic_pinball");

    expect(
      airbag.mapData.obstacles?.cells.some((cell) => cell?.material === "airbag")
    ).toBe(true);
    expect(portalCloud.mapData.portals).toHaveLength(1);
    expect(
      portalCloud.mapData.terrain?.cells.some((cell) => cell.material === "cloud")
    ).toBe(true);
    expect(
      pinball.mapData.colliders.some(
        (collider) => collider.material === "elastic_wall" && collider.restitution === 1.6
      )
    ).toBe(true);
    expect(
      pinball.mapData.colliders.some(
        (collider) => collider.material === "sticky_wall" && collider.restitution === 0.4
      )
    ).toBe(true);
  });

  it("rejects unknown official map ids", () => {
    expect(() => createOfficialMapSetup("unknown-map")).toThrow();
  });
});
