import { add } from "../math/vec2";
import { isPointPlayableOnMap } from "../map/editableMap";
import type { BodyState } from "../types/body";
import type { MapData, TableBounds } from "../types/map";
import type { SimulationEvent } from "../types/simulation";

export interface OutOfBoundsOptions {
  readonly outsideAreaRatio: number;
  readonly durationSeconds: number;
  readonly samplesPerAxis: number;
}

export interface OutOfBoundsTracker {
  readonly timers: Record<string, number>;
}

export const DEFAULT_OUT_OF_BOUNDS_OPTIONS: OutOfBoundsOptions = {
  outsideAreaRatio: 0.8,
  durationSeconds: 0.4,
  samplesPerAxis: 9
};

export function createOutOfBoundsTracker(): OutOfBoundsTracker {
  return { timers: {} };
}

/**
 * Updates body elimination for balls that are mostly outside the playable table
 * for long enough. Mutates bodies because it is part of simulation settlement.
 */
export function updateOutOfBoundsBodies(
  bodies: BodyState[],
  mapData: MapData,
  tracker: OutOfBoundsTracker,
  fixedDt: number,
  step: number,
  options: OutOfBoundsOptions = DEFAULT_OUT_OF_BOUNDS_OPTIONS
): readonly SimulationEvent[] {
  if (!mapData.tableBounds && !mapData.terrain) {
    return [];
  }

  const events: SimulationEvent[] = [];
  for (const body of bodies) {
    if (!body.alive) {
      delete tracker.timers[body.id];
      continue;
    }

    const outsideRatio = outsidePlayableAreaRatio(body, mapData, options.samplesPerAxis);
    if (outsideRatio < options.outsideAreaRatio) {
      tracker.timers[body.id] = 0;
      continue;
    }

    const nextTime = (tracker.timers[body.id] ?? 0) + fixedDt;
    tracker.timers[body.id] = nextTime;
    if (nextTime > options.durationSeconds) {
      markOutOfBounds(body);
      delete tracker.timers[body.id];
      events.push({
        type: "body_out_of_bounds",
        step,
        bodyIds: [body.id],
        data: {
          outsideRatio,
          durationSeconds: nextTime
        }
      });
    }
  }

  return events;
}

export function outsidePlayableAreaRatio(
  body: BodyState,
  mapData: MapData,
  samplesPerAxis = DEFAULT_OUT_OF_BOUNDS_OPTIONS.samplesPerAxis
): number {
  if (!mapData.terrain && mapData.tableBounds) {
    return outsideTableAreaRatio(body, mapData.tableBounds, samplesPerAxis);
  }

  let inside = 0;
  let total = 0;
  const axisSamples = Math.max(3, samplesPerAxis);
  const step = (body.radius * 2) / (axisSamples - 1);

  for (let y = -body.radius; y <= body.radius + 0.0001; y += step) {
    for (let x = -body.radius; x <= body.radius + 0.0001; x += step) {
      if (x * x + y * y > body.radius * body.radius) {
        continue;
      }

      total += 1;
      const point = add(body.position, { x, y });
      if (isPointPlayableOnMap(mapData, point)) {
        inside += 1;
      }
    }
  }

  return total === 0 ? 0 : 1 - inside / total;
}

export function outsideTableAreaRatio(
  body: BodyState,
  bounds: TableBounds,
  samplesPerAxis = DEFAULT_OUT_OF_BOUNDS_OPTIONS.samplesPerAxis
): number {
  let inside = 0;
  let total = 0;
  const axisSamples = Math.max(3, samplesPerAxis);
  const step = (body.radius * 2) / (axisSamples - 1);

  for (let y = -body.radius; y <= body.radius + 0.0001; y += step) {
    for (let x = -body.radius; x <= body.radius + 0.0001; x += step) {
      if (x * x + y * y > body.radius * body.radius) {
        continue;
      }

      total += 1;
      const point = add(body.position, { x, y });
      if (
        point.x >= bounds.left &&
        point.x <= bounds.right &&
        point.y >= bounds.top &&
        point.y <= bounds.bottom
      ) {
        inside += 1;
      }
    }
  }

  return total === 0 ? 0 : 1 - inside / total;
}

function markOutOfBounds(body: BodyState): void {
  body.alive = false;
  body.sleep = true;
  body.velocity = { x: 0, y: 0 };
  body.spin = 0;
}
