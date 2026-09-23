/**
 * Yield boosters: one harvest, doubled, across what a site has going.
 *
 * A booster is held until used. Using one marks what the site is producing at
 * that moment — the plots with a crop in, the beds with a colony, the veins a
 * crew is working — and each doubles the next thing it yields, then goes back
 * to normal. With nothing producing there is nothing to mark, so it is not
 * spent.
 *
 * Only what is producing, because a mark on a vein nobody works, or on an
 * empty bed, was never spent: the site read as boosted for good, and every
 * later booster was refused. A site still takes one at a time, counted over
 * what is producing; any mark left behind on something that stopped (a crop
 * dug up, a crew called off) is cleared by the next one.
 */

import { boosters, getBooster, type BoostSite } from './config';
import type { World } from './types';

/** Everything on a site that a booster could have marked. */
function everything(world: World, site: BoostSite): Array<{ boosted?: boolean }> {
  if (site === 'garden') return world.plots;
  if (site === 'cave') return world.cave.tiles;
  return world.shaft.veins;
}

/** What a site is producing now: what a booster used now would mark. */
function producing(world: World, site: BoostSite): Array<{ boosted?: boolean }> {
  if (site === 'garden') return world.plots.filter((plot) => plot.crop !== null);
  if (site === 'cave') return world.cave.tiles.filter((tile) => tile.speciesId !== null);
  const working = world.shaft.workingVeinIds;
  return world.shaft.veins.filter((vein) => working.includes(vein.id));
}

/** Whether a booster is still waiting to be spent on something this site has going. */
export function isBoosted(world: World, site: BoostSite): boolean {
  return producing(world, site).some((entry) => entry.boosted);
}

/** How much of what the site has going a running booster has left to double. */
export function boostedCount(world: World, site: BoostSite): number {
  return producing(world, site).filter((entry) => entry.boosted).length;
}

/** The booster sold for a site. */
export function boosterFor(site: BoostSite) {
  return boosters.find((def) => def.site === site)!;
}

/**
 * Why a booster cannot be used now, as a string key, or null when it can.
 *
 * One answer for the sim and the button, so the button is never offered for a
 * press the sim will refuse.
 */
export function boosterBlock(world: World, boosterId: string): string | null {
  const def = getBooster(boosterId);
  if ((world.boosters[boosterId] ?? 0) <= 0) return 'booster.none';
  if (isBoosted(world, def.site)) return 'booster.busy';
  if (producing(world, def.site).length === 0) return `booster.idle.${def.site}`;
  return null;
}

/** Use a held booster on what its site has going. */
export function useBooster(world: World, boosterId: string): boolean {
  if (boosterBlock(world, boosterId)) return false;
  const def = getBooster(boosterId);

  world.boosters[boosterId] = (world.boosters[boosterId] ?? 0) - 1;
  for (const entry of everything(world, def.site)) delete entry.boosted;
  for (const target of producing(world, def.site)) target.boosted = true;
  return true;
}

/**
 * The yield of one harvest, with the site's booster applied if this plot, bed
 * or vein carries one — which it gives up in the doing.
 */
export function boostedYield(
  target: { boosted?: boolean },
  site: BoostSite,
  count: number,
): number {
  if (!target.boosted) return count;
  delete target.boosted;
  return count * boosterFor(site).yieldMultiplier;
}
