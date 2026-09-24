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
import {
  config,
  findBooster,
  findCrop,
  findDecor,
  findEquipment,
  getMerchant,
  merchants,
} from './config';
import type { MerchantDef, MerchantStockDef } from './config';
import { hashKey, Rng } from './rng';
import { rankOf } from './progression';
import { onlyForTheCounter } from './decor';
import { WALK_INS_PAUSED } from './haggle';
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
  return (((dayNumber - def.offsetDays) % cycle) + cycle) % cycle === 0;
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

/**
 * A stable per-visit seed, so the same visit always stocks the same goods.
 *
 * Deliberately not the world's: the staples it draws — upgrades, boards,
 * furnishings — are the same on the same day in every shop.
 */
function visitSeed(merchantId: string, dayNumber: number): number {
  return hashKey(`${merchantId}:${dayNumber}`);
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
 * What this visit is carrying, and what it costs.
 *
 * A pack is dealt once, when the trader arrives — see `packArrivals`. The draw
 * reads the world: which upgrades you already own, what rank you are, what
 * your standing with this trader is. All three move while a trader is in town,
 * and buying the cauldron is exactly what takes it out of the pool, so dealing
 * again on the next look handed a player who bought one thing four different
 * other things.
 *
 * The prices are worked out here every time, because a discount earned during
 * a visit should apply to what is still on the shelf.
 */
function generateEntries(
  world: World,
  def: MerchantDef,
  dayNumber: number,
  tier: number,
): StockEntry[] {
  const packed = packedFor(world, def.id, dayNumber);

  /*
   * A pack nobody has recorded yet is dealt but not kept.
   *
   * That is a save from before packs were recorded, or a visit being looked at
   * between arriving and the next tick. Drawing without writing keeps this a
   * read — the tick is what makes it permanent, a frame later at the outside.
   */
  const chosen = packed ? fromPicks(def, packed) : drawPicks(world, def, dayNumber, tier);
  return priceEntries(world, def, dayNumber, tier, chosen);
}

/**
 * The goods behind a list of remembered ids.
 *
 * An id that has since left the pool — a content edit between sessions — drops
 * out rather than taking the rest of the pack with it.
 */
function fromPicks(def: MerchantDef, picks: string[]): MerchantStockDef[] {
  const byId = new Map(def.pool.map((item) => [item.id, item]));
  return picks.map((id) => byId.get(id)).filter((item) => item !== undefined);
}

/** Seeds, spores and ingredients: what a merchant is known for. */
const TRADE_KINDS: ReadonlySet<MerchantStockDef['kind']> = new Set(['seed', 'spore', 'ingredient']);

/**
 * A merchant's trade goods in this world's order.
 *
 * Every world used to deal them in the order the data lists them, so every
 * shop saw the same seeds on the same days. The order is shuffled once per
 * world, from its seed, and never again: it is still a fixed round, so the
 * promise below holds, but it is this world's round.
 */
function tradeOrder(world: World, def: MerchantDef): MerchantStockDef[] {
  const trade = def.pool.filter((item) => TRADE_KINDS.has(item.kind));
  // The world's seed, not `rngSeed`: that is the shared stream, which moves
  // on every tick and would reshuffle the round at every visit.
  const rng = new Rng(hashKey(`${world.seed}:${def.id}`));
  for (let i = trade.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [trade[i], trade[j]] = [trade[j]!, trade[i]!];
  }
  return trade;
}

/**
 * This visit's share of the merchant's trade, dealt round the list in order.
 *
 * A weighted draw over sixty seeds could leave one unseen for a season. Dealing
 * them in turn — visit n starts where visit n − 1 stopped — means a player who
 * wants a particular one knows it is at most a few visits away. Shuffled before
 * the tier filter, so goods a deeper tier opens slot into the round without
 * reordering what was already there.
 */
function rotationPicks(
  world: World,
  def: MerchantDef,
  dayNumber: number,
  tier: number,
): MerchantStockDef[] {
  const trade = tradeOrder(world, def).filter((item) => item.tier <= tier);
  if (trade.length === 0 || def.rotation <= 0) return [];
  if (trade.length <= def.rotation) return trade;

  const visit = Math.floor((dayNumber - def.offsetDays) / Math.max(1, def.cycleDays));
  const start = (((visit * def.rotation) % trade.length) + trade.length) % trade.length;
  return Array.from({ length: def.rotation }, (_, i) => trade[(start + i) % trade.length]!);
}

/**
 * Deal a pack: this visit's turn of the trade goods, then staples drawn
 * without replacement from everything the player's relationship tier and rank
 * have opened up. Equipment already owned is filtered out before the draw, so a
 * full set of upgrades never crowds out the staples.
 */
function drawPicks(
  world: World,
  def: MerchantDef,
  dayNumber: number,
  tier: number,
): MerchantStockDef[] {
  const rng = new Rng(visitSeed(def.id, dayNumber));
  const rank = rankOf(world);

  const pool = def.pool.filter((item) => {
    if (TRADE_KINDS.has(item.kind) || item.always) return false;
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

    // A piece that only works at the counter does nothing while walk-ins are
    // paused, so it is not sold until they come back.
    if (item.kind === 'decor' && WALK_INS_PAUSED && onlyForTheCounter(findDecor(item.id)!)) {
      return false;
    }

    /*
     * Only the next step of a ladder, never the ones after it.
     *
     * Plots five to twelve are one ladder, and every rung was in the draw at
     * once: the stall's one equipment slot went to a seventh plot the shop could
     * not buy while the fifth, which it could, turned up a few times a season.
     */
    if (equipmentDef?.requires?.some((id) => (world.equipment[id] ?? 0) <= 0)) return false;

    const owned =
      item.kind === 'equipment'
        ? (world.equipment[item.id] ?? 0)
        : (world.decorOwned[item.id] ?? 0);
    const limit = equipmentDef?.repeatable ?? 1;
    return owned < limit;
  });

  /*
   * Stratified draw over the staples: one kind at a time, round-robin,
   * weighted within the kind, so a visit always looks like a shop rather than
   * five of one thing. The trade goods are dealt separately, in turn — see
   * `rotationPicks`.
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

  /*
   * What is always on the stall: the site boosters, from a rank before they
   * can be bought, so a shop sees what it is working towards.
   */
  const always = def.pool.filter((item) => {
    if (!item.always || item.tier > tier) return false;
    const booster = item.kind === 'booster' ? findBooster(item.id) : undefined;
    return !booster || rank >= booster.requiresRank - 1;
  });

  const chosen: MerchantStockDef[] = [...rotationPicks(world, def, dayNumber, tier), ...always];
  const picks = chosen.length + Math.min(def.picks, pool.length);

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

  return chosen;
}

/** What the dealt goods cost, which is read fresh every time. */
function priceEntries(
  world: World,
  def: MerchantDef,
  dayNumber: number,
  tier: number,
  chosen: MerchantStockDef[],
): StockEntry[] {
  const bought = boughtRecord(world, def.id, dayNumber);
  const discount = tier * def.discountPerTier;
  // Hollowreach trades cheap and Highmarch does not; the town moves every price.
  const townPrice = merchantPriceMultiplier(world);

  return chosen.map((item, index) => {
    // A one-off purchase is always a single unit, whatever the pool says. Trade
    // goods come in quantity, and deeper the better you know the trader.
    const oneOff = item.kind === 'equipment' || item.kind === 'decor';
    const listed = item.stock ?? 1;
    const trade = TRADE_KINDS.has(item.kind)
      ? config.merchantStock.tradeMultiplier + config.merchantStock.perTier * tier
      : 1;
    const stock = oneOff ? 1 : Math.round(listed * trade);

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
          : item.kind === 'booster'
            ? findBooster(item.id)?.cost
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

/** The ids this visit was packed with, if it has been packed. */
function packedFor(world: World, merchantId: string, dayNumber: number): string[] | undefined {
  const record = world.merchantVisits[merchantId];
  if (!record || record.dayNumber !== dayNumber) return undefined;
  return record.picks;
}

/**
 * Pack whoever has just arrived.
 *
 * Called from the tick rather than from the draw, because the draw is read by
 * rendering and rendering must not change the world — a screen that writes as
 * it draws is one whose behaviour depends on how often it is looked at.
 *
 * Idempotent: a merchant already packed for today is left alone, and a record
 * from another day is replaced wholesale, which is also what clears the
 * purchases made against it.
 */
export function packArrivals(world: World): void {
  const day = dayStateAt(world.now);

  for (const def of merchants) {
    if (!isPresent(def, world.now)) continue;
    if (packedFor(world, def.id, day.dayNumber)) continue;

    const tier = tierOf(
      def,
      relationshipOf(world, def.id),
      codexBonuses(world).startingMerchantTier,
    );
    world.merchantVisits[def.id] = {
      dayNumber: day.dayNumber,
      bought: {},
      picks: drawPicks(world, def, day.dayNumber, tier).map((item) => item.id),
    };
  }
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

/**
 * Who is in town and until when — `presentMerchants` without the stock.
 *
 * Pricing a visit's goods is the expensive half of that function, and a caller
 * asking only whether the cast has changed, every frame, has no use for it.
 */
export function presentCast(world: World): Array<{ merchantId: string; leavesAt: number }> {
  return merchants
    .filter((def) => isPresent(def, world.now))
    .map((def) => ({ merchantId: def.id, leavesAt: windowEnd(def, world.now) }));
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
        ? day * dayMs +
          (config.clock.phases.find((p) => p.id === 'night')?.startFraction ?? 0.75) * dayMs
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

/*
 * -- Selling to a merchant ---------------------------------------------------
 *
 * A trader who takes gold also buys back what they trade in: the ingredients on
 * their stall, and the herb or mushroom that grows from a seed or spore on it.
 * So Bramm takes herbs, Vessa fungi and the upper quarry's minerals, and Hesk
 * the lower quarry's. The Ashwalker takes no gold and so pays none; nobody
 * who does carries an exotic, so nobody buys one.
 *
 * The rule reads the whole pool rather than this visit's pack, and ignores
 * standing tiers: what a trader deals in is a fact about the trader, not about
 * which handful of goods they happened to bring today.
 */

/**
 * The listed price a merchant puts on an ingredient, or on what grows it.
 *
 * A seed is matched by the crop it yields and a spore by its species, which
 * shares the mushroom's id. Undefined when the merchant does not deal in it,
 * or deals in it for potions.
 */
function listedPriceFor(def: MerchantDef, ingredientId: string): number | undefined {
  if (def.currency !== 'gold') return undefined;
  for (const item of def.pool) {
    if (item.barter || item.price === undefined) continue;
    const grows =
      (item.kind === 'ingredient' && item.id === ingredientId) ||
      (item.kind === 'spore' && item.id === ingredientId) ||
      (item.kind === 'seed' && findCrop(item.id)?.yields === ingredientId);
    if (grows) return item.price;
  }
  return undefined;
}

/**
 * What a merchant pays for one unit of an ingredient, or null if they do not
 * buy it.
 *
 * A fixed fraction of what they would charge a stranger for it here — the
 * listed price under the town's price level, before any standing discount,
 * since being a regular should not make what you bring worth less. Freshness
 * does not enter into it. Rounded down, never below a coin.
 */
export function sellPriceFor(world: World, def: MerchantDef, ingredientId: string): number | null {
  const listed = listedPriceFor(def, ingredientId);
  if (listed === undefined) return null;
  const charged = Math.max(1, Math.round(listed * merchantPriceMultiplier(world)));
  return Math.max(1, Math.floor(charged / config.economy.ingredientSellDivisor));
}

export interface SellOffer {
  ingredientId: string;
  /** Units held, every freshness stage together. */
  held: number;
  /** Gold per unit. */
  price: number;
}

/** What this merchant would buy from the store room right now, by name. */
export function sellOffers(world: World, def: MerchantDef): SellOffer[] {
  const held = new Map<string, number>();
  for (const stack of world.inventory) {
    if (stack.count <= 0) continue;
    held.set(stack.ingredientId, (held.get(stack.ingredientId) ?? 0) + stack.count);
  }

  const offers: SellOffer[] = [];
  for (const [ingredientId, count] of held) {
    const price = sellPriceFor(world, def, ingredientId);
    if (price !== null) offers.push({ ingredientId, held: count, price });
  }
  return offers.sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));
}
