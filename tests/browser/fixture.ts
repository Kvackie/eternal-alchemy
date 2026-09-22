/**
 * A world rich enough for the checks to have something to look at.
 *
 * Every screen needs content or a sweep passes by finding nothing: an empty
 * Shop cannot overflow, and a Roster with no heroes has no supply rack to
 * measure. Built from the simulation's own constructors rather than from a
 * checked-in JSON blob, so it cannot drift out of date with the save schema —
 * the one failure that made the last hand-built fixture silently load a world
 * with one cauldron in it instead of three.
 */

import { config, heroesConfig, ingredients, realRecipes } from '@/sim/config';
import { makeCauldron } from '@/sim/cauldrons';
import { generateContract } from '@/sim/contracts';
import { addIngredient } from '@/sim/inventory';
import { makeShelf } from '@/sim/market';
import { Rng } from '@/sim/rng';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import type { World } from '@/sim/types';

/**
 * Two clocks, because the market is two different screens.
 *
 * Night is the only time the one barter trader is in town, and his tiles carry
 * a price written as a sentence. Daylight is the only time the others are, and
 * theirs are the ones that come out blocked — a reason where a price goes,
 * which is the longest thing a tile ever has to hold. Checking one clock
 * checks half the screen.
 */
export const CLOCKS = { night: 3.85, day: 2.4 } as const;

export type Clock = keyof typeof CLOCKS;

export function buildWorld(clock: Clock = 'night'): World {
  const world = createWorld(12345);

  world.now = config.clock.dayLengthMs * CLOCKS[clock];
  world.lastSeenRealTime = Date.now();
  world.onboardingDismissed = true;
  world.lastMarketTick = world.now;
  world.lastContractTick = world.now;
  world.cave.lastTick = world.now;

  world.gold = 250_000;
  /*
   * Mid-rank on purpose, not maxed.
   *
   * At the top of the ladder nothing a merchant carries is ever out of reach,
   * so no tile is ever drawn blocked — and a blocked tile is the one that
   * carries a sentence where a price goes, which is what found a chip running
   * out of its own tile. Adept leaves plenty unlocked and plenty not.
   */
  world.renown = 1_800;
  world.mastery = 600;

  // Every recipe known, so the book is at its full size — which is the size
  // that matters for anything measuring how much the station has to draw.
  for (const recipe of realRecipes()) {
    world.recipes[recipe.id] = {
      discovered: true,
      coldestKnownTooCold: null,
      hottestKnownTooHot: null,
      bandKnown: true,
      timesBrewed: 3,
    };
  }

  for (const ingredient of ingredients) addIngredient(world, ingredient.id, 6, world.now, null);

  world.cauldrons.push(makeCauldron('cauldron-2', 'cauldronThree', 20, false));
  world.cauldrons.push(makeCauldron('cauldron-3', 'cauldronFour', 20, true));
  world.nextCauldronId = 4;

  for (const hero of heroesConfig.roster.slice(0, 4)) {
    world.heroes.push({ id: hero.id, level: 3, favour: 0, injuredUntil: 0, onMission: false } as never);
  }

  for (let i = 0; i < 4; i += 1) {
    const contract = generateContract(world, new Rng(99 + i), i + 1, config.clock.dayLengthMs);
    if (contract) world.contracts.push(contract);
  }
  world.nextContractId = world.contracts.length + 1;
  // One order inside a day, so the urgent styling is on screen to be measured.
  if (world.contracts[0]) world.contracts[0].msRemaining = 30_000;

  /*
   * Stock through the same grant the debug panel offers.
   *
   * Hand-rolling bottles here is how this fixture drifted last time — it built
   * a world the save schema had moved on from and nobody noticed until a check
   * loaded one cauldron where it meant three. One path, exercised both ways.
   */
  new Simulation(world).grant({ bottles: { kinds: 8, each: 5 } });

  world.shelf = makeShelf(12);
  world.bottled.slice(0, 6).forEach((item, index) => {
    const slot = world.shelf[index]!;
    slot.item = item;
    slot.quantity = 1;
  });
  world.bottled = world.bottled.filter(
    (item) => !world.shelf.some((slot) => slot.item?.uid === item.uid),
  );

  return world;
}

/** The blob the page reads out of local storage on boot. */
export function buildSave(clock: Clock = 'night'): string {
  return JSON.stringify({
    schemaVersion: config.save.schemaVersion,
    savedAt: Date.now(),
    world: buildWorld(clock),
  });
}
