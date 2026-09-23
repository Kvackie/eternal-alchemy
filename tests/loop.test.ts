/**
 * The vertical slice, end to end: plant, harvest, brew, distil, bottle, sell.
 * If this test passes, M1's promise holds.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config, getCrop } from '@/sim/config';
import { countOf } from '@/sim/inventory';

const HOUR = 3_600_000;

/** Accept whatever is in the pot and let it finish. */
function brew(sim: Simulation): void {
  sim.acceptBrew();
  sim.finishAllTimers();
}

describe('garden', () => {
  it('plants only with a seed in hand', () => {
    const sim = new Simulation(createWorld(1));
    const plot = sim.world.plots[0]!;
    sim.world.seeds.sunleaf = 0;
    expect(sim.plant(plot.id, 'sunleaf')).toBe(false);

    sim.world.seeds.sunleaf = 1;
    expect(sim.plant(plot.id, 'sunleaf')).toBe(true);
    expect(sim.world.seeds.sunleaf).toBe(0);
  });

  it('will not harvest before the crop is ready', () => {
    const sim = new Simulation(createWorld(1));
    const plot = sim.world.plots[0]!;
    sim.plant(plot.id, 'sunleaf');
    expect(sim.harvest(plot.id)).toBeNull();
  });

  it('yields more from a plot on the soil its crop wants', () => {
    // Tending is gone, so soil is the whole of what a plot decides. The same
    // seed on anything but the soil it wants gives one unit less.
    const suited = new Simulation(createWorld(1));
    const wrong = new Simulation(createWorld(1));
    suited.world.seeds.sunleaf = 1;
    wrong.world.seeds.sunleaf = 1;

    const a = suited.world.plots[0]!;
    const b = wrong.world.plots[0]!;
    const wanted = getCrop('sunleaf').soil;
    a.soil = wanted;
    b.soil = wanted === 'ash' ? 'silt' : 'ash';
    expect(b.soil).not.toBe(a.soil);

    suited.plant(a.id, 'sunleaf');
    wrong.plant(b.id, 'sunleaf');
    suited.advanceBy(HOUR);
    wrong.advanceBy(HOUR);

    const suitedYield = suited.harvest(a.id)!.count;
    const wrongYield = wrong.harvest(b.id)!.count;

    expect(wrongYield).toBeGreaterThan(0);
    expect(suitedYield).toBeGreaterThan(wrongYield);
  });

  it('rolls for seeds once per unit harvested, not once per plot', () => {
    // A per-plot roll caps recovery at 1; per-unit can return more than one.
    const sim = new Simulation(createWorld(99));
    let best = 0;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const plot = sim.world.plots[0]!;
      sim.world.seeds.sunleaf = 5;
      sim.plant(plot.id, 'sunleaf');
      sim.advanceBy(HOUR);
      best = Math.max(best, sim.harvest(plot.id)!.seeds);
    }

    expect(best).toBeGreaterThan(1);
  });

  it('keeps the garden roughly self-sustaining over many harvests', () => {
    // Planting costs 1 seed; a 4-unit harvest at 25% returns ~1. The
    // garden should not drain to nothing, which is what a per-plot roll would do.
    const sim = new Simulation(createWorld(2468));
    const plot = sim.world.plots[0]!;
    let planted = 0;
    let recovered = 0;

    for (let cycle = 0; cycle < 200; cycle += 1) {
      sim.world.seeds.sunleaf = 5;
      if (!sim.plant(plot.id, 'sunleaf')) break;
      planted += 1;
      sim.advanceBy(HOUR);
      recovered += sim.harvest(plot.id)!.seeds;
    }

    expect(planted).toBe(200);
    expect(recovered / planted).toBeGreaterThan(0.75);
  });

  it('records harvests and seed finds in the log', () => {
    const sim = new Simulation(createWorld(7));
    const plot = sim.world.plots[0]!;
    sim.plant(plot.id, 'bluepetal');
    sim.advanceBy(HOUR);
    sim.harvest(plot.id);

    const kinds = sim.world.log.map((entry) => entry.kind);
    expect(kinds).toContain('planted');
    expect(kinds).toContain('harvested');
  });
});

describe('cauldron', () => {
  function withBluecones(count: number): Simulation {
    const sim = new Simulation(createWorld(2));
    sim.grant({ ingredient: { id: 'bluecone', count } });
    return sim;
  }

  it('moves units from stores into the cauldron and back', () => {
    const sim = withBluecones(3);
    expect(sim.addToCauldron('bluecone')).toBe(true);
    expect(countOf(sim.world, 'bluecone')).toBe(2);

    sim.removeFromCauldron(0);
    expect(countOf(sim.world, 'bluecone')).toBe(3);
    expect(sim.cauldron.contents.units).toHaveLength(0);
  });

  it('refuses to add an ingredient that is not in stores', () => {
    const sim = new Simulation(createWorld(2));
    expect(sim.addToCauldron('bluecone')).toBe(false);
  });

  it('spends the freshness stage the player pointed at, not the oldest batch', () => {
    const sim = new Simulation(createWorld(2));

    // An old batch that has dried out, and a fresh one picked just now. Dewcap
    // is a fungus, so drying it out takes twice the herb schedule.
    sim.grant({ ingredient: { id: 'bluecone', count: 4 } });
    sim.advanceBy(config.freshness.freshUntilMs * 2 + HOUR, false);
    sim.grant({ ingredient: { id: 'bluecone', count: 4 } });

    expect(countOf(sim.world, 'bluecone', 'dried')).toBe(4);
    expect(countOf(sim.world, 'bluecone', 'dewfresh')).toBe(4);

    expect(sim.addToCauldron('bluecone', 'dewfresh')).toBe(true);

    // A dried unit is weaker, so taking the wrong batch changes the brew — the
    // tile has to spend what it says it will.
    expect(countOf(sim.world, 'bluecone', 'dewfresh')).toBe(3);
    expect(countOf(sim.world, 'bluecone', 'dried')).toBe(4);
  });

  it('will not take a stage it has none of', () => {
    const sim = new Simulation(createWorld(2));
    sim.grant({ ingredient: { id: 'bluecone', count: 2 } });
    expect(sim.addToCauldron('bluecone', 'dried')).toBe(false);
    expect(sim.addToCauldron('bluecone', 'dewfresh')).toBe(true);
  });

  /*
   * Drying weakens a brew; it does not redirect it.
   *
   * This test used to assert the opposite — that a dried herb identifies as
   * some *other* recipe, because drying moved Aqua into Terra and walked the
   * blend out of its cone. That rule is gone. Age is one multiplier now, so the
   * same three bluecones make the same potion at every stage, only weaker.
   */
  it('makes a weaker version of the same thing from dried bluecones', () => {
    const fresh = new Simulation(createWorld(5));
    fresh.grant({ ingredient: { id: 'bluecone', count: 3 } });
    for (let i = 0; i < 3; i += 1) fresh.addToCauldron('bluecone', 'dewfresh');
    expect(fresh.assess()!.recipeId).toBe('aqua');

    const dried = new Simulation(createWorld(5));
    dried.grant({ ingredient: { id: 'bluecone', count: 3 } });
    dried.advanceBy(config.freshness.freshUntilMs + HOUR, false);
    for (let i = 0; i < 3; i += 1) dried.addToCauldron('bluecone', 'dried');

    expect(dried.assess()!.recipeId).toBe('aqua');
    expect(dried.assess()!.totalEssence).toBeLessThan(fresh.assess()!.totalEssence);
  });

  it('respects the ingredient count limit', () => {
    // The limit belongs to the pot on the bench, not to the game — a bigger
    // cauldron takes more.
    const sim = withBluecones(40);
    for (let i = 0; i < sim.cauldronMaxIngredients; i += 1) {
      expect(sim.addToCauldron('bluecone')).toBe(true);
    }
    expect(sim.addToCauldron('bluecone')).toBe(false);
  });

  it('assesses a three-bluecone brew as the Aqua potion', () => {
    const sim = withBluecones(3);
    sim.addToCauldron('bluecone');
    sim.addToCauldron('bluecone');
    sim.addToCauldron('bluecone');

    const outcome = sim.assess()!;
    expect(outcome.recipeId).toBe('aqua');
    expect(outcome.potencyTier).toBe('minor');

    // 8 each × 3 is 24, well inside the starter pot's 60.
    expect(outcome.overCapacity).toBe(false);
  });
});

describe('bottling and shelf', () => {
  /** An exact Aqua–Terra brew — bilberry and broadleaf are 16 of one each. */
  function readyToBottle(): Simulation {
    const sim = new Simulation(createWorld(303));
    sim.grant({ ingredient: { id: 'bilberry', count: 1 } });
    sim.grant({ ingredient: { id: 'broadleaf', count: 1 } });
    sim.addToCauldron('bilberry');
    sim.addToCauldron('broadleaf');
    brew(sim);
    return sim;
  }

  it('bottles in one press and clears the pot', () => {
    const sim = readyToBottle();
    const item = sim.bottlePending();

    expect(item).not.toBeNull();
    expect(sim.cauldron.pendingBrew).toBeNull();
    expect(sim.world.bottled).toHaveLength(1);
    expect(item!.fairValue).toBeGreaterThan(0);
  });

  it('bottles a brew of any potency', () => {
    const sim = readyToBottle();
    sim.cauldron.pendingBrew!.potencyTier = 'sovereign';
    expect(sim.bottlePending()?.potencyTier).toBe('sovereign');
  });

  it('moves a bottled item onto the shelf and back', () => {
    const sim = readyToBottle();
    const item = sim.bottlePending()!;

    expect(sim.stock('shelf-1', item.uid)).toBe(true);
    expect(sim.world.bottled).toHaveLength(0);
    expect(sim.world.shelf[0]?.item?.uid).toBe(item.uid);

    expect(sim.unstock('shelf-1')).toBe(true);
    expect(sim.world.bottled).toHaveLength(1);
  });

  it('clamps the price slider to a sane range', () => {
    const sim = readyToBottle();
    sim.setPrice('shelf-1', 99);
    expect(sim.world.shelf[0]!.priceRatio).toBe(2);
    sim.setPrice('shelf-1', 0);
    expect(sim.world.shelf[0]!.priceRatio).toBe(0.4);
  });
});

describe('the whole loop', () => {
  it('runs plant to payday', () => {
    const sim = new Simulation(createWorld(2024));
    const plot = sim.world.plots[0]!;

    sim.plant(plot.id, 'bluepetal');
    sim.advanceBy(HOUR);
    sim.harvest(plot.id);

    while (sim.addToCauldron('bluepetal')) {
      if (sim.cauldron.contents.units.length >= 3) break;
    }

    expect(sim.assess()?.recipeId).toBe('aqua');

    brew(sim);
    expect(sim.pendingBrew?.recipeId).toBe('aqua');

    const item = sim.bottlePending()!;
    sim.stock('shelf-1', item.uid);
    sim.setPrice('shelf-1', 0.8);

    const goldBefore = sim.world.gold;
    sim.advanceBy(24 * HOUR, false);

    expect(sim.world.gold).toBeGreaterThan(goldBefore);
    expect(sim.world.statistics.itemsSold).toBe(1);
    expect(sim.world.unreadSales).toHaveLength(1);
  });
});
