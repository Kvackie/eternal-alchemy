/**
 * Pots, and how many of them.
 *
 * A cauldron is two upgrades wearing one name. A better pot holds a heavier
 * blend — which is what makes the top of the potency ladder reachable at all,
 * since a brew over its pot's capacity is capped at grade D. A *second* pot
 * brews a second thing at the same time, which is a different kind of better.
 *
 * Buying one of each is therefore never automatically right: a cheap second
 * cauldron and one expensive first cauldron are different shops.
 */

import { baseCauldronTier, cauldronsConfig, findCauldronTier, getCauldronTier } from './config';
import { rankIndexFor } from './progression';
import type { Cauldron, World } from './types';

/** A fresh, empty pot of the given tier. Bought pots start put away. */
export function makeCauldron(id: string, tierId: string, stored = false): Cauldron {
  return {
    id,
    tierId,
    contents: { units: [] },
    brewing: null,
    pendingBrew: null,
    stored,
  };
}

export function cauldronById(world: World, id: string): Cauldron | undefined {
  return world.cauldrons.find((pot) => pot.id === id);
}

/**
 * Pots on the bench, in the order they were acquired.
 *
 * Everything that brews reads this rather than `world.cauldrons`, so a pot in
 * storage is out of play everywhere at once — it cannot be filled, it cannot be
 * the active pot, and it is not somewhere the workbench can wander onto.
 */
export function workshopCauldrons(world: World): Cauldron[] {
  return world.cauldrons.filter((pot) => !pot.stored);
}

export function storedCauldrons(world: World): Cauldron[] {
  return world.cauldrons.filter((pot) => pot.stored);
}

/**
 * The pot the workbench is showing.
 *
 * Falls back to the first one on the bench rather than returning nothing: the
 * shop always has at least one out, and a stale active id — pointing at a pot
 * since put away — should show a cauldron rather than an empty screen.
 */
export function activeCauldron(world: World): Cauldron {
  const active = cauldronById(world, world.activeCauldronId);
  if (active && !active.stored) return active;
  return workshopCauldrons(world)[0] ?? world.cauldrons[0]!;
}

/**
 * Put a pot away, or bring it back out.
 *
 * Refused while it is doing something: a pot mid-brew holds a timer and a
 * result, and storing it would either lose them or leave a brew finishing in a
 * cupboard. Empty it or bottle it first.
 *
 * The last pot on the bench cannot be put away either — a workshop with nothing
 * in it is a screen with nothing to do and no way back to doing it.
 */
export function setCauldronStored(world: World, id: string, stored: boolean): boolean {
  const pot = cauldronById(world, id);
  if (!pot || pot.stored === stored) return false;
  if (stored) {
    if (activityOf(pot) !== 'idle') return false;
    if (workshopCauldrons(world).length <= 1) return false;
  }

  pot.stored = stored;
  if (world.activeCauldronId === id && stored) {
    world.activeCauldronId = workshopCauldrons(world)[0]?.id ?? world.activeCauldronId;
  }
  return true;
}

/** How much essence this pot can hold before the brew turns unstable. */
export function capacityOf(pot: Cauldron): number {
  return (findCauldronTier(pot.tierId) ?? baseCauldronTier).capacity;
}

/**
 * How many separate ingredients this pot will take.
 *
 * The pot's own figure, or the Wide Rim's floor if that is higher — the rim is
 * a shop-wide bench upgrade, so it should not make the good pot worse.
 */
export function maxIngredientsOf(pot: Cauldron, rimFloor = 0): number {
  const own = (findCauldronTier(pot.tierId) ?? baseCauldronTier).maxIngredients;
  return Math.max(own, rimFloor);
}

export function brewSpeedOf(pot: Cauldron): number {
  return (findCauldronTier(pot.tierId) ?? baseCauldronTier).brewSpeedMultiplier;
}

/** Tiers the shop's rank has unlocked, cheapest first. */
export function buyableTiers(world: World) {
  const rank = rankIndexFor(world.renown);
  return cauldronsConfig.tiers
    .filter((tier) => tier.cost > 0 && tier.requiresRank <= rank)
    .sort((a, b) => a.cost - b.cost);
}

export function atCauldronLimit(world: World): boolean {
  return world.cauldrons.length >= cauldronsConfig.maxOwned;
}

/**
 * Buy another pot.
 *
 * Always an addition, never a replacement — the old pot keeps working, which is
 * the whole point. Upgrading in place would make a second cauldron impossible
 * to express.
 */
export function buyCauldron(world: World, tierId: string): Cauldron | null {
  const tier = getCauldronTier(tierId);
  if (tier.cost <= 0) return null;
  if (atCauldronLimit(world)) return null;
  if (rankIndexFor(world.renown) < tier.requiresRank) return null;
  if (world.gold < tier.cost) return null;

  world.gold -= tier.cost;
  // Bought into storage: a new pot is a thing you own, and putting it on the
  // bench is a separate decision made on the same screen a moment later.
  const pot = makeCauldron(`cauldron-${world.nextCauldronId}`, tierId, true);
  world.nextCauldronId += 1;
  world.cauldrons.push(pot);
  return pot;
}

/**
 * What a pot is doing, for the world view and the pot switcher.
 *
 * `idle` covers both empty and mid-preparation: nothing is cooking, so nothing
 * needs watching.
 */
export type CauldronActivity = 'idle' | 'filling' | 'brewing' | 'ready';

export function activityOf(pot: Cauldron): CauldronActivity {
  if (pot.pendingBrew) return 'ready';
  if (pot.brewing) return 'brewing';
  if (pot.contents.units.length > 0) return 'filling';
  return 'idle';
}
