/**
 * Renown ranks and bought equipment.
 *
 * The rule the design settled on: **renown is permission, gold is acquisition.**
 * A rank never hands you a capability — it makes one appear in a merchant's
 * stock, and you still pay for it. That keeps gold meaningful late and stops a
 * rank-up from dumping five upgrades at once.
 *
 * Rank is derived rather than stored, so it can never disagree with what it
 * comes from: renown, and — from Journeyman up — having bottled a potion good
 * enough for the title. A shop that has only ever made one-essence Minors does
 * not get to call itself an Arch-Alchemist however much renown the shelf has
 * earned it. Equipment effects are likewise derived on read; the only stored
 * state is which equipment you own, and which kinds of potion you have made.
 */

import {
  caveConfig,
  config,
  equipment,
  getEquipment,
  getRecipe,
  heroesConfig,
  ranks,
  shaftConfig,
  type RankRequirement,
} from './config';
import { placedDecor } from './decor';
import { gradeAtLeast, potencyRank } from './essences';
import type { DecorEffect, EquipmentDef, EquipmentEffect } from './config';
import { caveTilesBonus } from './town';
import type { BottledItem, Grade, PotencyTierId, World } from './types';

/** The key a kind of potion is recorded under: `grade|essences|potency`. */
export function kindKey(grade: Grade, essences: number, potency: PotencyTierId): string {
  return `${grade}|${essences}|${potency}`;
}

/** The key a bottled potion is recorded under. */
export function bottledKindKey(item: BottledItem): string {
  return kindKey(item.grade, getRecipe(item.recipeId).elements.length, item.potencyTier);
}

/** Remember what kind of potion was just bottled, for the rank requirements. */
export function recordBottled(world: World, item: BottledItem): void {
  world.bottledKinds[bottledKindKey(item)] = true;
}

/** Record a potion that exactly meets a rank's requirement, as if it had been bottled. */
export function recordRequirement(world: World, requires: RankRequirement): void {
  world.bottledKinds[kindKey(requires.grade, requires.essences, requires.potency)] = true;
}

/** Keys split once: rank checks run on every market row and every tick. */
const parsedKinds = new Map<string, { grade: Grade; essences: number; potency: number }>();

function parseKind(key: string): { grade: Grade; essences: number; potency: number } {
  let parsed = parsedKinds.get(key);
  if (!parsed) {
    const [grade, essences, potency] = key.split('|');
    parsed = {
      grade: grade as Grade,
      essences: Number(essences),
      potency: potencyRank(potency as PotencyTierId),
    };
    parsedKinds.set(key, parsed);
  }
  return parsed;
}

/** Whether anything bottled this run is at least as good as a rank asks for. */
export function meetsRequirement(world: World, requires: RankRequirement): boolean {
  const potency = potencyRank(requires.potency);
  return Object.keys(world.bottledKinds ?? {}).some((key) => {
    const kind = parseKind(key);
    return (
      gradeAtLeast(kind.grade, requires.grade) &&
      kind.essences >= requires.essences &&
      kind.potency >= potency
    );
  });
}

/**
 * The shop's rank: the highest one whose renown it has and whose potion — and
 * every potion before it — it has bottled.
 */
export function rankOf(world: World): number {
  let index = 0;
  for (let i = 1; i < ranks.length; i += 1) {
    const rank = ranks[i]!;
    if (world.renown < rank.renown) break;
    if (rank.requires && !meetsRequirement(world, rank.requires)) break;
    index = i;
  }
  return index;
}

export function rankIdOf(world: World): string {
  return ranks[rankOf(world)]?.id ?? 'apprentice';
}

/** What the next rank still asks for, or null at the top of the track. */
export function nextRankProgress(world: World): {
  nextId: string;
  renownNeeded: number;
  requires: RankRequirement | null;
  requirementMet: boolean;
} | null {
  const next = ranks[rankOf(world) + 1];
  if (!next) return null;
  return {
    nextId: next.id,
    renownNeeded: Math.max(0, next.renown - world.renown),
    requires: next.requires ?? null,
    requirementMet: !next.requires || meetsRequirement(world, next.requires),
  };
}

/**
 * The rank renown alone would give, with no potion asked for. What the
 * renown thresholds mean on their own; `rankOf` is the shop's actual rank.
 */
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
  if (rankOf(world) < def.requiresRank) {
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
  footfallBonus: number;
  nightFootfallBonus: number;
  caveTiles: number;
  caveSpreadBonus: number;
  oreBatchBonus: number;
  /** How many veins can be worked at once. */
  shaftCrews: number;
  supportedDepth: number;
  heroSlots: number;
  appealBonus: number;
  haggleCeilingBonus: number;
  canForceDry: boolean;
}

export function derivedStats(world: World): DerivedStats {
  const stats: DerivedStats = {
    maxIngredients: 0,
    plots: config.garden.startingPlots,
    shelves: config.shop.startingShelves,
    seedDropChance: config.garden.seedDropChance,
    footfallBonus: 0,
    nightFootfallBonus: 0,
    caveTiles: caveConfig.startingTiles,
    caveSpreadBonus: 0,
    oreBatchBonus: 0,
    shaftCrews: 1,
    supportedDepth: shaftConfig.startingDepth,
    heroSlots: heroesConfig.startingSlots,
    appealBonus: 0,
    haggleCeilingBonus: 0,
    canForceDry: false,
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
  for (const def of placedDecor(world)) applyDecor(stats, def.effect);

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
  if (effect.addCaveTiles !== undefined) stats.caveTiles += effect.addCaveTiles * count;
  if (effect.caveSpreadBonus !== undefined) stats.caveSpreadBonus += effect.caveSpreadBonus * count;
  if (effect.oreBatchBonus !== undefined) stats.oreBatchBonus += effect.oreBatchBonus * count;
  if (effect.addShaftCrews !== undefined) stats.shaftCrews += effect.addShaftCrews * count;
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
}

/**
 * Record ownership and grow anything that needs a real array behind it.
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
  const before = derivedStats(world);
  world.equipment[equipmentId] = ownedCount(world, equipmentId) + 1;
  const stats = derivedStats(world);

  /*
   * Plots, shelves and cave beds are objects, not numbers — buying one has to
   * create it. By what the purchase adds, not up to a target count: a save can
   * hold more than its equipment accounts for (the greenhouse's two beds
   * outlived it), and filling to the count then made the next bed you paid for
   * appear to be one you already had.
   */
  for (let i = before.plots; i < stats.plots; i += 1) {
    world.plots.push(makePlot(world.plots.length));
  }
  for (let i = before.shelves; i < stats.shelves; i += 1) {
    world.shelf.push(makeShelf(world.shelf.length));
  }
  for (let i = before.caveTiles; i < stats.caveTiles; i += 1) {
    world.cave.tiles.push(makeCaveTile(world.cave.tiles.length));
  }
  world.shaft.supportedDepth = Math.max(world.shaft.supportedDepth, stats.supportedDepth);
}
