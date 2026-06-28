import { PHYSICS_UNIT_SCALE } from "../physics/units";

export type PixelBodyRadiusTierId = `${number}px`;

export interface PixelBodyRadiusTier {
  readonly id: PixelBodyRadiusTierId;
  readonly pixelRadius: number;
  readonly radius: number;
}

export const PIXEL_BODY_UNIT = PHYSICS_UNIT_SCALE;
export const PIXEL_BODY_MIN_RADIUS_PX = 4;
export const PIXEL_BODY_MAX_RADIUS_PX = 64;

export const PIXEL_BODY_RADIUS_TIERS: readonly PixelBodyRadiusTier[] = Array.from(
  { length: PIXEL_BODY_MAX_RADIUS_PX - PIXEL_BODY_MIN_RADIUS_PX + 1 },
  (_, index) => {
    const pixelRadius = PIXEL_BODY_MIN_RADIUS_PX + index;
    return {
      id: `${pixelRadius}px` as PixelBodyRadiusTierId,
      pixelRadius,
      radius: (pixelRadius + 0.5) * PIXEL_BODY_UNIT
    };
  }
);

const PIXEL_BODY_RADIUS_TIER_BY_ID = new Map(
  PIXEL_BODY_RADIUS_TIERS.map((tier) => [tier.id, tier])
);

/**
 * Radius tiers tie gameplay radii to fixed integer pixel-circle templates.
 */
export function pixelBodyRadius(tierId: PixelBodyRadiusTierId): number {
  return pixelBodyRadiusTier(tierId).radius;
}

export function pixelBodyRadiusTier(tierId: PixelBodyRadiusTierId): PixelBodyRadiusTier {
  const tier = PIXEL_BODY_RADIUS_TIER_BY_ID.get(tierId);
  if (!tier) {
    throw new Error(`Unknown pixel body radius tier: ${tierId}`);
  }
  return tier;
}

export function nearestPixelBodyRadiusTier(radius: number): PixelBodyRadiusTier {
  return PIXEL_BODY_RADIUS_TIERS.reduce((best, candidate) =>
    Math.abs(candidate.radius - radius) < Math.abs(best.radius - radius)
      ? candidate
      : best
  );
}
