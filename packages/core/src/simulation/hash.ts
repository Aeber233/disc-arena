import type { GameState } from "../types/game";

/**
 * Small deterministic hash for simulation comparison. It is not cryptographic.
 */
export function hashGameState(state: GameState, quantize = false): string {
  const hashInput = quantize ? quantizeGameState(state) : state;
  return fnv1a(stableStringify(hashInput)).toString(16).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function quantizeGameState(state: GameState): GameState {
  return {
    ...state,
    bodies: state.bodies.map((body) => ({
      ...body,
      position: {
        x: round(body.position.x),
        y: round(body.position.y)
      },
      velocity: {
        x: round(body.velocity.x),
        y: round(body.velocity.y)
      },
      spin: round(body.spin)
    }))
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
