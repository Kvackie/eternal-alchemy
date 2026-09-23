/**
 * Merchants, ranks and equipment.
 *
 * The property that matters most here: presence and stock are derived from the
 * clock, not scheduled. That is what makes offline catch-up need no special
 * handling — so several of these tests are really about determinism.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { makeCaveTiles } from '@/sim/cave';
import { makePlots } from '@/sim/garden';
import { makeShelf } from '@/sim/market';
import { createWorld } from '@/sim/state';
import { config, getIngredient, getMerchant, ingredients, merchants, ranks } from '@/sim/config';
import { isPresent, nextVisit, presentMerchants, tierOf, visitsOn } from '@/sim/merchants';
import {
  canBuyEquipment,
  grantEquipment,
  derivedStats,
  rankIdFor,
  rankIndexFor,
  renownToNextRank,
} from '@/sim/progression';
import { getEquipment } from '@/sim/config';
import type { BottledItem, Grade } from '@/sim/types';

const DAY = config.clock.dayLengthMs;
const BRAMM = getMerchant('bramm');
const VESSA = getMerchant('vessa');
const ASHWALKER = getMerchant('ashwalker');

/** World time in the middle of the daylight stretch of a given day. */
const midday = (day: number) => day * DAY + DAY * 0.35;
/** World time in the middle of the night of a given day. */
const midnight = (day: number) => day * DAY + DAY * 0.85;

describe('merchant visits', () => {
  it('follow a fixed cycle off the day counter', () => {
    expect(visitsOn(BRAMM, 0)).toBe(true);
    expect(visitsOn(BRAMM, 1)).toBe(false);
    expect(visitsOn(BRAMM, 2)).toBe(true);

    expect(visitsOn(VESSA, 1)).toBe(true);
    expect(visitsOn(VESSA, 6)).toBe(true);
    expect(visitsOn(VESSA, 2)).toBe(false);
  });

  it('handles day zero and never goes negative on the modulo', () => {
    expect(() => visitsOn(ASHWALKER, 0)).not.toThrow();
    expect(visitsOn(ASHWALKER, 3)).toBe(true);
    expect(visitsOn(ASHWALKER, 11)).toBe(true);
  });

  it('keeps the day traders out of the night', () => {
    expect(isPresent(BRAMM, midday(0))).toBe(true);
    expect(isPresent(BRAMM, midnight(0))).toBe(false);
  });

  it('lets the Ashwalker keep night hours, and only night', () => {
    expect(isPresent(ASHWALKER, midnight(3))).toBe(true);
    expect(isPresent(ASHWALKER, midday(3))).toBe(false);
  });

  it('always points at a future visit', () => {
    for (const def of [BRAMM, VESSA, ASHWALKER]) {
      const now = midday(4) + 1234;
      expect(nextVisit(def, now)).toBeGreaterThan(now);
    }
  });
});

describe('merchant stock', () => {
  function worldAt(now: number): Simulation {
    const sim = new Simulation(createWorld(1));
    sim.advanceTo(now);
    return sim;
  }

  it('is empty when nobody is in town', () => {
    // Day 1 night: Bramm is a day trader on even days, Vessa a day trader,
    // and the Ashwalker only visits day 3 of his cycle.
    const sim = worldAt(midnight(1));
    expect(sim.merchants()).toHaveLength(0);
  });

  it('is identical for the same merchant on the same day', () => {
    const a = worldAt(midday(2)).merchants()[0]!;
    const b = worldAt(midday(2) + 60_000).merchants()[0]!;

    expect(a.merchantId).toBe(b.merchantId);
    expect(a.entries.map((e) => `${e.kind}:${e.id}`)).toEqual(
      b.entries.map((e) => `${e.kind}:${e.id}`),
    );
  });

  it('differs between visits', () => {
    const visits = [0, 2, 4, 6, 8, 10].map(
      (day) => worldAt(midday(day)).merchants()[0]?.entries.map((e) => e.id).join(',') ?? '',
    );
    expect(new Set(visits).size).toBeGreaterThan(1);
  });

  it('does not change the world just by being looked at', () => {
    // `presentMerchants` is what rendering calls, and rendering happens far
    // more often than anything else — a read that writes makes behaviour
    // depend on how many times a screen was drawn.
    const sim = new Simulation(createWorld(3));
    sim.advanceTo(midday(2));

    const before = JSON.stringify(sim.world);
    presentMerchants(sim.world);
    presentMerchants(sim.world);
    expect(JSON.stringify(sim.world)).toBe(before);
  });

  it('packs a trader on the tick that brings them into town', () => {
    const sim = new Simulation(createWorld(3));
    expect(sim.world.merchantVisits.bramm).toBeUndefined();

    sim.advanceTo(midday(2));
    const packed = sim.world.merchantVisits.bramm;
    expect(packed?.picks?.length).toBeGreaterThan(0);

    // And what is drawn is exactly what was packed.
    expect(sim.merchants()[0]!.entries.map((e) => e.id)).toEqual(packed!.picks);
  });

  it('does not re-deal the pack when something is bought out of it', () => {
    // The draw reads the world — which upgrades are owned, what rank you are —
    // and all of that moves while a trader is in town. Buying the one-off used
    // to take it out of the pool and re-deal everything else around it.
    const sim = new Simulation(createWorld(3));
    sim.advanceTo(midday(2));
    sim.world.gold = 500_000;
    sim.world.renown = 20_000;

    // Décor has no prerequisites, so it is the one-off that can always be
    // bought; an upgrade shown a rank early may still be waiting on another.
    const before = sim.merchants()[0]!;
    const upgrade = before.entries.findIndex((e) => e.kind === 'decor');
    expect(upgrade, 'this visit carries no one-off to buy').toBeGreaterThanOrEqual(0);

    expect(sim.buy(before.merchantId, upgrade).ok).toBe(true);

    const after = sim.merchants()[0]!;
    expect(after.entries.map((e) => `${e.kind}:${e.id}`)).toEqual(
      before.entries.map((e) => `${e.kind}:${e.id}`),
    );
    // The bought one is spent, and nothing else moved.
    expect(after.entries[upgrade]!.remaining).toBe(0);
  });

  it('re-deals on the next visit, not on this one', () => {
    const sim = new Simulation(createWorld(3));
    sim.advanceTo(midday(2));
    const first = sim.merchants()[0]!.entries.map((e) => e.id).join(',');

    sim.advanceTo(midday(2) + 90_000);
    expect(sim.merchants()[0]!.entries.map((e) => e.id).join(',')).toBe(first);

    // Two days on is Bramm's next visit, and that one is packed afresh.
    sim.advanceTo(midday(4));
    const second = sim.merchants()[0]!.entries.map((e) => e.id).join(',');
    expect(second).not.toBe(first);
  });

  it('survives a reload, because the pack travels with the save', () => {
    const original = worldAt(midday(2));
    const clone = new Simulation(JSON.parse(JSON.stringify(original.world)));

    expect(clone.merchants()[0]!.entries.map((e) => e.id)).toEqual(
      original.merchants()[0]!.entries.map((e) => e.id),
    );
  });

  it('names the next visit for merchants who are away', () => {
    const sim = worldAt(midday(2));
    const upcoming = sim.upcoming();
    expect(upcoming.length).toBeGreaterThan(0);
    for (const entry of upcoming) expect(entry.at).toBeGreaterThan(sim.now);
  });
});

describe('buying', () => {
  function atBramm(gold = 500): Simulation {
    const sim = new Simulation(createWorld(3));
    sim.advanceTo(midday(2));
    sim.world.gold = gold;
    return sim;
  }

  it('refuses when the merchant is not here', () => {
    const sim = new Simulation(createWorld(3));
    sim.advanceTo(midnight(1));
    expect(sim.buy('bramm', 0)).toEqual({ ok: false, reasonKey: 'market.error.gone' });
  });

  it('refuses when the purse is short', () => {
    const sim = atBramm(0);
    const result = sim.buy('bramm', 0);
    expect(result.ok).toBe(false);
    expect(result.reasonKey).toBe('market.error.gold');
  });

  it('takes gold, delivers the goods and builds standing', () => {
    const sim = atBramm();
    const entry = sim.merchants()[0]!.entries[0]!;
    const goldBefore = sim.world.gold;

    expect(sim.buy('bramm', 0).ok).toBe(true);
    expect(sim.world.gold).toBeLessThan(goldBefore);
    expect(sim.world.merchantRelations.bramm).toBeGreaterThan(0);
    expect(sim.world.log.some((e) => e.kind === 'bought')).toBe(true);
    void entry;
  });

  it('decrements the entry and eventually sells out', () => {
    const sim = atBramm(100000);
    const stock = sim.merchants()[0]!.entries[0]!.stock;

    for (let i = 0; i < stock; i += 1) {
      expect(sim.buy('bramm', 0).ok).toBe(true);
    }
    expect(sim.merchants()[0]!.entries[0]!.remaining).toBe(0);
    expect(sim.buy('bramm', 0)).toEqual({ ok: false, reasonKey: 'market.error.soldOut' });
  });

  it('restocks on the next visit', () => {
    const sim = atBramm(100000);
    const stock = sim.merchants()[0]!.entries[0]!.stock;
    for (let i = 0; i < stock; i += 1) sim.buy('bramm', 0);
    expect(sim.merchants()[0]!.entries[0]!.remaining).toBe(0);

    sim.advanceTo(midday(4));
    expect(sim.merchants()[0]!.entries[0]!.remaining).toBeGreaterThan(0);
  });

  it('discounts once a relationship tier is reached', () => {
    const cheap = atBramm(100000);
    cheap.world.merchantRelations.bramm = BRAMM.relationshipTiers[2]!;

    const plain = atBramm(100000);
    const tier = tierOf(BRAMM, cheap.world.merchantRelations.bramm);

    expect(tier).toBeGreaterThan(0);
    const discounted = cheap.merchants()[0]!.discount;
    expect(discounted).toBeGreaterThan(plain.merchants()[0]!.discount);
  });
});

describe('bartering with the Ashwalker', () => {
  function bottle(uid: string, grade: Grade, value: number): BottledItem {
    return {
      uid,
      recipeId: 'aquaTerra',
      grade,
      purity: 80,
      potencyTier: 'common',
      totalEssence: 57,
      fairValue: value,
      bottledAt: 0,
    };
  }

  function atAshwalker(): Simulation {
    const sim = new Simulation(createWorld(9));
    sim.advanceTo(midnight(3));
    return sim;
  }

  it('takes no gold at all', () => {
    const sim = atAshwalker();
    sim.world.gold = 100000;
    const visit = sim.merchants().find((v) => v.merchantId === 'ashwalker')!;
    expect(visit.currency).toBe('potions');
    for (const entry of visit.entries) expect(entry.barter).not.toBeNull();
  });

  it('refuses without enough qualifying bottles', () => {
    const sim = atAshwalker();
    const result = sim.buy('ashwalker', 0);
    expect(result.ok).toBe(false);
    expect(result.reasonKey).toBe('market.error.potions');
  });

  it('ignores bottles below the grade he asks for', () => {
    const sim = atAshwalker();
    const visit = sim.merchants().find((v) => v.merchantId === 'ashwalker')!;
    const index = visit.entries.findIndex((e) => e.barter && e.barter.minGrade !== 'F');
    const barter = visit.entries[index]!.barter!;

    // Fill the shelf with junk one grade below what he will take.
    for (let i = 0; i < 10; i += 1) sim.world.bottled.push(bottle(`bad-${i}`, 'F', 5));
    expect(sim.buy('ashwalker', index).ok).toBe(false);
    void barter;
  });

  it('spends the cheapest qualifying bottles first', () => {
    const sim = atAshwalker();
    const visit = sim.merchants().find((v) => v.merchantId === 'ashwalker')!;
    const index = visit.entries.findIndex((e) => e.barter !== null);

    sim.world.bottled.push(bottle('prize', 'S', 900));
    sim.world.bottled.push(bottle('cheap-a', 'B', 10));
    sim.world.bottled.push(bottle('cheap-b', 'B', 12));
    sim.world.bottled.push(bottle('cheap-c', 'B', 14));

    expect(sim.buy('ashwalker', index).ok).toBe(true);

    // The good bottle must survive: trading "some potions" should never quietly
    // hand over the best one.
    expect(sim.world.bottled.some((item) => item.uid === 'prize')).toBe(true);
    expect(sim.world.merchantRelations.ashwalker).toBeGreaterThan(0);
  });
});

describe('renown ranks', () => {
  it('derive from renown, and never disagree with it', () => {
    expect(rankIndexFor(0)).toBe(0);
    expect(rankIdFor(0)).toBe('apprentice');
    expect(rankIndexFor(60)).toBe(1);
    expect(rankIndexFor(59)).toBe(0);
    // Reads the track rather than a hardcoded top, so adding ranks cannot
    // silently stop this from testing the ceiling.
    expect(rankIndexFor(Number.MAX_SAFE_INTEGER)).toBe(ranks.length - 1);
  });

  it('has a strictly ascending renown track', () => {
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]!.renown).toBeGreaterThan(ranks[i - 1]!.renown);
    }
  });

  it('report the gap to the next rank, and nothing at the top', () => {
    expect(renownToNextRank(0)?.needed).toBe(60);
    expect(renownToNextRank(100000)).toBeNull();
  });

  it('are noticed the moment renown moves, not only on the next tick', () => {
    // Renown normally rises inside a sale, which sits inside `advanceTo`. This
    // covers the other doors into it — waiting for a tick leaves rank and
    // renown disagreeing, and a backgrounded tab makes that wait unbounded.
    const sim = new Simulation(createWorld(4));
    sim.grant({ renown: 200 });

    expect(sim.rankIndex).toBe(2);
    expect(sim.world.acknowledgedRank).toBe(2);
    expect(sim.world.log.filter((e) => e.kind === 'rankUp')).toHaveLength(2);
  });

  it('are announced once each, even across a long catch-up', () => {
    const sim = new Simulation(createWorld(4));
    sim.world.renown = 500;
    sim.advanceBy(1000);
    sim.advanceBy(1000);

    const promotions = sim.world.log.filter((e) => e.kind === 'rankUp');
    expect(promotions).toHaveLength(3);
    expect(new Set(promotions.map((e) => e.params.rank)).size).toBe(3);
  });
});

describe('equipment', () => {
  it('starts from the base stats with nothing owned', () => {
    const world = createWorld(1);
    const stats = derivedStats(world);
    expect(stats.plots).toBe(config.garden.startingPlots);
    expect(stats.shelves).toBe(config.shop.startingShelves);
  });

  it('stacks additive upgrades', () => {
    const world = createWorld(1);
    world.equipment = { plotFive: 1, plotSix: 1 };
    expect(derivedStats(world).plots).toBe(config.garden.startingPlots + 2);
  });

  // The cauldron upgrades used to be the example here; capacity moved onto the
  // pots themselves, so the shelf ladder stands in — same two gates.
  it('is gated by rank until the renown is there', () => {
    const world = createWorld(1);
    const def = getEquipment('shelfSix');
    expect(canBuyEquipment(world, def)).toBe(false);

    world.renown = 100000;
    world.equipment.shelfFive = 1;
    expect(canBuyEquipment(world, def)).toBe(true);
  });

  it('is gated by its prerequisites too', () => {
    const world = createWorld(1);
    world.renown = 100000;
    // Rank is satisfied; the missing shelfFive is what refuses it.
    expect(canBuyEquipment(world, getEquipment('shelfSix'))).toBe(false);
  });

  it('says an earlier upgrade is missing, not the rank, when that is the block', () => {
    const sim = new Simulation(createWorld(3));
    sim.world.gold = 100000;
    sim.world.renown = 100000;

    let found: { merchantId: string; index: number } | null = null;
    for (let day = 0; day < 40 && !found; day += 1) {
      sim.advanceTo(midday(day));
      for (const visit of sim.merchants()) {
        const index = visit.entries.findIndex((e) => e.id === 'plotSix');
        if (index >= 0) found = { merchantId: visit.merchantId, index };
      }
    }
    expect(found, 'no visit carried the sixth plot').not.toBeNull();

    // Rank is no obstacle at this renown; the missing fifth plot is.
    const result = sim.buy(found!.merchantId, found!.index);
    expect(result.ok).toBe(false);
    expect(result.reasonKey).toBe('market.reason.requires');
  });

  it('actually creates the plot when a plot upgrade is bought', () => {
    const sim = new Simulation(createWorld(3));
    sim.world.gold = 100000;
    sim.world.renown = 100000;

    // The first plot upgrade has no prerequisite; wait for a visit that carries it.
    let index = -1;
    for (let day = 0; day < 40 && index < 0; day += 2) {
      sim.advanceTo(midday(day));
      const visit = sim.merchants().find((v) => v.merchantId === 'bramm');
      index = visit?.entries.findIndex((e) => e.id === 'plotFive') ?? -1;
    }
    expect(index, 'Bramm never carried the fifth plot').toBeGreaterThanOrEqual(0);

    const before = sim.world.plots.length;
    expect(sim.buy('bramm', index).ok).toBe(true);
    expect(sim.world.plots.length).toBe(before + 1);
    expect(sim.world.plots.at(-1)!.crop).toBeNull();
  });

  /*
   * Capacity used to be an equipment upgrade. It belongs to the pot now, since
   * the shop owns several and a heavy blend should boil over in the starter
   * bowl even when a great pot is standing beside it.
   */
  it('gives a bought cauldron its own capacity, without touching the old one', () => {
    const sim = new Simulation(createWorld(3));
    sim.world.gold = 100_000;
    sim.world.renown = 250_000;

    const startingCapacity = sim.cauldronCapacity;
    const bought = sim.buyCauldron('cauldronFour')!;
    expect(bought).not.toBeNull();

    // Still showing the old pot, so the reading must not have moved.
    expect(sim.cauldronCapacity).toBe(startingCapacity);

    // A bought pot arrives in storage; it is not usable until it is put out.
    expect(bought.stored).toBe(true);
    expect(sim.setActiveCauldron(bought.id)).toBe(false);

    sim.setCauldronStored(bought.id, false);
    sim.setActiveCauldron(bought.id);
    expect(sim.cauldronCapacity).toBeGreaterThan(startingCapacity);
    // And it clears 300, which is what makes Sovereign brews possible at all.
    expect(sim.cauldronCapacity).toBeGreaterThanOrEqual(300);
  });

  it('adds pots rather than replacing them, so brews can run side by side', () => {
    const sim = new Simulation(createWorld(3));
    sim.world.gold = 100_000;
    sim.world.renown = 250_000;

    expect(sim.cauldrons).toHaveLength(1);
    const second = sim.buyCauldron('cauldronTwo')!;
    const third = sim.buyCauldron('cauldronTwo')!;

    // Bought into storage, so the workshop is unchanged until they are put out.
    expect(sim.cauldrons).toHaveLength(1);
    expect(sim.storedCauldrons).toHaveLength(2);

    sim.setCauldronStored(second.id, false);
    sim.setCauldronStored(third.id, false);
    expect(sim.cauldrons).toHaveLength(3);
    expect(new Set(sim.cauldrons.map((pot) => pot.id)).size).toBe(3);
  });

  /*
   * Storage takes a pot out of play, and refuses to lose a brew.
   *
   * The last pot on the bench cannot go away either — a workshop with nothing in
   * it is a screen with nothing to do and no way back to doing it.
   */
  it('puts pots away and brings them back, but never one that is busy', () => {
    const sim = new Simulation(createWorld(3));
    sim.world.gold = 100_000;
    sim.world.renown = 250_000;
    const spare = sim.buyCauldron('cauldronTwo')!;
    sim.setCauldronStored(spare.id, false);

    expect(sim.cauldrons).toHaveLength(2);
    expect(sim.setCauldronStored(spare.id, true)).toBe(true);
    expect(sim.cauldrons).toHaveLength(1);

    // The only pot left out stays out.
    const last = sim.cauldrons[0]!;
    expect(sim.setCauldronStored(last.id, true)).toBe(false);

    // And a pot with something in it stays out too.
    sim.setCauldronStored(spare.id, false);
    sim.setActiveCauldron(spare.id);
    sim.grant({ ingredient: { id: 'dewcap', count: 1 } });
    expect(sim.addToCauldron('dewcap')).toBe(true);
    expect(sim.setCauldronStored(spare.id, true)).toBe(false);
  });
});

describe('buying several at once', () => {
  /**
   * The bug this pins down.
   *
   * Buying N by calling `buy` N times re-derived every merchant's stock on each
   * unit, and a purchase that pushes a relationship past a tier boundary
   * regenerates that list — so the same index pointed at different goods half
   * way through. On day 1, with Vessa at 380 of a 400 threshold, asking for
   * three Glass Flasks at 10g bought two flasks and a Moonpetal, and charged
   * 47g for a basket the panel had priced at 30.
   */
  it('buys the entry that was chosen, not whatever lands at that index later', () => {
    const world = createWorld();
    world.now = midday(1);
    world.gold = 1_000_000;
    world.merchantRelations = { ...world.merchantRelations, vessa: 380 };
    const sim = new Simulation(world);

    const visit = sim.merchants().find((v) => v.merchantId === 'vessa')!;
    // Found rather than assumed: which slot a spore lands in is a roll over
    // Vessa's whole pool, and moves whenever anything is added to it.
    const index = visit.entries.findIndex((entry) => entry.kind === 'spore' && entry.remaining >= 3);
    expect(index).toBeGreaterThanOrEqual(0);
    const chosen = visit.entries[index]!;

    const unit = chosen.price ?? 0;
    const before = sim.world.gold;
    // The shop opens with a spore or two already, so count the change rather
    // than the total.
    const heldBefore = sim.world.spores[chosen.id] ?? 0;
    const { bought } = sim.buyQuantity('vessa', index, 3);

    expect(bought).toBe(3);
    // Charged for what was shown, at the price that was shown.
    expect(before - sim.world.gold).toBe(unit * 3);
    // And three of the thing itself arrived, not two and something else.
    expect((sim.world.spores[chosen.id] ?? 0) - heldBefore).toBe(3);
  });

  it('stops at the stock and reports nothing bought when it cannot start', () => {
    const world = createWorld();
    world.now = midday(4);
    world.gold = 1_000_000;
    const sim = new Simulation(world);
    const visit = sim.merchants().find((v) => v.merchantId === 'bramm')!;
    const index = visit.entries.findIndex((e) => !e.barter);
    const stock = visit.entries[index]!.remaining;

    expect(sim.buyQuantity('bramm', index, stock + 5).bought).toBe(stock);
    expect(sim.buyQuantity('bramm', index, 1)).toEqual({
      bought: 0,
      reasonKey: 'market.error.soldOut',
    });
  });

  it('will not spend gold the purse does not have', () => {
    const world = createWorld();
    world.now = midday(4);
    world.gold = 0;
    const sim = new Simulation(world);
    const visit = sim.merchants().find((v) => v.merchantId === 'bramm')!;
    const index = visit.entries.findIndex((e) => !e.barter && (e.price ?? 0) > 0);

    expect(sim.buyQuantity('bramm', index, 3)).toEqual({
      bought: 0,
      reasonKey: 'market.error.gold',
    });
    expect(sim.world.gold).toBe(0);
  });
});

describe('merchants by trade', () => {
  const sold = (kind: string) =>
    new Set(merchants.flatMap((m) => m.pool.filter((e) => e.kind === kind).map((e) => e.id)));

  // One way or another: a herb by its seed, a fungus by its spores, the rest
  // as themselves.
  it('carry every ingredient one way or another', () => {
    const seeds = sold('seed');
    const spores = sold('spore');
    const goods = sold('ingredient');
    const missing = ingredients.filter((ing) => {
      if (ing.category === 'herb') return !seeds.has(ing.id);
      if (ing.category === 'fungus') return !spores.has(ing.id);
      return !goods.has(ing.id);
    });
    expect(missing.map((ing) => ing.id)).toEqual([]);
  });

  it('keep one trade each', () => {
    const trade = (id: string) =>
      new Set(
        getMerchant(id)
          .pool.filter((e) => ['seed', 'spore', 'ingredient'].includes(e.kind))
          .map((e) => (e.kind === 'ingredient' ? getIngredient(e.id).category : e.kind)),
      );
    expect(trade('bramm')).toEqual(new Set(['seed']));
    expect(trade('vessa')).toEqual(new Set(['spore', 'mineral']));
    expect(trade('hesk')).toEqual(new Set(['mineral']));
    expect(trade('ashwalker')).toEqual(new Set(['exotic']));
  });

  it('sell exotics only for potions, and hold the rarest back for old friends', () => {
    const exotics = ASHWALKER.pool.filter((e) => e.kind === 'ingredient');
    expect(exotics.every((e) => e.barter !== undefined)).toBe(true);
    expect(Math.max(...exotics.map((e) => e.tier))).toBeGreaterThan(0);
  });

  /*
   * The rotation guarantee: however long the list, every trade good a merchant
   * will sell you turns up within a known number of visits.
   */
  it('show every trade good within a known number of visits', () => {
    for (const def of merchants) {
      const world = createWorld(1);
      world.merchantRelations[def.id] = def.relationshipTiers.at(-1)!;
      const trade = def.pool.filter((e) => ['seed', 'spore', 'ingredient'].includes(e.kind));
      const visits = Math.ceil(trade.length / def.rotation);

      const seen = new Set<string>();
      let day = def.offsetDays;
      for (let v = 0; v < visits; v += 1, day += def.cycleDays) {
        world.now = def.phase === 'day' ? midday(day) : midnight(day);
        world.merchantVisits = {};
        const visit = presentMerchants(world).find((m) => m.merchantId === def.id);
        for (const entry of visit?.entries ?? []) seen.add(entry.id);
      }
      const unseen = trade.filter((e) => !seen.has(e.id)).map((e) => e.id);
      expect(unseen, `${def.id} left these out for ${visits} visits`).toEqual([]);
    }
  });

  it('lay out a stall of eight to ten', () => {
    for (const def of merchants) {
      const staples = def.pool.filter((e) => !['seed', 'spore', 'ingredient'].includes(e.kind));
      const size = def.rotation + Math.min(def.picks, staples.length);
      expect(size, def.id).toBeGreaterThanOrEqual(8);
      expect(size, def.id).toBeLessThanOrEqual(10);
    }
  });
});

const makePlot = (i: number) => makePlots(i + 1)[i]!;

describe('buying ground', () => {
  // A save can hold more plots than its equipment accounts for — the
  // greenhouse's two beds outlived it — and a bed paid for must still appear.
  it('adds the plot a purchase grants, even past what the equipment counts', () => {
    const world = createWorld(1);
    world.plots.push(makePlot(world.plots.length), makePlot(world.plots.length + 1));
    const before = world.plots.length;

    grantEquipment(
      world,
      'plotFive',
      makePlot,
      (i) => makeShelf(i + 1)[i]!,
      (i) => makeCaveTiles(i + 1)[i]!,
    );
    expect(world.plots.length).toBe(before + 1);
  });
});
