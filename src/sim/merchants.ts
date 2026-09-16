/**
 * Merchants.
 *
 * Presence and stock are both *derived from world time* rather than scheduled.
 * A merchant is in town on the days their cycle lands on, during their phase —
 * so "who is here" is a pure function of the clock, and offline catch-up needs
 * no special handling at all. There is no queue to drain and no visit to miss
 * because the app was closed.
 *
 * Stock is generated from an RNG seeded on (merchant, day), which makes a
 * visit's inventory stable across saves, reloads and re-renders without storing
 * a single item. Only what you have already *bought* is state.
 */

import { dayStateAt } from './clock';
import { config, findDecor, findEquipment, getMerchant, merchants } from './config';
import type { MerchantDef, MerchantStockDef } from './config';
import { Rng } from './rng';
import { rankIndexFor } from './progression';
import { codexBonuses } from './prestige';
import { merchantPriceMultiplier } from './town';
import type { Grade, World } from './types';

export interface StockEntry {
  /** Index into the visit's generated list; the purchase record keys on it. */
  index: number;
  kind: MerchantStockDef['kind'];
  id: string;
  /** Gold price after relationship discount, or null for a barter merchant. */
  price: number | null;
  barter: { potions: number; minGrade: Grade } | null;
  /** How many remain this visit. */
  remaining: number;
  stock: number;
}

export interface MerchantVisit {
  merchantId: string;
  dayNumber: number;
  /** World time the visit's window closes. */
  leavesAt: number;
  currency: MerchantDef['currency'];
  relationship: number;
  tier: number;
  discount: number;
  entries: StockEntry[];
}

/** Day numbers a merchant appears on. Pure arithmetic on the day counter. */
export function visitsOn(def: MerchantDef, dayNumber: number): boolean {
  const cycle = Math.max(1, def.cycleDays);
  return ((dayNumber - def.offsetDays) % cycle + cycle) % cycle === 0;
}

/**
 * Is this merchant here right now?
 *
 * Day traders keep dawn-through-dusk; the Ashwalker keeps night. That single
 * distinction is the whole "merchants close at night" rule, and the exception
 * to it.
 */
export function isPresent(def: MerchantDef, now: number): boolean {
  const day = dayStateAt(now);
  if (!visitsOn(def, day.dayNumber)) return false;
  return def.phase === 'night' ? day.phase === 'night' : day.phase !== 'night';
}

/** World time at which the current visit window ends. */
function windowEnd(def: MerchantDef, now: number): number {
  const day = dayStateAt(now);
  const dayMs = config.clock.dayLengthMs;
  const phases = config.clock.phases;
  const nightStart = phases.find((p) => p.id === 'night')?.startFraction ?? 0.75;

  // Night runs to the end of the day; daylight runs until night begins.
  const fraction = def.phase === 'night' ? 1 : nightStart;
  return day.dayNumber * dayMs + fraction * dayMs;
}

/** A stable per-visit seed, so the same visit always stocks the same goods. */
function visitSeed(merchantId: string, dayNumber: number): number {
  let hash = 2166136261;
  const key = `${merchantId}:${dayNumber}`;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function relationshipOf(world: World, merchantId: string): number {
  return world.merchantRelations[merchantId] ?? 0;
}

/**
 * Relationship tier, which gates the deeper half of a merchant's pool.
 *
 * `floor` is Old Friends in the Codex: merchants in a new town remember you from
 * the last one, so a prestige run does not start every relationship at nothing.
 */
export function tierOf(def: MerchantDef, relationship: number, floor = 0): number {
  let tier = 0;
  def.relationshipTiers.forEach((threshold, index) => {
    if (relationship >= threshold) tier = index;
  });
  return Math.min(def.relationshipTiers.length - 1, Math.max(tier, floor));
}

/**
 * Pick this visit's goods.
 *
 * Weighted draw without replacement from everything the player's relationship
 * tier and rank have opened up. Equipment already owned is filtered out before
 * the draw, so a full shelf of upgrades never crowds out the staples.
 */
function generateEntries(
  world: World,
  def: MerchantDef,
  dayNumber: number,
  tier: number,
): StockEntry[] {
  const rng = new Rng(visitSeed(def.id, dayNumber));
  const rank = rankIndexFor(world.renown);

  const pool = def.pool.filter((item) => {
    if (item.tier > tier) return false;
    if (item.kind !== 'equipment' && item.kind !== 'decor') return true;

    /*
     * One-off purchases — equipment and décor alike — appear one rank early, so
     * a player can see what a rank is for before they reach it, and vanish once
     * owned so a full collection never crowds the staples out of the draw.
     *
     * "Owned" means owned as many as you may. Comparing against 1 instead of the
     * declared limit meant a repeatable upgrade could only ever be bought once,
     * which capped the shaft one seam down and left the second hero slot and the
     * extra cave beds permanently out of reach.
     */
    const equipmentDef = item.kind === 'equipment' ? findEquipment(item.id) : undefined;
    const definition = equipmentDef ?? (item.kind === 'decor' ? findDecor(item.id) : undefined);
    if (!definition) return false;

    if (rank < definition.requiresRank - 1) return false;

    const owned =
      item.kind === 'equipment'
        ? (world.equipment[item.id] ?? 0)
        : (world.decorOwned[item.id] ?? 0);
    const limit = equipmentDef?.repeatable ?? 1;
    return owned < limit;
  });

  /*
   * Stratified draw: one kind at a time, round-robin, weighted within the kind.
   *
   * A flat weighted draw over the whole pool was fine when a merchant carried a
   * dozen things. With seeds and spores for every crop and cave species, Bramm's
   * pool is seventy-odd entries and a flat draw of five would show five seeds and
   * no vessel most days — the staples crowded out by the very content that was
   * supposed to enrich them.
   *
   * Dealing round the kinds means a visit always looks like a shop: something to
   * plant, something to brew with, something to bottle in.
   */
  const byKind = new Map<MerchantStockDef['kind'], MerchantStockDef[]>();
  for (const item of pool) {
    if (!byKind.has(item.kind)) byKind.set(item.kind, []);
    byKind.get(item.kind)!.push(item);
  }

  // Kind order is itself shuffled per visit, so the same kind is not always the
  // one that gets squeezed out when picks run short.
  const kinds = [...byKind.keys()].sort();
  for (let i = kinds.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }

  const chosen: MerchantStockDef[] = [];
  const picks = Math.min(def.picks, pool.length);

  while (chosen.length < picks) {
    let dealt = false;
    for (const kind of kinds) {
      if (chosen.length >= picks) break;
      const bucket = byKind.get(kind)!;
      if (bucket.length === 0) continue;

      const total = bucket.reduce((sum, item) => sum + item.weight, 0);
      if (total <= 0) {
        bucket.length = 0;
        continue;
      }
      let roll = rng.next() * total;
      let index = 0;
      for (let j = 0; j < bucket.length; j += 1) {
        roll -= bucket[j]!.weight;
        if (roll <= 0) {
          index = j;
          break;
        }
      }
      const [picked] = bucket.splice(index, 1);
      if (picked) {
        chosen.push(picked);
        dealt = true;
      }
    }
    if (!dealt) break;
  }

  const bought = boughtRecord(world, def.id, dayNumber);
  const discount = tier * def.discountPerTier;
  // Hollowreach trades cheap and Highmarch does not; the town moves every price.
  const townPrice = merchantPriceMultiplier(world);

  return chosen.map((item, index) => {
    // A one-off purchase is always a single unit, whatever the pool says.
    const oneOff = item.kind === 'equipment' || item.kind === 'decor';
    const stock = oneOff ? 1 : (item.stock ?? 1);

    /*
     * `price` is the one truth about what this costs, so buying and displaying
     * cannot disagree. A one-off's base price comes from its own definition —
     * the same cauldron costs the same from whoever is carrying it — and takes
     * no relationship discount, but the town's price level applies to
     * everything, because that is a condition of the place and not a favour
     * from a trader.
     */
    const catalogue =
      item.kind === 'equipment'
        ? findEquipment(item.id)?.cost
        : item.kind === 'decor'
          ? findDecor(item.id)?.cost
          : undefined;
    // A barter entry has no gold price at all, whatever its catalogue says.
    const base = item.barter ? undefined : (catalogue ?? item.price);
    const afterDiscount = catalogue === undefined ? (base ?? 0) * (1 - discount) : catalogue;

    return {
      index,
      kind: item.kind,
      id: item.id,
      price: base === undefined ? null : Math.max(1, Math.round(afterDiscount * townPrice)),
      barter: item.barter ?? null,
      stock,
      remaining: Math.max(0, stock - (bought[item.id] ?? 0)),
    };
  });
}

/**
 * Purchases made during the current visit, reset when the visit day changes.
 *
 * Keyed by item id, not by position in the list. A positional key silently
 * re-maps onto different goods the moment a merchant's pool is edited, which
 * makes every content update mark random things in old saves as sold out.
 */
function boughtRecord(world: World, merchantId: string, dayNumber: number): Record<string, number> {
  const record = world.merchantVisits[merchantId];
  if (!record || record.dayNumber !== dayNumber) return {};
  return record.bought;
}

/** Every merchant currently in town, with their stock for this visit. */
export function presentMerchants(world: World): MerchantVisit[] {
  const day = dayStateAt(world.now);

  return merchants
    .filter((def) => isPresent(def, world.now))
    .map((def) => {
      const relationship = relationshipOf(world, def.id);
      const tier = tierOf(def, relationship, codexBonuses(world).startingMerchantTier);
      return {
        merchantId: def.id,
        dayNumber: day.dayNumber,
        leavesAt: windowEnd(def, world.now),
        currency: def.currency,
        relationship,
        tier,
        discount: tier * def.discountPerTier,
        entries: generateEntries(world, def, day.dayNumber, tier),
      };
    });
}

/** When this merchant is next in town, for the "come back later" line. */
export function nextVisit(def: MerchantDef, now: number): number {
  const dayMs = config.clock.dayLengthMs;
  const today = dayStateAt(now).dayNumber;
  for (let offset = 0; offset <= def.cycleDays * 2 + 1; offset += 1) {
    const day = today + offset;
    if (!visitsOn(def, day)) continue;
    const start =
      def.phase === 'night'
        ? day * dayMs + (config.clock.phases.find((p) => p.id === 'night')?.startFraction ?? 0.75) * dayMs
        : day * dayMs;
    if (start > now) return start;
  }
  return now + dayMs;
}

export function upcomingMerchants(world: World): Array<{ merchantId: string; at: number }> {
  return merchants
    .filter((def) => !isPresent(def, world.now))
    .map((def) => ({ merchantId: def.id, at: nextVisit(def, world.now) }))
    .sort((a, b) => a.at - b.at);
}

/** Record a purchase against the current visit. Keyed by item id — see `boughtRecord`. */
export function markBought(world: World, merchantId: string, entryId: string): void {
  getMerchant(merchantId);
  const dayNumber = dayStateAt(world.now).dayNumber;
  const record = world.merchantVisits[merchantId];

  if (!record || record.dayNumber !== dayNumber) {
    world.merchantVisits[merchantId] = { dayNumber, bought: { [entryId]: 1 } };
    return;
  }
  record.bought[entryId] = (record.bought[entryId] ?? 0) + 1;
}

export function addRelationship(world: World, merchantId: string, amount: number): void {
  world.merchantRelations[merchantId] = relationshipOf(world, merchantId) + amount;
}
