/**
 * Recipe discovery, and learning a temperature band by hand.
 *
 * The alembic wheel was cut because it asked for dexterity the game never
 * otherwise asks for. This is what replaces the skill it took with it: a recipe
 * you have not made yet does not tell you its temperature, and you narrow it
 * down by brewing.
 *
 * Brew too cold and you are told it was too cold — not by how much, and not
 * where the band starts. Brew too hot and you learn the other bound. The book
 * shows the gap between your best guesses, and closes it as you work. Hit the
 * band once and it is yours for good.
 *
 * The knowledge is per-save, because it is the player's, not the character's.
 */

import { getRecipe, realRecipes } from './config';
import { codexBonuses } from './prestige';
import type { RecipeKnowledge, World } from './types';

export function knowledgeFor(world: World, recipeId: string): RecipeKnowledge {
  return (
    world.recipes[recipeId] ?? {
      discovered: false,
      coldestKnownTooCold: null,
      hottestKnownTooHot: null,
      bandKnown: false,
      timesBrewed: 0,
    }
  );
}

export function isDiscovered(world: World, recipeId: string): boolean {
  return knowledgeFor(world, recipeId).discovered;
}

/** Recipes the player has actually met. The book renders from this. */
export function discoveredRecipes(world: World) {
  return realRecipes().filter((recipe) => isDiscovered(world, recipe.id));
}

/**
 * The temperature band a recipe wants, widened by a steadier hand.
 *
 * Deft Hands in the Codex buys tolerance rather than precision — the band you
 * have to hit is simply larger, which is the honest analogue of skill in a
 * system with no dexterity in it.
 */
export function effectiveBand(world: World, recipeId: string): { min: number; max: number } {
  const recipe = getRecipe(recipeId);
  const slack = codexBonuses(world).temperatureToleranceBonus;
  return { min: recipe.temperature.min - slack, max: recipe.temperature.max + slack };
}

export interface BandHint {
  /** True once the exact band is known and can be printed. */
  known: boolean;
  min: number | null;
  max: number | null;
  /** Best guess bounds while still unknown. */
  lowerBound: number | null;
  upperBound: number | null;
}

/**
 * What the book can honestly say about a recipe's temperature.
 *
 * Before the band is nailed, this reports only what the player has actually
 * established: "hotter than 120" and "colder than 200" become a range they can
 * bisect. It never leaks the real numbers.
 */
export function bandHint(world: World, recipeId: string): BandHint {
  const knowledge = knowledgeFor(world, recipeId);
  if (knowledge.bandKnown) {
    const band = effectiveBand(world, recipeId);
    return { known: true, min: band.min, max: band.max, lowerBound: null, upperBound: null };
  }
  return {
    known: false,
    min: null,
    max: null,
    lowerBound: knowledge.coldestKnownTooCold,
    upperBound: knowledge.hottestKnownTooHot,
  };
}

export type TemperatureVerdict = 'tooCold' | 'inRange' | 'tooHot';

export function verdictFor(world: World, recipeId: string, temperature: number): TemperatureVerdict {
  const band = effectiveBand(world, recipeId);
  if (temperature < band.min) return 'tooCold';
  if (temperature > band.max) return 'tooHot';
  return 'inRange';
}

export interface DiscoveryResult {
  /** The recipe was met for the first time. */
  newlyDiscovered: boolean;
  /** The band was pinned down for the first time. */
  bandLearned: boolean;
  verdict: TemperatureVerdict;
}

/**
 * Record what a brew taught, at the moment it is accepted.
 *
 * Only accepting teaches anything. Rejecting is free precisely so that
 * experimenting is free, and letting a rejected pot leak the answer would make
 * the free option strictly better than committing to one.
 */
export function learnFrom(
  world: World,
  recipeId: string,
  temperature: number,
): DiscoveryResult {
  const before = knowledgeFor(world, recipeId);
  const verdict = verdictFor(world, recipeId, temperature);

  const knowledge: RecipeKnowledge = {
    discovered: true,
    coldestKnownTooCold: before.coldestKnownTooCold,
    hottestKnownTooHot: before.hottestKnownTooHot,
    bandKnown: before.bandKnown,
    timesBrewed: before.timesBrewed + 1,
  };

  if (verdict === 'tooCold') {
    // Keep the *highest* temperature known to be too cold — the tightest bound.
    knowledge.coldestKnownTooCold = Math.max(knowledge.coldestKnownTooCold ?? -Infinity, temperature);
  } else if (verdict === 'tooHot') {
    knowledge.hottestKnownTooHot = Math.min(knowledge.hottestKnownTooHot ?? Infinity, temperature);
  } else {
    knowledge.bandKnown = true;
  }

  world.recipes[recipeId] = knowledge;

  return {
    newlyDiscovered: !before.discovered,
    bandLearned: !before.bandKnown && knowledge.bandKnown,
    verdict,
  };
}

/** Teach a recipe outright — a merchant's scroll, or a Codex carry-over. */
export function grantRecipe(world: World, recipeId: string, withBand = false): void {
  const before = knowledgeFor(world, recipeId);
  world.recipes[recipeId] = {
    ...before,
    discovered: true,
    bandKnown: before.bandKnown || withBand,
  };
}

export function seedStartingKnowledge(world: World): void {
  for (const recipe of realRecipes()) {
    if (recipe.knownFromStart) grantRecipe(world, recipe.id, true);
  }
}
