import { angleOf, sub } from "../math/vec2";
import type { BodyState } from "../types/body";
import type { GameState } from "../types/game";
import type { ShotIntent } from "../types/shot";
import type { BotOptions } from "./botOptions";

/**
 * Creates a bounded set of simple shot candidates for first-stage bot search.
 */
export function generateCandidates(
  gameState: GameState,
  actorBodyId: string,
  options: BotOptions
): readonly ShotIntent[] {
  const actor = gameState.bodies.find((body) => body.id === actorBodyId);
  if (!actor) {
    return [];
  }

  const candidates: ShotIntent[] = [];
  const targetAngles = getEnemyTargetAngles(gameState.bodies, actor);
  const random = createRandom(options.rngSeed + gameState.turnIndex);

  for (const angle of targetAngles) {
    addCandidateSet(candidates, actorBodyId, angle, options);
    if (candidates.length >= options.maxCandidates) {
      return candidates.slice(0, options.maxCandidates);
    }
  }

  while (candidates.length < options.maxCandidates) {
    const angle = random() * Math.PI * 2;
    addCandidateSet(candidates, actorBodyId, angle, options);
  }

  return candidates.slice(0, options.maxCandidates);
}

function getEnemyTargetAngles(
  bodies: readonly BodyState[],
  actor: BodyState
): readonly number[] {
  return bodies
    .filter(
      (body) =>
        body.alive &&
        body.id !== actor.id &&
        body.teamId !== undefined &&
        actor.teamId !== undefined &&
        body.teamId !== actor.teamId
    )
    .map((body) => angleOf(sub(body.position, actor.position)));
}

function addCandidateSet(
  candidates: ShotIntent[],
  actorBodyId: string,
  angle: number,
  options: BotOptions
): void {
  for (const power of options.powers) {
    for (const spinOffset of options.spinOffsets) {
      candidates.push({ actorBodyId, angle, power, spinOffset });
      if (candidates.length >= options.maxCandidates) {
        return;
      }
    }
  }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 0x100000000;
  };
}
