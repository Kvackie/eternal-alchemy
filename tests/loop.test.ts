/**
 * The vertical slice, end to end: plant, harvest, brew, distil, bottle, sell.
 * If this test passes, M1's promise holds.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { availableForms, availableVessels } from '@/sim/bottling';
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
    // Tending is gone, so soil is the whole of what a plot decides. Sunleaf
    // wants loam; the same seed on anything else gives one unit less.
    const suited = new Simulation(createWorld(1));
    const wrong = new Simulation(createWorld(1));

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
      sim.world.seeds.dewcap = 5;
      sim.plant(plot.id, 'dewcap');
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
      sim.world.seeds.dewcap = 5;
      if (!sim.plant(plot.id, 'dewcap')) break;
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
    sim.plant(plot.id, 'dewcap');
    sim.advanceBy(HOUR);
    sim.harvest(plot.id);

    const kinds = sim.world.log.map((entry) => entry.kind);
    expect(kinds).toContain('planted');
    expect(kinds).toContain('harvested');
  });
});

describe('cauldron', () => {
  function withDewcaps(count: number): Simulation {
    const sim = new Simulation(createWorld(2));
    sim.grant({ ingredient: { id: 'dewcap', count } });
    return sim;
  }

  it('moves units from stores into the cauldron and back', () => {
    const sim = withDewcaps(3);
    expect(sim.addToCauldron('dewcap')).toBe(true);
    expect(countOf(sim.world, 'dewcap')).toBe(2);

    sim.removeFromCauldron(0);
    expect(countOf(sim.world, 'dewcap')).toBe(3);
    expect(sim.cauldron.contents.units).toHaveLength(0);
  });

  it('refuses to add an ingredient that is not in stores', () => {
    const sim = new Simulation(createWorld(2));
    expect(sim.addToCauldron('dewcap')).toBe(false);
  });

  it('spends the freshness stage the player pointed at, not the oldest batch', () => {
    const sim = new Simulation(createWorld(2));

    // An old batch that has dried out, and a fresh one picked just now. Dewcap
    // is a fungus, so drying it out takes twice the herb schedule.
    sim.grant({ ingredient: { id: 'dewcap', count: 4 } });
    sim.advanceBy(config.freshness.freshUntilMs * 2 + HOUR, false);
    sim.grant({ ingredient: { id: 'dewcap', count: 4 } });

    expect(countOf(sim.world, 'dewcap', 'dried')).toBe(4);
    expect(countOf(sim.world, 'dewcap', 'dewfresh')).toBe(4);

    expect(sim.addToCauldron('dewcap', 'dewfresh')).toBe(true);

    // A dried unit is weaker, so taking the wrong batch changes the brew — the
    // tile has to spend what it says it will.
    expect(countOf(sim.world, 'dewcap', 'dewfresh')).toBe(3);
    expect(countOf(sim.world, 'dewcap', 'dried')).toBe(4);
  });

  it('will not take a stage it has none of', () => {
    const sim = new Simulation(createWorld(2));
    sim.grant({ ingredient: { id: 'dewcap', count: 2 } });
    expect(sim.addToCauldron('dewcap', 'dried')).toBe(false);
    expect(sim.addToCauldron('dewcap', 'dewfresh')).toBe(true);
  });

  /*
   * Drying weakens a brew; it does not redirect it.
   *
   * This test used to assert the opposite — that dried dewcaps identify as some
   * *other* recipe, because drying moved Aqua into Terra and walked the blend
   * out of the Health Tonic's cone. That rule is gone. Age is one multiplier
   * now, so the same three dewcaps make the same potion at every stage, weaker
   * and eventually a tier lower.
   */
  it('makes a weaker version of the same thing from dried dewcaps', () => {
    const fresh = new Simulation(createWorld(5));
    fresh.grant({ ingredient: { id: 'dewcap', count: 3 } });
    for (let i = 0; i < 3; i += 1) fresh.addToCauldron('dewcap', 'dewfresh');
    expect(fresh.assess()!.recipeId).toBe('aquaTerra');

    const dried = new Simulation(createWorld(5));
    dried.grant({ ingredient: { id: 'dewcap', count: 3 } });
    // Dewcap is a fungus, and fungus keeps twice as long, so the herb schedule
    // would leave this stock still Fresh.
    dried.advanceBy(config.freshness.freshUntilMs * 2 + HOUR, false);
    for (let i = 0; i < 3; i += 1) dried.addToCauldron('dewcap', 'dried');

    expect(dried.assess()!.recipeId).toBe('aquaTerra');
    expect(dried.assess()!.totalEssence).toBeLessThan(fresh.assess()!.totalEssence);
  });

  it('respects the ingredient count limit', () => {
    // The limit belongs to the pot on the bench, not to the game — a bigger
    // cauldron takes more.
    const sim = withDewcaps(40);
    for (let i = 0; i < sim.cauldronMaxIngredients; i += 1) {
      expect(sim.addToCauldron('dewcap')).toBe(true);
    }
    expect(sim.addToCauldron('dewcap')).toBe(false);
  });

  it('assesses a three-dewcap brew as the Aqua–Terra potion', () => {
    const sim = withDewcaps(3);
    sim.addToCauldron('dewcap');
    sim.addToCauldron('dewcap');
    sim.addToCauldron('dewcap');

    const outcome = sim.assess()!;
    expect(outcome.recipeId).toBe('aquaTerra');
    expect(outcome.potencyTier).toBe('minor');

    // 17 each × 3 × the 1.1 dewfresh multiplier is 56.1, inside the starter
    // pot's 60. At 1.2 it came to 61.2 and the opening brew was capped.
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

  it('offers the tincture for an aqua-heavy brew', () => {
    const sim = readyToBottle();
    const forms = availableForms(sim.pendingBrew!);
    expect(forms.find((f) => f.formId === 'potion')?.available).toBe(true);
    expect(forms.find((f) => f.formId === 'tincture')?.available).toBe(true);
  });

  it('blocks a vessel that cannot hold the brew, with a reason', () => {
    const sim = readyToBottle();
    sim.cauldron.pendingBrew!.potencyTier = 'grand';
    const vessels = availableVessels(sim.world, sim.pendingBrew!);
    const clay = vessels.find((v) => v.vesselId === 'clayVial');
    expect(clay?.available).toBe(false);
    expect(clay?.reasonKey).toBe('workbench.reason.vesselCap');
  });

  it('bottles, consumes the vessel, and clears the workbench', () => {
    const sim = readyToBottle();
    const before = sim.world.vessels.clayVial ?? 0;

    const item = sim.bottlePending({
      formId: 'potion',
      vesselId: 'clayVial',
      sealId: 'cork',
    });

    expect(item).not.toBeNull();
    expect(sim.world.vessels.clayVial).toBe(before - 1);
    expect(sim.cauldron.pendingBrew).toBeNull();
    expect(item!.fairValue).toBeGreaterThan(0);
  });

  it('never runs out of cork, so bottling is always possible', () => {
    const sim = readyToBottle();
    sim.world.seals.cork = 0;
    expect(
      sim.bottlePending({ formId: 'potion', vesselId: 'clayVial', sealId: 'cork' }),
    ).not.toBeNull();
  });

  it('prices a wax-sealed flask above a corked vial', () => {
    const a = readyToBottle();
    const b = readyToBottle();
    const plain = a.bottlePending({ formId: 'potion', vesselId: 'clayVial', sealId: 'cork' })!;
    const fancy = b.bottlePending({
      formId: 'potion',
      vesselId: 'glassFlask',
      sealId: 'waxRibbon',
    })!;
    expect(fancy.fairValue).toBeGreaterThan(plain.fairValue);
  });

  it('moves a bottled item onto the shelf and back', () => {
    const sim = readyToBottle();
    const item = sim.bottlePending({ formId: 'potion', vesselId: 'clayVial', sealId: 'cork' })!;

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

    sim.plant(plot.id, 'dewcap');
    sim.advanceBy(HOUR);
    sim.harvest(plot.id);

    while (sim.addToCauldron('dewcap')) {
      if (sim.cauldron.contents.units.length >= 3) break;
    }

    expect(sim.assess()?.recipeId).toBe('aquaTerra');

    brew(sim);
    expect(sim.pendingBrew?.recipeId).toBe('aquaTerra');

    const item = sim.bottlePending({
      formId: 'potion',
      vesselId: 'clayVial',
      sealId: 'waxRibbon',
    })!;
    sim.stock('shelf-1', item.uid);
    sim.setPrice('shelf-1', 0.8);

    const goldBefore = sim.world.gold;
    sim.advanceBy(24 * HOUR, false);

    expect(sim.world.gold).toBeGreaterThan(goldBefore);
    expect(sim.world.statistics.itemsSold).toBe(1);
    expect(sim.world.unreadSales).toHaveLength(1);
  });
});
