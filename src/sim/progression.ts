/**
 * Renown ranks and bought equipment.
 *
 * The rule the design settled on: **renown is permission, gold is acquisition.**
 * A rank never hands you a capability — it makes one appear in a merchant's
 * stock, and you still pay for it. That keeps gold meaningful late and stops a
 * rank-up from dumping five upgrades at once.
 *
 * Rank is derived from renown rather than stored, so it can never disagree with
 * the number it comes from. Equipment effects are likewise derived on read; the
 * only stored state is which equipment you own.
 */

import {
  caveConfig,
  config,
  decorConfig,
  equipment,
  findDecor,
  getEquipment,
  heroesConfig,
  ranks,
  shaftConfig,
} from './config';
import type { DecorEffect, EquipmentDef, EquipmentEffect } from './config';
import { caveTilesBonus } from './town';
import type { World } from './types';

/** Zero-based index into ranks.json. Rank I is index 0. */
export function rankIndexFor(renown: number): number {
  let index = 0;
  ranks.forEach((rank, i) => {
    if (renown >= rank.renown) index = i;
  });
  return index;
}

export function rankIdFor(renown: number): string {
  return ranks[rankIndexFor(renown)]?.id ?? 'apprentice';
}

/** Renown still needed for the next rank, or null at the top of the track. */
export function renownToNextRank(renown: number): { needed: number; nextId: string } | null {
  const next = ranks[rankIndexFor(renown) + 1];
  if (!next) return null;
  return { needed: Math.max(0, next.renown - renown), nextId: next.id };
}

export function ownedCount(world: World, equipmentId: string): number {
  return world.equipment[equipmentId] ?? 0;
}

export function owns(world: World, equipmentId: string): boolean {
  return ownedCount(world, equipmentId) > 0;
}

/**
 * Whether a piece of equipment can appear in stock at all.
 *
 * Separate from affordability on purpose: the market shows locked entries with
 * the reason attached, so a player learns what a rank is *for* before reaching
 * it.
 */
export function equipmentAvailability(
  world: World,
  def: EquipmentDef,
): { visible: boolean; reasonKey?: string } {
  if (ownedCount(world, def.id) >= (def.repeatable ?? 1)) {
    return { visible: false };
  }
  if (rankIndexFor(world.renown) < def.requiresRank) {
    return { visible: true, reasonKey: 'market.reason.rank' };
  }
  for (const prerequisite of def.requires ?? []) {
    if (!owns(world, prerequisite)) return { visible: true, reasonKey: 'market.reason.requires' };
  }
  return { visible: true };
}

export function canBuyEquipment(world: World, def: EquipmentDef): boolean {
  return equipmentAvailability(world, def).reasonKey === undefined;
}

/**
 * Derived stats, recomputed from owned equipment on every read.
 *
 * Deliberately not cached and not stored. A stored total drifts the moment a
 * migration adds an upgrade; a derived one cannot.
 */
export interface DerivedStats {
  /**
   * A floor under every pot's own ingredient count, from the Wide Rim.
   *
   * Capacity used to live here too. It belongs to the individual cauldron now —
   * the shop owns several, and a heavy blend should boil over in the starter
   * bowl even when a great pot is standing next to it.
   */
  maxIngredients: number;
  plots: number;
  shelves: number;
  seedDropChance: number;
  driftMultiplier: number;
  footfallBonus: number;
  nightFootfallBonus: number;
  caveTiles: number;
  caveSpreadBonus: number;
  oreBatchBonus: number;
  supportedDepth: number;
  heroSlots: number;
  appealBonus: number;
  haggleCeilingBonus: number;
  canForceDry: boolean;
  craftsVessels: boolean;
  craftsSeals: boolean;
  standingOrders: boolean;
}

export function derivedStats(world: World): DerivedStats {
  const stats: DerivedStats = {
    maxIngredients: 0,
    plots: config.garden.startingPlots,
    shelves: config.shop.startingShelves,
    seedDropChance: config.garden.seedDropChance,
    driftMultiplier: 1,
    footfallBonus: 0,
    nightFootfallBonus: 0,
    caveTiles: caveConfig.startingTiles,
    caveSpreadBonus: 0,
    oreBatchBonus: 0,
    supportedDepth: shaftConfig.startingDepth,
    heroSlots: heroesConfig.startingSlots,
    appealBonus: 0,
    haggleCeilingBonus: 0,
    canForceDry: false,
    craftsVessels: false,
    craftsSeals: false,
    standingOrders: false,
  };

  for (const def of equipment) {
    const count = ownedCount(world, def.id);
    if (count <= 0) continue;
    apply(stats, def.effect, count);
  }

  // Beds the town comes with rather than ones you bought — Hollowreach is caves
  // for miles, and that has to be true before the first purchase.
  stats.caveTiles += caveTilesBonus(world);

  /*
   * Décor counts only while it is *placed*. Owning the gilded sign and leaving
   * it in the back room does nothing, which is what makes five spots a choice
   * rather than a delay.
   */
  for (const spot of decorConfig.spots) {
    const id = world.decor?.[spot];
    if (!id) continue;
    // Tolerates a piece that has left the data file, so a save outlives an edit.
    const def = findDecor(id);
    if (def) applyDecor(stats, def.effect);
  }

  return stats;
}

/** Décor may only ever change how the shop sells, so this fold is deliberately small. */
function applyDecor(stats: DerivedStats, effect: DecorEffect): void {
  if (effect.appealBonus !== undefined) stats.appealBonus += effect.appealBonus;
  if (effect.footfallBonus !== undefined) stats.footfallBonus += effect.footfallBonus;
  if (effect.nightFootfallBonus !== undefined) {
    stats.nightFootfallBonus += effect.nightFootfallBonus;
  }
  if (effect.haggleCeilingBonus !== undefined) {
    stats.haggleCeilingBonus += effect.haggleCeilingBonus;
  }
}

/**
 * Fold one effect in.
 *
 * Capacity-style effects take the best value rather than stacking — owning both
 * the 100 and the 180 cauldron should give you a 180 cauldron, not a 280 one.
 * Additive effects stack with the count, for repeatable purchases.
 */
function apply(stats: DerivedStats, effect: EquipmentEffect, count: number): void {
  if (effect.maxIngredients !== undefined) {
    stats.maxIngredients = Math.max(stats.maxIngredients, effect.maxIngredients);
  }
  if (effect.addPlots !== undefined) stats.plots += effect.addPlots * count;
  if (effect.addShelves !== undefined) stats.shelves += effect.addShelves * count;
  if (effect.seedDropBonus !== undefined) stats.seedDropChance += effect.seedDropBonus * count;
  if (effect.footfallBonus !== undefined) stats.footfallBonus += effect.footfallBonus * count;
  if (effect.nightFootfallBonus !== undefined) {
    stats.nightFootfallBonus += effect.nightFootfallBonus * count;
  }
  if (effect.driftMultiplier !== undefined) {
    stats.driftMultiplier = Math.min(stats.driftMultiplier, effect.driftMultiplier);
  }
  if (effect.addCaveTiles !== undefined) stats.caveTiles += effect.addCaveTiles * count;
  if (effect.caveSpreadBonus !== undefined) stats.caveSpreadBonus += effect.caveSpreadBonus * count;
  if (effect.oreBatchBonus !== undefined) stats.oreBatchBonus += effect.oreBatchBonus * count;
  if (effect.addSupportedDepth !== undefined) {
    stats.supportedDepth += effect.addSupportedDepth * count;
  }
  if (effect.addHeroSlots !== undefined) stats.heroSlots += effect.addHeroSlots * count;
  if (effect.appealBonus !== undefined) stats.appealBonus += effect.appealBonus * count;
  if (effect.haggleCeilingBonus !== undefined) {
    stats.haggleCeilingBonus += effect.haggleCeilingBonus * count;
  }
  // Capability flags: owning one is enough, so count is irrelevant.
  if (effect.canForceDry) stats.canForceDry = true;
  if (effect.craftsVessels) stats.craftsVessels = true;
  if (effect.craftsSeals) stats.craftsSeals = true;
  if (effect.standingOrders) stats.standingOrders = true;
}

/**
 * Record ownership and grow anything that needs a real array behind it.
 *
 * Plots and shelves are objects, not numbers, so buying one has to create it.
 * Everything else is read through `derivedStats` and needs nothing here.
 */
export function grantEquipment(
  world: World,
  equipmentId: string,
  makePlot: (index: number) => World['plots'][number],
  makeShelf: (index: number) => World['shelf'][number],
  makeCaveTile: (index: number) => World['cave']['tiles'][number],
): void {
  // Throws on an unknown id rather than silently recording a purchase of nothing.
  getEquipment(equipmentId);
  world.equipment[equipmentId] = ownedCount(world, equipmentId) + 1;

  // Plots, shelves and cave beds are objects, not numbers — buying one has to
  // create it. Everything else is read through `derivedStats` and needs nothing.
  const stats = derivedStats(world);
  while (world.plots.length < stats.plots) {
    world.plots.push(makePlot(world.plots.length));
  }
  while (world.shelf.length < stats.shelves) {
    world.shelf.push(makeShelf(world.shelf.length));
  }
  while (world.cave.tiles.length < stats.caveTiles) {
    world.cave.tiles.push(makeCaveTile(world.cave.tiles.length));
  }
  world.shaft.supportedDepth = Math.max(world.shaft.supportedDepth, stats.supportedDepth);
}
