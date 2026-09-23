/**
 * Recipe discovery.
 *
 * A recipe you have not made yet is not in your book. Making it — accepting a
 * brew that comes out as it — is what puts it there. The knowledge is per-save,
 * because it is the player's, not the character's.
 */

import { recipes } from './config';
import type { RecipeKnowledge, World } from './types';

export function knowledgeFor(world: World, recipeId: string): RecipeKnowledge {
  return world.recipes[recipeId] ?? { discovered: false, timesBrewed: 0 };
}

export function isDiscovered(world: World, recipeId: string): boolean {
  return knowledgeFor(world, recipeId).discovered;
}

/** Recipes the player has actually met. The book renders from this. */
export function discoveredRecipes(world: World) {
  return recipes.filter((recipe) => isDiscovered(world, recipe.id));
}

interface DiscoveryResult {
  /** The recipe was met for the first time. */
  newlyDiscovered: boolean;
}

/**
 * Record what a brew taught, at the moment it is accepted.
 *
 * Only accepting teaches anything. Rejecting is free precisely so that
 * experimenting is free, and letting a rejected pot leak the answer would make
 * the free option strictly better than committing to one.
 */
export function learnFrom(world: World, recipeId: string): DiscoveryResult {
  const before = knowledgeFor(world, recipeId);
  world.recipes[recipeId] = { discovered: true, timesBrewed: before.timesBrewed + 1 };
  return { newlyDiscovered: !before.discovered };
}

/** Teach a recipe outright, as a new shop is taught its first ones. */
function grantRecipe(world: World, recipeId: string): void {
  world.recipes[recipeId] = { ...knowledgeFor(world, recipeId), discovered: true };
}

export function seedStartingKnowledge(world: World): void {
  for (const recipe of recipes) {
    if (recipe.knownFromStart) grantRecipe(world, recipe.id);
  }
}
