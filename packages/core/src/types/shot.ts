/**
 * Player or bot input for a single turn. Angle and power are input data only;
 * simulation converts them to velocity and spin changes.
 */
export interface ShotIntent {
  readonly actorBodyId: string;
  readonly angle: number;
  readonly power: number;
  readonly spinOffset: number;
  readonly itemId?: string;
}
