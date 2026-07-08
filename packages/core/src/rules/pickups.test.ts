import { describe, expect, it } from "vitest";
import type { BodyState } from "../types/body";
import type { BonusOption, PlayerBonusState } from "../types/bonus";
import type { GameState } from "../types/game";
import type { MapData } from "../types/map";
import { PHYSICS_UNIT_SCALE } from "../physics/units";
import {
  BASE_SHOT_POWER_LIMIT,
  collectPickups,
  MAX_ACTIVE_PICKUPS,
  MAX_POWER_STACKS,
  NEXT_SHOT_POWER_BONUS,
  PICKUP_RADIUS,
  POWER_STACK_BONUS,
  resolveBonusOption,
  shotPowerLimitForPlayer,
  spawnPickupForTurn
} from "./pickups";

describe("pickup and bonus rules", () => {
  it("spawns deterministic legal pickups up to the active cap", () => {
    const first = makeState();
    const second = makeState();
    for (let turn = 0; turn < MAX_ACTIVE_PICKUPS + 2; turn += 1) {
      first.turnIndex = turn;
      second.turnIndex = turn;
      spawnPickupForTurn(first, openMap);
      spawnPickupForTurn(second, openMap);
    }

    expect(first.pickups).toHaveLength(MAX_ACTIVE_PICKUPS);
    expect(second.pickups).toEqual(first.pickups);
    expect(first.pickups?.every((pickup) => pickup.position.x > 0 && pickup.position.y > 0))
      .toBe(true);
  });

  it("collects touched pickups and appends two options for the owner", () => {
    const state = makeState();
    state.pickups = [
      {
        id: "pickup-a",
        position: { ...state.bodies[0]!.position },
        radius: PICKUP_RADIUS,
        spawnedTurnIndex: 0
      }
    ];

    const events = collectPickups(state, 1);

    expect(state.pickups).toHaveLength(0);
    expect(state.playerBonuses?.[0]?.options).toHaveLength(2);
    expect(events[0]?.type).toBe("pickup_collected");
  });

  it("keeps or clears accumulated options according to the player choice", () => {
    const state = makeState();
    const option = makeOption("option-a", "single_power_boost");
    state.playerBonuses = [makeBonuses({ options: [option, makeOption("option-b", "mass_up")] })];

    const result = resolveBonusOption(state, "p1", option.id);

    expect(result.ok).toBe(true);
    expect(state.playerBonuses?.[0]?.options).toHaveLength(0);
    expect(state.playerBonuses?.[0]?.nextPowerBoosts).toBe(1);
  });

  it("increases source ball mass without changing its radius", () => {
    const state = makeState();
    const option = makeOption("option-mass", "mass_up");
    const radiusBefore = state.bodies[0]!.radius;
    const massBefore = state.bodies[0]!.mass;
    state.playerBonuses = [makeBonuses({ options: [option] })];

    const result = resolveBonusOption(state, "p1", option.id);

    expect(result.ok).toBe(true);
    expect(state.bodies[0]!.mass).toBeGreaterThan(massBefore);
    expect(state.bodies[0]!.radius).toBe(radiusBefore);
  });

  it("calculates stacked and one-shot power caps", () => {
    const state = makeState();
    state.playerBonuses = [
      makeBonuses({
        powerCapStacks: MAX_POWER_STACKS,
        nextPowerBoosts: 1
      })
    ];

    expect(shotPowerLimitForPlayer(state, "p1")).toBe(
      BASE_SHOT_POWER_LIMIT + MAX_POWER_STACKS * POWER_STACK_BONUS + NEXT_SHOT_POWER_BONUS
    );
  });
});

const openMap: MapData = {
  id: "open",
  tableBounds: {
    left: 0,
    top: 0,
    right: 240 * PHYSICS_UNIT_SCALE,
    bottom: 160 * PHYSICS_UNIT_SCALE
  },
  colliders: [],
  triggers: [],
  portals: []
};

function makeState(): GameState {
  return {
    gameId: "game",
    mapId: "open",
    turnIndex: 0,
    currentPlayerId: "p1",
    phase: "waiting_for_shot",
    players: [
      { id: "p1", teamId: "p1" },
      { id: "p2", teamId: "p2" }
    ],
    bodies: [makeBody("disc-a", "p1", { x: 40 * PHYSICS_UNIT_SCALE, y: 40 * PHYSICS_UNIT_SCALE })],
    effects: [],
    pickups: [],
    playerBonuses: [],
    rngSeed: 123
  };
}

function makeBody(id: string, ownerPlayerId: string, position: { x: number; y: number }): BodyState {
  return {
    id,
    kind: "disc",
    ownerPlayerId,
    teamId: ownerPlayerId,
    position,
    velocity: { x: 0, y: 0 },
    radius: 10 * PHYSICS_UNIT_SCALE,
    mass: PHYSICS_UNIT_SCALE,
    damping: 0,
    spin: 0,
    spinControl: 1,
    alive: true,
    sleep: true,
    tags: [],
    modifiers: []
  };
}

function makeBonuses(partial: Partial<PlayerBonusState> = {}): PlayerBonusState {
  return {
    playerId: "p1",
    options: [],
    powerCapStacks: 0,
    nextPowerBoosts: 0,
    trajectoryPreviewCharges: 0,
    pendingActionBonuses: [],
    extraActionTokens: [],
    ...partial
  };
}

function makeOption(id: string, kind: BonusOption["kind"]): BonusOption {
  return {
    id,
    kind,
    ownerPlayerId: "p1",
    sourcePickupId: "pickup-a",
    sourceBodyId: "disc-a",
    createdTurnIndex: 0
  };
}
