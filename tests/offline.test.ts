/**
 * The tests that matter most: offline catch-up must produce exactly what live
 * play would have produced, and must be reproducible from a seed. This is the
 * whole reason the sim core is headless.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config } from '@/sim/config';
import type { BottledItem, World } from '@/sim/types';

const MINUTE = 60_000;
const HOUR = 3_600_000;

function stockedWorld(seed = 12345): World {
  const world = createWorld(seed);
  world.gold = 0;
  const item: BottledItem = {
    uid: 'test-item',
    recipeId: 'aquaTerra',
    grade: 'B',
    purity: 80,
    potencyTier: 'common',
    totalEssence: 57,
    fairValue: 30,
    bottledAt: 0,
  };
  const slot = world.shelf[0];
  if (slot) slot.item = item;
  return world;
}

describe('advanceTo', () => {
  it('never moves time backwards, whatever the device clock says', () => {
    const sim = new Simulation(createWorld(1));
    sim.advanceTo(10 * HOUR);
    const before = sim.now;
    sim.advanceTo(HOUR);
    expect(sim.now).toBe(before);
  });

  it('is deterministic for a given seed', () => {
    const a = new Simulation(stockedWorld(999));
    const b = new Simulation(stockedWorld(999));
    a.advanceBy(6 * HOUR, false);
    b.advanceBy(6 * HOUR, false);
    expect(a.world.gold).toBe(b.world.gold);
    expect(a.world.statistics.itemsSold).toBe(b.world.statistics.itemsSold);
  });

  it('produces different outcomes for different seeds', () => {
    const results = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const sim = new Simulation(stockedWorld(seed));
      sim.advanceBy(2 * HOUR, false);
      results.add(sim.world.gold);
    }
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('offline catch-up', () => {
  it('runs the same loop as live play, only at lower footfall', () => {
    const online = new Simulation(stockedWorld(4242));
    const offline = new Simulation(stockedWorld(4242));

    online.advanceBy(12 * HOUR, true);
    offline.advanceBy(12 * HOUR, false);

    // Same code path, same seed: presence changes the odds, not the mechanism.
    expect(online.world.statistics.itemsSold).toBeGreaterThanOrEqual(
      offline.world.statistics.itemsSold,
    );
  });

  it('is uncapped — three weeks away still pays out', () => {
    const sim = new Simulation(stockedWorld(7));
    sim.advanceBy(21 * 24 * HOUR, false);
    expect(sim.world.gold).toBeGreaterThan(0);
  });

  it('handles an enormous delta without hanging', () => {
    const sim = new Simulation(stockedWorld(7));
    const start = Date.now();
    sim.advanceBy(365 * 24 * HOUR, false);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('reports what happened while away', () => {
    const world = stockedWorld(31337);
    world.lastSeenRealTime = 1_000_000;
    const sim = new Simulation(world);

    const summary = sim.resume(1_000_000 + 8 * HOUR);

    expect(summary.awayMs).toBe(8 * HOUR);
    expect(summary.goldEarned).toBe(sim.world.gold);
    expect(sim.world.lastSeenRealTime).toBe(1_000_000 + 8 * HOUR);
  });

  it('finishes crops that matured while away and stamps them fresh on harvest', () => {
    const sim = new Simulation(createWorld(5));
    const plot = sim.world.plots[0];
    expect(plot).toBeDefined();

    sim.plant(plot!.id, 'bluepetal');
    sim.advanceBy(48 * HOUR, false);

    const result = sim.harvest(plot!.id);
    expect(result).not.toBeNull();

    // Harvest stamps the current world time, so a crop that finished two days ago
    // is Dewfresh when picked, not stale on arrival.
    const stack = sim.world.inventory.find((s) => s.ingredientId === 'bluepetal');
    expect(stack?.harvestedAt).toBe(sim.now);
  });
});

describe('market tick accounting', () => {
  it('advances lastMarketTick in whole ticks only', () => {
    const sim = new Simulation(stockedWorld(11));
    sim.advanceBy(config.market.tickMs * 3.5, false);
    expect(sim.world.lastMarketTick % config.market.tickMs).toBe(0);
    expect(sim.world.lastMarketTick).toBeLessThanOrEqual(sim.now);
  });

  it('does not sell from an empty shelf', () => {
    const sim = new Simulation(createWorld(3));
    sim.advanceBy(24 * HOUR, false);
    expect(sim.world.statistics.itemsSold).toBe(0);
  });

  it('sells faster when priced below fair value', () => {
    const cheap = new Simulation(stockedWorld(808));
    const dear = new Simulation(stockedWorld(808));
    cheap.setPrice('shelf-1', 0.7);
    dear.setPrice('shelf-1', 1.6);

    cheap.advanceBy(30 * MINUTE, true);
    dear.advanceBy(30 * MINUTE, true);

    expect(cheap.world.statistics.itemsSold).toBeGreaterThanOrEqual(
      dear.world.statistics.itemsSold,
    );
  });
});

describe('a catch-up and the same time played', () => {
  /** Eight bottles out and a hero on the road, the shop someone walks away from. */
  function busyShop(): Simulation {
    const world = stockedWorld(77);
    const template = world.shelf[0]!.item!;
    world.shelf.forEach((slot, i) => {
      slot.item = { ...template, uid: `stock-${i}` };
      slot.quantity = 1;
    });
    world.gold = 100_000;
    const sim = new Simulation(world);
    sim.recruitHero('corin');
    sim.send('emberwaste', ['corin'], []);
    return sim;
  }

  it('sells the same and brings the party home with the same haul', () => {
    const played = busyShop();
    for (let t = 0; t < 72 * 60; t += 1) played.advanceBy(MINUTE, false);
    const away = busyShop();
    away.advanceBy(72 * HOUR, false);

    expect(away.world.gold).toBe(played.world.gold);
    expect(away.world.statistics.itemsSold).toBe(played.world.statistics.itemsSold);
    expect(away.world.pendingClaims.map((claim) => claim.found)).toEqual(
      played.world.pendingClaims.map((claim) => claim.found),
    );
  });
});
