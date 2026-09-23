/**
 * Yield boosters: one harvest, doubled, across a whole site.
 *
 * A booster is held until used. Using one marks every plot, every cave bed or
 * every vein, and each doubles the next thing it yields and then goes back to
 * normal — so a booster is worth one full round of a site, however long that
 * round takes. A site takes one at a time: a second waits until the first has
 * been spent everywhere it was put.
 */

import { boosters, getBooster, type BoostSite } from './config';
import type { World } from './types';

/** Everything on a site that a booster marks. */
function marked(world: World, site: BoostSite): Array<{ boosted?: boolean }> {
  if (site === 'garden') return world.plots;
  if (site === 'cave') return world.cave.tiles;
  return world.shaft.veins;
}

/** Whether a booster is still waiting to be spent somewhere on this site. */
export function isBoosted(world: World, site: BoostSite): boolean {
  return marked(world, site).some((entry) => entry.boosted);
}

/** How much of the site a running booster has left to double. */
export function boostedCount(world: World, site: BoostSite): number {
  return marked(world, site).filter((entry) => entry.boosted).length;
}

/** The booster sold for a site. */
export function boosterFor(site: BoostSite) {
  return boosters.find((def) => def.site === site)!;
}

/** Use a held booster on its site. Refused while one is still running there. */
export function useBooster(world: World, boosterId: string): boolean {
  const def = getBooster(boosterId);
  if ((world.boosters[boosterId] ?? 0) <= 0) return false;
  if (isBoosted(world, def.site)) return false;
  const targets = marked(world, def.site);
  if (targets.length === 0) return false;

  world.boosters[boosterId] = (world.boosters[boosterId] ?? 0) - 1;
  for (const target of targets) target.boosted = true;
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
