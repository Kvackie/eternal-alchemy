/**
 * Brewing: what a pot of ingredients comes out as.
 *
 * A recipe is a set of essences in equal measure, and every set is one — all 31
 * of them, from a single essence to all five. The ratio decides which potion
 * you are making and how pure it is; the amount decides how potent. There is no
 * heat to hold and no method to pick: what goes in is the whole decision.
 *
 * A blend that sits inside no recipe's cone makes nothing, and cannot be
 * brewed. Nothing here consumes ingredients — the cauldron holds them until the
 * player accepts — so experimenting is free.
 */

import { config, recipes } from './config';
import {
  angleBetween,
  gradeFor,
  potencyTierFor,
  totalEssence,
  worseOf,
} from './essences';
import type { BrewOutcome, EssenceVector, PotencyTierId } from './types';

/**
 * Purity from how far off the ratio a blend sits: 100 on it, 0 at the edge of
 * the recipe's cone.
 */
function purityAt(offIdealRad: number, toleranceDeg: number): number {
  const edge = (toleranceDeg * Math.PI) / 180;
  return Math.max(0, Math.min(100, 100 * (1 - offIdealRad / edge)));
}

/**
 * Work out what the cauldron would produce right now, or null when it would
 * produce nothing — an empty pot, or a blend that matches no recipe.
 *
 * Cones are half the distance to the nearest neighbour, so at most one recipe
 * ever claims a blend and there is nothing to rank.
 */
export function assessOutcome(args: {
  blend: EssenceVector;
  capacity: number;
}): BrewOutcome | null {
  const { blend, capacity } = args;
  const essence = totalEssence(blend);
  if (essence <= 0) return null;

  for (const recipe of recipes) {
    const offIdealRad = angleBetween(blend, recipe.target);
    if (offIdealRad >= (recipe.toleranceDeg * Math.PI) / 180) continue;

    const purity = purityAt(offIdealRad, recipe.toleranceDeg);
    const overCapacity = essence > capacity;

    // The letter is the purity, read on the ladder for this many essences — a
    // small pot on the ratio is an S, a great one off it an F. Boiling over is
    // the one exception.
    let grade = gradeFor(purity, recipe.elements.length);
    if (overCapacity) grade = worseOf(grade, config.cauldron.unstableGrade);

    return {
      recipeId: recipe.id,
      total: blend,
      totalEssence: essence,
      offIdealRad,
      purity,
      potencyTier: potencyTierFor(essence),
      overCapacity,
      grade,
    };
  }
  return null;
}

/** How long an accepted brew sits in the pot before it can be bottled. */
export function brewDurationFor(tier: PotencyTierId): number {
  return config.brewing.brewDuration[tier] ?? config.brewing.brewDuration.common;
}

/**
 * Whether the outcome is worth warning about before the player accepts.
 *
 * A warning, not an error — rejecting costs nothing.
 */
export function outcomeProblems(outcome: BrewOutcome): string[] {
  const problems: string[] = [];
  if (outcome.overCapacity) problems.push('cauldron.problem.capacity');
  return problems;
}
