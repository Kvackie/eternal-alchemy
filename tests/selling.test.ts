/**
 * Selling ingredients back to merchants.
 *
 * A gold trader buys what they trade in — their own ingredients, and whatever
 * their seeds and spores grow — at a third of what they would charge a stranger
 * for it here, rounded down and never below a coin. Only while they are in town.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { crops, getMerchant, ingredients, merchants } from '@/sim/config';
import type { MerchantDef } from '@/sim/config';
import { countOf, addIngredient } from '@/sim/inventory';
import { sellPriceFor } from '@/sim/merchants';
import { DAY } from './helpers';

/** World time in the middle of the daylight stretch of a given day. */
const midday = (day: number) => day * DAY + DAY * 0.35;
/** World time in the middle of the night of a given day. */
const midnight = (day: number) => day * DAY + DAY * 0.85;

// Bramm is in on day 0, Vessa on day 1, Hesk on day 2; the Ashwalker on the
// night of day 3.
const WHEN: Record<string, number> = {
  bramm: midday(0),
  vessa: midday(1),
  hesk: midday(2),
  ashwalker: midnight(3),
};

function simAt(now: number, townId = 'mossvale'): Simulation {
  const world = createWorld(1);
  world.now = now;
  world.townId = townId;
  world.inventory = [];
  return new Simulation(world);
}

const byCategory = (category: string) =>
  ingredients.filter((def) => def.category === category).map((def) => def.id);

/** Every gold merchant that would buy this ingredient, in any town. */
const buyersOf = (ingredientId: string) => {
  const world = createWorld(1);
  return merchants
    .filter((def) => sellPriceFor(world, def, ingredientId) !== null)
    .map((def) => def.id);
};

describe('who buys what', () => {
  it('sends every herb to Bramm, and only to him', () => {
    for (const id of byCategory('herb')) expect(buyersOf(id), id).toEqual(['bramm']);
  });

  it('sends every fungus to Vessa, and only to her', () => {
    for (const id of byCategory('fungus')) expect(buyersOf(id), id).toEqual(['vessa']);
  });

  it('has exactly one buyer for every mineral, Vessa or Hesk', () => {
    for (const id of byCategory('mineral')) {
      const buyers = buyersOf(id);
      expect(buyers, id).toHaveLength(1);
      expect(['vessa', 'hesk']).toContain(buyers[0]);
    }
  });

  it('has no gold buyer for an exotic', () => {
    for (const id of byCategory('exotic')) expect(buyersOf(id), id).toEqual([]);
  });

  it('never has the Ashwalker buy anything', () => {
    const sim = simAt(WHEN.ashwalker!);
    const ashwalker = getMerchant('ashwalker');
    for (const def of ingredients) {
      expect(sellPriceFor(sim.world, ashwalker, def.id)).toBeNull();
      addIngredient(sim.world, def.id, 2, sim.now);
    }
    expect(sim.sellOffers('ashwalker')).toEqual([]);

    const gold = sim.world.gold;
    const result = sim.sellIngredient('ashwalker', 'bloodRose', 1);
    expect(result).toEqual({ sold: 0, gold: 0, reasonKey: 'market.sell.error.notWanted' });
    expect(sim.world.gold).toBe(gold);
    expect(countOf(sim.world, 'bloodRose')).toBe(2);
  });
});

describe('what they pay', () => {
  it('pays a third of the listed price, rounded down', () => {
    // Seeds at 12 and 16, a spore at 32, minerals at 36 and 64.
    const cases: Array<[string, string, number]> = [
      ['bramm', 'curlflame', 4],
      ['bramm', 'bluecoral', 5],
      ['vessa', 'azurecap', 10],
      ['vessa', 'chalkNodule', 12],
      ['hesk', 'rillQuartz', 21],
    ];
    for (const [merchantId, ingredientId, price] of cases) {
      const sim = simAt(WHEN[merchantId]!);
      expect(sim.sellPrice(merchantId, ingredientId), ingredientId).toBe(price);
    }
  });

  it('prices a herb off its seed, since nobody sells the herb itself', () => {
    const sim = simAt(WHEN.bramm!);
    const bramm = getMerchant('bramm');
    for (const crop of crops) {
      const seed = bramm.pool.find((item) => item.kind === 'seed' && item.id === crop.id)!;
      expect(sim.sellPrice('bramm', crop.yields)).toBe(Math.floor(seed.price! / 3));
    }
  });

  it('never pays less than a coin', () => {
    const world = createWorld(1);
    const cheap: MerchantDef = {
      ...getMerchant('bramm'),
      pool: [{ kind: 'seed', id: 'curlflame', price: 2, stock: 1, weight: 1, tier: 0 }],
    };
    expect(sellPriceFor(world, cheap, 'curlflame')).toBe(1);
  });

  it("moves with the town's price level, the way buying does", () => {
    // 36 × 1.35 = 48.6, charged at 49, bought back at 16.
    expect(simAt(WHEN.vessa!, 'highmarch').sellPrice('vessa', 'chalkNodule')).toBe(16);
    // 36 × 0.65 = 23.4, charged at 23, bought back at 7.
    expect(simAt(WHEN.vessa!, 'duskmoor').sellPrice('vessa', 'chalkNodule')).toBe(7);
  });

  it('is not lowered by a standing discount', () => {
    const sim = simAt(WHEN.hesk!);
    sim.world.merchantRelations.hesk = 1_000_000;
    expect(sim.merchants().find((visit) => visit.merchantId === 'hesk')!.discount).toBeGreaterThan(
      0,
    );
    expect(sim.sellPrice('hesk', 'rillQuartz')).toBe(21);
  });
});

describe('selling', () => {
  it('takes the oldest units first, pays for them, and writes it down', () => {
    const sim = simAt(WHEN.bramm!);
    const now = sim.now;
    addIngredient(sim.world, 'curlflame', 3, now - 3 * DAY);
    addIngredient(sim.world, 'curlflame', 2, now);
    const gold = sim.world.gold;

    const result = sim.sellIngredient('bramm', 'curlflame', 4);

    expect(result).toEqual({ sold: 4, gold: 16 });
    expect(sim.world.gold).toBe(gold + 16);
    expect(countOf(sim.world, 'curlflame')).toBe(1);
    // The one left is from the fresh batch.
    expect(sim.world.inventory).toEqual([
      { ingredientId: 'curlflame', count: 1, harvestedAt: now },
    ]);

    const entry = sim.world.log.at(-1)!;
    expect(entry.kind).toBe('soldIngredient');
    expect(entry.params).toEqual({
      ingredient: 'curlflame',
      merchant: 'bramm',
      count: 4,
      gold: 16,
    });
  });

  it('sells what is held when asked for more', () => {
    const sim = simAt(WHEN.hesk!);
    addIngredient(sim.world, 'rillQuartz', 2, null);
    const result = sim.sellIngredient('hesk', 'rillQuartz', 50);
    expect(result).toEqual({ sold: 2, gold: 42 });
    expect(countOf(sim.world, 'rillQuartz')).toBe(0);
  });

  it('earns no standing', () => {
    const sim = simAt(WHEN.vessa!);
    addIngredient(sim.world, 'chalkNodule', 10, null);
    sim.sellIngredient('vessa', 'chalkNodule', 10);
    expect(sim.world.merchantRelations.vessa ?? 0).toBe(0);
  });

  it('is refused when the merchant is not in town', () => {
    const sim = simAt(midnight(0));
    addIngredient(sim.world, 'curlflame', 3, sim.now);
    const gold = sim.world.gold;

    expect(sim.sellPrice('bramm', 'curlflame')).toBeNull();
    expect(sim.sellOffers('bramm')).toEqual([]);
    expect(sim.sellIngredient('bramm', 'curlflame', 1)).toEqual({
      sold: 0,
      gold: 0,
      reasonKey: 'market.error.gone',
    });
    expect(sim.world.gold).toBe(gold);
    expect(countOf(sim.world, 'curlflame')).toBe(3);
  });

  it('is refused for something not held', () => {
    const sim = simAt(WHEN.bramm!);
    const logged = sim.world.log.length;
    expect(sim.sellIngredient('bramm', 'curlflame', 1)).toEqual({
      sold: 0,
      gold: 0,
      reasonKey: 'market.sell.error.none',
    });
    expect(sim.world.log).toHaveLength(logged);
  });

  it('is refused for something the merchant does not deal in', () => {
    const sim = simAt(WHEN.hesk!);
    addIngredient(sim.world, 'curlflame', 3, sim.now);
    expect(sim.sellPrice('hesk', 'curlflame')).toBeNull();
    expect(sim.sellIngredient('hesk', 'curlflame', 1)).toEqual({
      sold: 0,
      gold: 0,
      reasonKey: 'market.sell.error.notWanted',
    });
    expect(countOf(sim.world, 'curlflame')).toBe(3);
  });

  it('offers only what is held and wanted, with the count held and the price', () => {
    const sim = simAt(WHEN.vessa!);
    addIngredient(sim.world, 'azurecap', 2, sim.now - DAY);
    addIngredient(sim.world, 'azurecap', 1, sim.now);
    addIngredient(sim.world, 'chalkNodule', 4, null);
    addIngredient(sim.world, 'curlflame', 5, sim.now);
    addIngredient(sim.world, 'bloodRose', 1, null);

    expect(sim.sellOffers('vessa')).toEqual([
      { ingredientId: 'azurecap', held: 3, price: 10 },
      { ingredientId: 'chalkNodule', held: 4, price: 12 },
    ]);
  });
});
