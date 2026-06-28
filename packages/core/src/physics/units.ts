/**
 * Shared first-stage physics unit scale. Distances, radii, masses, and
 * velocity-like thresholds use larger internal units while rendering can still
 * map them back to the same on-screen size.
 */
export const PHYSICS_UNIT_SCALE = 1000;

/**
 * Shot power uses the same coarse scale as other player-facing physical
 * values. The velocity conversion applies PHYSICS_UNIT_SCALE internally so
 * power does not need to grow by mass scale * velocity scale.
 */
export const PHYSICS_POWER_SCALE = PHYSICS_UNIT_SCALE;
