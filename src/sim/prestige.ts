/**
 * The Long Distillation — prestige.
 *
 * At the top rank you may retire the shop and open a new one in a new town.
 * Everything resets except **Mastery**, a permanent currency earned from
 * lifetime renown and spent in a Codex that never resets.
 *
 * Two things make this worth doing rather than a grind repeat. Mastery scales
 * with *when* you retire, so there is a real decision about pushing on. And each
 * town carries a modifier that reshapes which of the gathering sites carries the
 * run — so the Codex nodes you bought get tested differently each time.
 *
 * Prestige is always optional. The top rank with no reset is a complete game.
 */

import { config, getCodexNode, prestigeConfig, ranks } from './config';
import { makeCaveTiles } from './cave';
import { derivedStats } from './progression';
import { createWorld } from './state';
import { townById } from './town';
import type { CodexEffect } from './config';
import type { World } from './types';

export function canRetire(world: World): boolean {
  return rankIndexOf(world) >= prestigeConfig.requiresRank;
}

function rankIndexOf(world: World): number {
  let index = 0;
  ranks.forEach((rank, i) => {
    if (world.renown >= rank.renown) index = i;
  });
  return index;
}

/**
 * Mastery a retirement would pay out.
 *
 * Square root of lifetime renown, so the first run is not worthless and the
 * tenth is not absurd, and retiring later is always worth more than retiring
 * now.
 */
export function masteryFor(lifetimeRenown: number): number {
  return Math.floor(Math.sqrt(Math.max(0, lifetimeRenown)) * prestigeConfig.masteryPerRenownRoot);
}

export function codexTier(world: World, nodeId: string): number {
  return world.codex[nodeId] ?? 0;
}

export function codexCost(nodeId: string, currentTier: number): number {
  const node = getCodexNode(nodeId);
  return node.costPerTier * (currentTier + 1);
}

export function canBuyCodex(world: World, nodeId: string): boolean {
  const node = getCodexNode(nodeId);
  const tier = codexTier(world, nodeId);
  if (tier >= node.tiers) return false;
  return world.mastery >= codexCost(nodeId, tier);
}

export function buyCodex(world: World, nodeId: string): boolean {
  if (!canBuyCodex(world, nodeId)) return false;
  const tier = codexTier(world, nodeId);
  world.mastery -= codexCost(nodeId, tier);
  world.codex[nodeId] = tier + 1;
  return true;
}

/** Everything the Codex is currently granting, folded into one object. */
export interface CodexBonuses {
  /** Degrees of slack added to every recipe's temperature band. */
  temperatureToleranceBonus: number;
  timerMultiplier: number;
  oreBatchBonus: number;
  startingDepthBonus: number;
  startingMerchantTier: number;
  keptRecipes: number;
  keptHeroes: number;
  startingGold: number;
  startingRenown: number;
}

export function codexBonuses(world: World): CodexBonuses {
  const bonuses: CodexBonuses = {
    temperatureToleranceBonus: 0,
    timerMultiplier: 1,
    oreBatchBonus: 0,
    startingDepthBonus: 0,
    startingMerchantTier: 0,
    keptRecipes: 0,
    keptHeroes: 0,
    startingGold: 0,
    startingRenown: 0,
  };

  for (const node of prestigeConfig.codex) {
    const tier = codexTier(world, node.id);
    if (tier <= 0) continue;
    fold(bonuses, node.effect, tier);
  }
  return bonuses;
}

function fold(out: CodexBonuses, effect: CodexEffect, tier: number): void {
  if (effect.temperatureToleranceBonus) {
    out.temperatureToleranceBonus += effect.temperatureToleranceBonus * tier;
  }
  if (effect.timerMultiplier) out.timerMultiplier += effect.timerMultiplier * tier;
  if (effect.oreBatchBonus) out.oreBatchBonus += effect.oreBatchBonus * tier;
  if (effect.startingDepthBonus) out.startingDepthBonus += effect.startingDepthBonus * tier;
  if (effect.startingMerchantTier) out.startingMerchantTier += effect.startingMerchantTier * tier;
  if (effect.keptRecipes) out.keptRecipes += effect.keptRecipes * tier;
  if (effect.keptHeroes) out.keptHeroes += effect.keptHeroes * tier;
  if (effect.startingGold) out.startingGold += effect.startingGold * tier;
  if (effect.startingRenown) out.startingRenown += effect.startingRenown * tier;
}

export { townById, townEffects } from './town';

export interface RetirementResult {
  world: World;
  masteryEarned: number;
  townId: string;
}

/**
 * Retire and open a new shop.
 *
 * Everything the run built is gone; what survives is Mastery, the Codex, and
 * the record of how many times you have done this. The Codex is then applied to
 * the opening state, so a well-invested second run starts with more room than a
 * first run ever had.
 */
export function retire(world: World, townId: string, seed: number): RetirementResult | null {
  if (!canRetire(world)) return null;
  const town = townById(townId);
  if (!town) return null;

  const lifetime = world.lifetimeRenown + world.renown;
  const earned = masteryFor(lifetime);

  const next = createWorld(seed);
  next.mastery = world.mastery + earned;
  next.codex = { ...world.codex };
  next.lifetimeRenown = lifetime;
  next.retirements = world.retirements + 1;
  next.townId = townId;

  const bonuses = codexBonuses(next);
  next.gold = config.economy.startingGold + bonuses.startingGold;
  next.renown = bonuses.startingRenown;
  next.acknowledgedRank = 0;
  next.shaft.depth += bonuses.startingDepthBonus + (town.effects.startingDepthBonus ?? 0);
  next.shaft.supportedDepth = next.shaft.depth;

  /*
   * A town that comes with extra cave beds has to come with the beds themselves.
   * `derivedStats` counts them the moment the town is set, but the tiles are
   * objects — without this the count says eight and the cave shows two, and the
   * missing six only appear when some unrelated purchase happens to grow the
   * array.
   */
  const tiles = derivedStats(next).caveTiles;
  while (next.cave.tiles.length < tiles) {
    next.cave.tiles.push(...makeCaveTiles(1).map((tile) => ({ ...tile, index: next.cave.tiles.length })));
  }

  // Remembered Recipes: carry the most-brewed lines forward, band and all. What
  // you learned by hand is knowledge, and knowledge is the thing prestige keeps.
  if (bonuses.keptRecipes > 0) {
    const carried = Object.entries(world.recipes)
      .filter(([, knowledge]) => knowledge.discovered)
      .sort((a, b) => b[1].timesBrewed - a[1].timesBrewed)
      .slice(0, bonuses.keptRecipes);
    for (const [recipeId, knowledge] of carried) {
      next.recipes[recipeId] = { ...knowledge, timesBrewed: 0 };
    }
  }

  // A hero carried over comes with the regard they earned, not as a stranger.
  if (bonuses.keptHeroes > 0) {
    const kept = [...world.heroes]
      .sort((a, b) => b.favour - a.favour)
      .slice(0, bonuses.keptHeroes)
      .map((hero) => ({ ...hero, onMission: false, injuredUntil: null }));
    next.heroes = kept;
  }

  return { world: next, masteryEarned: earned, townId };
}

