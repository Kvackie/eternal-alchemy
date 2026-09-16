/**
 * Town modifiers.
 *
 * Each town reshapes which gathering site carries the run — that is the whole
 * reason a second run plays differently from the first, and the reason the town
 * you pick at retirement is a decision rather than a label.
 *
 * This lives apart from `prestige.ts` on purpose: prestige imports `state`,
 * which imports `market` and `garden`, so the systems that need a modifier
 * cannot import prestige without a cycle. Nothing here imports anything but
 * config, so everything can read it.
 *
 * Conventions, so a new town's numbers are unambiguous:
 *   - `...Multiplier` on a DURATION or a PRICE — lower is better.
 *   - `...Multiplier` on a YIELD, a PAYOUT or a CHANCE — higher is better.
 *   - `...Bonus` is added, and higher is better.
 * A modifier that is absent means 1 (or 0 for a bonus), so a town only declares
 * what it actually changes.
 */

import { prestigeConfig } from './config';
import type { TownDef } from './config';
import type { World } from './types';

export function townById(townId: string): TownDef | undefined {
  return prestigeConfig.towns.find((town) => town.id === townId);
}

export function townEffects(world: World): TownDef['effects'] {
  return townById(world.townId)?.effects ?? {};
}

/** How long a crop takes here. Saltmarsh grows well; Cinderhold's soil is poor. */
export function cropGrowthMultiplier(world: World): number {
  return townEffects(world).cropGrowthMultiplier ?? 1;
}

/** Ore per batch. Cinderhold's rock is rich, Saltmarsh has almost none. */
export function oreBatchMultiplier(world: World): number {
  return townEffects(world).oreBatchMultiplier ?? 1;
}

/** What merchants charge. Hollowreach trades cheap; Highmarch does not. */
export function merchantPriceMultiplier(world: World): number {
  return townEffects(world).merchantPriceMultiplier ?? 1;
}

/** How readily the mycelium takes new ground. */
export function caveSpreadMultiplier(world: World): number {
  return townEffects(world).caveSpreadMultiplier ?? 1;
}

/** Extra cave beds that come with the town rather than being bought. */
export function caveTilesBonus(world: World): number {
  return townEffects(world).caveTilesBonus ?? 0;
}

/** What a contract pays. Highmarch has the noble money. */
export function contractPayoutMultiplier(world: World): number {
  return townEffects(world).contractPayoutMultiplier ?? 1;
}

/** How many people pass the door. */
export function footfallMultiplier(world: World): number {
  return townEffects(world).footfallMultiplier ?? 1;
}
