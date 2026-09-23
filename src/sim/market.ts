/**
 * The shelf — passive selling, online and off.
 *
 * Sales resolve on a fixed tick so that "five minutes of play" and "five minutes
 * of the app being closed" run the identical loop, just with a lower footfall
 * multiplier while away. There is no separate offline earnings formula to drift
 * out of sync with the live one.
 */

import { baseShelfTier, config, findShelfTier, getRecipe } from './config';
import { dayStateAt } from './clock';
import { potencyMultiplier } from './essences';
import { derivedStats } from './progression';
import { footfallMultiplier } from './town';
import type { Rng } from './rng';
import type { BottledItem, Grade, SaleRecord, ShelfSlot, World } from './types';

const GRADE_SCORE: Record<Grade, number> = { S: 6, A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };

/**
 * What an item is honestly worth. The player's asking price is expressed as a
 * ratio of this, so the price slider means the same thing for a 4g Minor potion
 * and a 400g Sovereign one.
 */
export function fairValue(item: {
  recipeId: string;
  grade: Grade;
  potencyTier: BottledItem['potencyTier'];
}): number {
  const recipe = getRecipe(item.recipeId);

  const gradeFactor = Math.pow((GRADE_SCORE[item.grade] + 1) / 4, config.market.gradeValueExponent);

  const value = recipe.baseValue * potencyMultiplier(item.potencyTier) * gradeFactor;

  return Math.max(1, Math.round(value));
}

/**
 * How readily an item catches a customer's eye: the same for every bottle,
 * raised by what the shelf and the shop around it are fitted with.
 */
export function appealOf(fittingsBonus = 0): number {
  return 1 + fittingsBonus;
}

/**
 * Price response. Steep by design: asking 130% of fair value nearly stops sales,
 * asking 80% clears the shelf. Pricing is the entire skill of the passive channel,
 * so the curve has to actually bite.
 */
export function priceCurve(priceRatio: number): number {
  const m = config.market;
  return 1 / (1 + Math.exp(m.priceCurveSteepness * (priceRatio - m.priceCurveMidpoint)));
}

export function footfallAt(world: World, now: number, online: boolean): number {
  const m = config.market;
  const day = dayStateAt(now);
  const stats = derivedStats(world);

  const phase = m.phaseFootfall[day.phase] ?? 1;
  const weekday = m.weekdayFootfall[day.weekday] ?? 1;
  const renown = 1 + world.renown * m.renownPerFootfall;
  const presence = online ? 1 : m.offlineFootfallMultiplier;

  // Shop fittings raise footfall generally; a lit display raises it after dark,
  // which is what makes the night trade worth stocking for at all.
  const fittings = 1 + stats.footfallBonus + (day.phase === 'night' ? stats.nightFootfallBonus : 0);

  // And the town decides how many people there were to catch.
  const town = footfallMultiplier(world);

  return m.baseFootfall * phase * weekday * renown * presence * fittings * town;
}

/** Probability that one shelf slot sells during one tick. */
export function saleChance(world: World, slot: ShelfSlot, now: number, online: boolean): number {
  if (!slot.item) return 0;
  const footfall = footfallAt(world, now, online);
  // The shop's fittings and this shelf's own board both flatter the goods on it.
  const appeal = appealOf(derivedStats(world).appealBonus + shelfQualityBonus(slot));
  return Math.min(0.95, footfall * appeal * priceCurve(slot.priceRatio) * 0.22);
}

export interface MarketTickResult {
  sales: SaleRecord[];
}

/**
 * Run every market tick between `world.lastMarketTick` and `world.now`.
 *
 * Called from `advanceTo`, so it serves both the live game and the offline
 * catch-up. Ticks are processed individually rather than approximated in bulk:
 * a week away should produce the same gold as a week of watching, and the only
 * way to guarantee that is to run the same loop.
 */
export function runMarket(world: World, rng: Rng, online: boolean): MarketTickResult {
  const tickMs = config.market.tickMs;
  const sales: SaleRecord[] = [];
  if (tickMs <= 0) return { sales };

  let tick = world.lastMarketTick + tickMs;
  // Guard against a pathological delta (a corrupted save, a clock jump) locking the
  // main thread. 20k ticks is ~10 real weeks at the default rate.
  let budget = 20_000;

  while (tick <= world.now && budget > 0) {
    budget -= 1;
    for (const slot of world.shelf) {
      if (!slot.item) continue;
      if (!rng.chance(saleChance(world, slot, tick, online))) continue;

      const item = slot.item;
      const gold = Math.max(1, Math.round(item.fairValue * slot.priceRatio));
      const renown =
        config.economy.renownPerSale + (config.economy.renownPerGradeBonus[item.grade] ?? 0);

      world.gold += gold;
      world.renown += renown;
      world.statistics.itemsSold += 1;
      world.statistics.goldEarned += gold;

      const record: SaleRecord = {
        itemName: item.recipeId,
        recipeId: item.recipeId,
        grade: item.grade,
        gold,
        renown,
        at: tick,
      };
      sales.push(record);
      world.unreadSales.push(record);

      // A stacked slot sells one at a time and only empties when the last goes.
      slot.quantity -= 1;
      if (slot.quantity <= 0) {
        slot.item = null;
        slot.quantity = 0;
      }
    }
    tick += tickMs;
  }

  world.lastMarketTick = tick - tickMs;
  return { sales };
}

export function makeShelf(count: number): ShelfSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `shelf-${i + 1}`,
    item: null,
    quantity: 0,
    quality: baseShelfTier.id,
    priceRatio: 1,
  }));
}

/** What a shelf's own board adds to the appeal of whatever stands on it. */
export function shelfQualityBonus(slot: ShelfSlot): number {
  return findShelfTier(slot.quality)?.appealBonus ?? 0;
}

/**
 * Fit a board to a shelf.
 *
 * Only ever upwards: a board is consumed by fitting and the old one is not
 * recovered, so downgrading would be pure loss and is refused rather than
 * offered as a mistake to make.
 */
export function fitBoard(world: World, slotId: string, tierId: string): boolean {
  const slot = world.shelf.find((s) => s.id === slotId);
  const tier = findShelfTier(tierId);
  const current = findShelfTier(slot?.quality ?? '');
  if (!slot || !tier || !current) return false;
  if (tier.appealBonus <= current.appealBonus) return false;
  if ((world.boards[tierId] ?? 0) <= 0) return false;

  world.boards[tierId] = (world.boards[tierId] ?? 0) - 1;
  slot.quality = tierId;
  return true;
}

/** Two bottles are interchangeable on a shelf only if nothing about them differs. */
export function sameGoods(a: BottledItem, b: BottledItem): boolean {
  return a.recipeId === b.recipeId && a.grade === b.grade && a.potencyTier === b.potencyTier;
}

/** Put one bottle out on an empty shelf. */
export function stockShelf(world: World, slotId: string, itemUid: string): boolean {
  const slot = world.shelf.find((s) => s.id === slotId);
  if (!slot || slot.item) return false;

  const index = world.bottled.findIndex((item) => item.uid === itemUid);
  if (index < 0) return false;

  const [item] = world.bottled.splice(index, 1);
  if (!item) return false;

  slot.item = item;
  slot.quantity = 1;
  return true;
}

/** Take everything in the slot back into storage, not just the top one. */
export function unstockShelf(world: World, slotId: string): boolean {
  const slot = world.shelf.find((s) => s.id === slotId);
  if (!slot?.item) return false;

  for (let i = 0; i < slot.quantity; i += 1) {
    world.bottled.push(i === 0 ? slot.item : { ...slot.item, uid: `${slot.item.uid}-${i}` });
  }
  slot.item = null;
  slot.quantity = 0;
  return true;
}

/**
 * How many of these goods could go out right now.
 *
 * Bounded by two things at once: how many interchangeable bottles are in
 * storage, and how much empty shelf there is to stand them on. Both matter —
 * the shop runs out of shelf long before it runs out of stock, and a count
 * offered that cannot be honoured is worse than no count at all.
 */
export function placeableCount(world: World, item: BottledItem, inStore?: number): number {
  /*
   * The caller may already know how many it has.
   *
   * The shop's grid groups the store room into stacks before it draws it, so it
   * counted every matching bottle once per tile and then this counted them all
   * again — a hundred tiles against four hundred bottles, on every press. The
   * rule stays here; only the number it was going to recompute is handed in.
   */
  const have = inStore ?? world.bottled.filter((entry) => sameGoods(entry, item)).length;
  const free = world.shelf.filter((slot) => !slot.item).length;
  return Math.min(have, free);
}

/**
 * Put several out at once, across whatever shelves are free.
 *
 * Stocking was one bottle per press, and each press meant finding a free shelf
 * first — putting eight bottles out was eight rounds of that. How many is the
 * player's decision; which shelf each one lands on is not a decision worth
 * making eight times, so shelves are filled in order, one bottle to each.
 *
 * Returns how many actually went out, which is fewer than asked when the shop
 * runs out of shelf before it runs out of stock.
 */
export function stockGoods(world: World, itemUid: string, quantity: number): number {
  const wanted = world.bottled.find((entry) => entry.uid === itemUid);
  if (!wanted || quantity <= 0) return 0;

  let placed = 0;
  for (const slot of world.shelf) {
    if (placed >= quantity) break;
    if (slot.item) continue;

    /*
     * The next matching bottle, not the uid asked for.
     *
     * That one is spoken for after the first shelf, and every bottle in the
     * stack is interchangeable by the same rule the shelf merges them with.
     */
    const next = world.bottled.find((entry) => sameGoods(entry, wanted));
    if (!next) break;

    if (!stockShelf(world, slot.id, next.uid)) break;
    placed += 1;
  }

  return placed;
}

/**
 * Move what is on one shelf to another, swapping if both are full.
 *
 * The board stays with the shelf and the asking price travels with the goods.
 * A board is furniture — it is the thing you fitted to that spot — where the
 * price is part of the listing, and carrying a Lacquered Shelf's 140% ask over
 * to a plank because the bottles moved would be a quiet, expensive surprise.
 */
export function moveShelfStock(world: World, fromId: string, toId: string): boolean {
  if (fromId === toId) return false;

  const from = world.shelf.find((slot) => slot.id === fromId);
  const to = world.shelf.find((slot) => slot.id === toId);
  if (!from || !to || !from.item) return false;

  const item = from.item;
  const quantity = from.quantity;
  const priceRatio = from.priceRatio;

  from.item = to.item;
  from.quantity = to.quantity;
  from.priceRatio = to.priceRatio;

  to.item = item;
  to.quantity = quantity;
  to.priceRatio = priceRatio;
  return true;
}
