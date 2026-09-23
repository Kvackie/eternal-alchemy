/**
 * Yield boosters: one harvest doubled across a whole site, bought dear.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config, getBooster, ranks, shaftConfig } from '@/sim/config';
import { countOf } from '@/sim/inventory';
import { boosterBlock, isBoosted } from '@/sim/boosters';

const HOUR = 3_600_000;
const DAY = config.clock.dayLengthMs;

function planted(boost: boolean): { sim: Simulation; count: number } {
  const sim = new Simulation(createWorld(4));
  const plot = sim.world.plots[0]!;
  sim.world.seeds.curlflame = 2;
  sim.plant(plot.id, 'curlflame');
  if (boost) {
    sim.world.boosters.gardenTonic = 1;
    expect(sim.useBooster('gardenTonic')).toBe(true);
  }
  sim.advanceBy(HOUR);
  return { sim, count: sim.harvest(plot.id)!.count };
}

describe('yield boosters', () => {
  it('doubles the next garden harvest, once', () => {
    const plain = planted(false);
    const boosted = planted(true);
    expect(boosted.count).toBe(plain.count * getBooster('gardenTonic').yieldMultiplier);

    // Spent on that harvest: the same plot's next crop is ordinary again.
    const { sim } = boosted;
    const plot = sim.world.plots[0]!;
    sim.plant(plot.id, 'curlflame');
    sim.advanceBy(HOUR);
    expect(sim.harvest(plot.id)!.count).toBe(plain.count);
  });

  it('takes one at a time, and only if one is held', () => {
    const sim = new Simulation(createWorld(4));
    sim.world.seeds.curlflame = 1;
    sim.plant(sim.world.plots[0]!.id, 'curlflame');
    expect(sim.useBooster('gardenTonic')).toBe(false);

    sim.world.boosters.gardenTonic = 2;
    expect(sim.useBooster('gardenTonic')).toBe(true);
    expect(isBoosted(sim.world, 'garden')).toBe(true);
    expect(sim.useBooster('gardenTonic')).toBe(false);
    expect(sim.world.boosters.gardenTonic).toBe(1);
  });

  it('doubles the next picking of a cave bed', () => {
    const pick = (boost: boolean) => {
      const sim = new Simulation(createWorld(5));
      sim.world.spores.azurecap = 1;
      sim.seedCaveTile(0, 'azurecap');
      if (boost) {
        sim.world.boosters.caveTonic = 1;
        sim.useBooster('caveTonic');
      }
      sim.advanceBy(DAY * 4);
      return sim.harvestCaveTile(0)?.count ?? 0;
    };
    const plain = pick(false);
    expect(plain).toBeGreaterThan(0);
    expect(pick(true)).toBe(plain * getBooster('caveTonic').yieldMultiplier);
  });

  it('doubles what a vein brings up without draining it faster', () => {
    const run = (boost: boolean) => {
      const sim = new Simulation(createWorld(33));
      const vein = sim.shaft.veins[0]!;
      sim.workVein(vein.id);
      if (boost) {
        sim.world.boosters.mineTonic = 1;
        sim.useBooster('mineTonic');
      }
      const before = vein.remaining;
      sim.advanceBy(HOUR);
      return { mined: countOf(sim.world, vein.ingredientId), taken: before - vein.remaining };
    };
    const plain = run(false);
    const boosted = run(true);
    expect(boosted.taken).toBe(plain.taken);
    expect(boosted.mined).toBeGreaterThan(plain.mined);
  });

  it('is not spent on a site with nothing going', () => {
    const sim = new Simulation(createWorld(4));
    sim.world.boosters.gardenTonic = 1;
    sim.world.boosters.caveTonic = 1;
    sim.world.boosters.mineTonic = 1;
    sim.world.cave.tiles.forEach((tile) => (tile.speciesId = null));

    expect(boosterBlock(sim.world, 'gardenTonic')).toBe('booster.idle.garden');
    expect(sim.useBooster('gardenTonic')).toBe(false);
    expect(sim.useBooster('caveTonic')).toBe(false);
    expect(sim.useBooster('mineTonic')).toBe(false);
    expect(sim.world.boosters).toEqual({ gardenTonic: 1, caveTonic: 1, mineTonic: 1 });
  });

  it('marks only the veins being worked, so the next charge is not refused for good', () => {
    const sim = new Simulation(createWorld(7));
    const [worked, idle] = sim.shaft.veins;
    sim.world.boosters.mineTonic = 2;
    sim.workVein(worked!.id);
    expect(sim.useBooster('mineTonic')).toBe(true);
    expect(worked!.boosted).toBe(true);
    expect(idle!.boosted).toBeUndefined();

    // Spent on the worked vein's next batch; the idle one never held it up.
    sim.advanceBy(shaftConfig.batchTickMs);
    expect(sim.shaft.workingVeinIds).toEqual([worked!.id]);
    expect(isBoosted(sim.world, 'mine')).toBe(false);
    expect(boosterBlock(sim.world, 'mineTonic')).toBeNull();
  });

  it('is not held up by a mark left on something that stopped', () => {
    const sim = new Simulation(createWorld(7));
    const vein = sim.shaft.veins[0]!;
    sim.world.boosters.mineTonic = 2;
    sim.workVein(vein.id);
    sim.useBooster('mineTonic');
    sim.stopVein(vein.id);

    // Called off before its batch: the mark is left, but nothing is producing
    // under it, so a crew sent elsewhere can take the next charge.
    const other = sim.shaft.veins[1]!;
    sim.workVein(other.id);
    expect(sim.useBooster('mineTonic')).toBe(true);
    expect(vein.boosted).toBeUndefined();
    expect(other.boosted).toBe(true);
  });

  it('is always on the stall from Distiller, at its catalogue price', () => {
    const world = createWorld(3);
    world.gold = 100_000;
    world.renown = ranks[getBooster('gardenTonic').requiresRank]!.renown;
    world.bottledKinds['S|5|sovereign'] = true;
    const sim = new Simulation(world);

    for (const day of [0, 2, 4, 6]) {
      sim.advanceTo(day * DAY + DAY * 0.35);
      const bramm = sim.merchants().find((visit) => visit.merchantId === 'bramm')!;
      const index = bramm.entries.findIndex((entry) => entry.id === 'gardenTonic');
      expect(index, `day ${day}`).toBeGreaterThanOrEqual(0);
    }

    const bramm = sim.merchants().find((visit) => visit.merchantId === 'bramm')!;
    const index = bramm.entries.findIndex((entry) => entry.id === 'gardenTonic');
    expect(sim.buy('bramm', index).ok).toBe(true);
    expect(sim.world.boosters.gardenTonic).toBe(1);
  });

  it('is refused below its rank', () => {
    const world = createWorld(3);
    world.gold = 100_000;
    world.renown = ranks[getBooster('gardenTonic').requiresRank - 1]!.renown;
    world.bottledKinds['S|5|sovereign'] = true;
    const sim = new Simulation(world);
    sim.advanceTo(DAY * 0.35);
    const bramm = sim.merchants().find((visit) => visit.merchantId === 'bramm')!;
    const index = bramm.entries.findIndex((entry) => entry.id === 'gardenTonic');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(sim.buy('bramm', index).reasonKey).toBe('market.reason.rank');
  });
});
