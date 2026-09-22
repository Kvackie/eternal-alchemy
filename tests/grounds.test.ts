/**
 * The cave and the shaft — the two sources whose whole point is that they are
 * not the garden. The cave spreads on its own; the shaft depletes and deepens.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { caveConfig, crops, getEquipment, getIngredient, shaftConfig } from '@/sim/config';
import { isMature, maturityOf, neighboursOf, spreadChanceFor, tileAt } from '@/sim/cave';
import { isWorkable, veinsByDepth } from '@/sim/shaft';
import { countOf } from '@/sim/inventory';

const HOUR = 3_600_000;

describe('the cave', () => {
  function seeded(): Simulation {
    const sim = new Simulation(createWorld(21));
    sim.world.spores.dewcap = 5;
    sim.seedCaveTile(0, 'dewcap');
    return sim;
  }

  it('opens with a grid and a couple of spore clusters', () => {
    const sim = new Simulation(createWorld(1));
    expect(sim.cave.tiles).toHaveLength(caveConfig.startingTiles);
    expect(sim.world.spores.dewcap).toBeGreaterThan(0);
  });

  it('seeds a tile and spends the cluster', () => {
    const sim = seeded();
    expect(tileAt(sim.world, 0)?.speciesId).toBe('dewcap');
    expect(sim.world.spores.dewcap).toBe(4);
  });

  it('refuses to seed an occupied tile, or without a cluster', () => {
    const sim = seeded();
    expect(sim.seedCaveTile(0, 'dewcap')).toBe(false);

    sim.world.spores.gravecrown = 0;
    expect(sim.seedCaveTile(1, 'gravecrown')).toBe(false);
  });

  it('matures over time and then stops', () => {
    const sim = seeded();
    const tile = tileAt(sim.world, 0)!;
    expect(maturityOf(tile, sim.now)).toBe(0);

    sim.advanceBy(HOUR);
    expect(isMature(tileAt(sim.world, 0)!, sim.now)).toBe(true);
    expect(maturityOf(tileAt(sim.world, 0)!, sim.now)).toBe(1);
  });

  it('spreads to neighbouring tiles unattended', () => {
    const sim = seeded();
    sim.advanceBy(12 * HOUR);
    const colonised = sim.cave.tiles.filter((tile) => tile.speciesId !== null).length;
    expect(colonised).toBeGreaterThan(1);
  });

  it('only spreads to neighbours, never across the grid', () => {
    const width = caveConfig.width;
    expect(neighboursOf(0, 12).sort()).toEqual([1, width].sort());
    // The left edge does not wrap round to the right edge.
    expect(neighboursOf(width, 12)).not.toContain(width - 1);
  });

  it('lets light decide which species takes hold', () => {
    // Chalkgill wants light, Gravecrown wants dark; each is slowed in the wrong one.
    expect(spreadChanceFor('chalkgill', true)).toBeGreaterThan(spreadChanceFor('chalkgill', false));
    expect(spreadChanceFor('gravecrown', false)).toBeGreaterThan(
      spreadChanceFor('gravecrown', true),
    );
    // Dewcap does not care, which is why it is the starter.
    expect(spreadChanceFor('dewcap', true)).toBe(spreadChanceFor('dewcap', false));
  });

  it('harvests a mature tile and clears it', () => {
    const sim = seeded();
    sim.advanceBy(HOUR);

    const result = sim.harvestCaveTile(0);
    expect(result?.ingredientId).toBe('dewcap');
    expect(countOf(sim.world, 'dewcap')).toBe(caveConfig.yieldPerTile);
    expect(tileAt(sim.world, 0)?.speciesId).toBeNull();
  });

  it('will not harvest a tile that is still growing', () => {
    const sim = seeded();
    expect(sim.harvestCaveTile(0)).toBeNull();
  });

  it('keeps a trayed tile planted through a harvest', () => {
    const sim = seeded();
    sim.toggleCaveTray(0);
    sim.advanceBy(HOUR);

    expect(sim.harvestCaveTile(0)).not.toBeNull();
    // A tray pins the species, so the bed restarts rather than emptying.
    expect(tileAt(sim.world, 0)?.speciesId).toBe('dewcap');
  });

  it('runs the same whether watched or caught up offline', () => {
    const watched = new Simulation(createWorld(88));
    const away = new Simulation(createWorld(88));
    watched.world.spores.dewcap = 5;
    away.world.spores.dewcap = 5;
    watched.seedCaveTile(0, 'dewcap');
    away.seedCaveTile(0, 'dewcap');

    for (let i = 0; i < 24; i += 1) watched.advanceBy(HOUR, true);
    away.advanceBy(24 * HOUR, false);

    expect(away.cave.tiles.map((t) => t.speciesId)).toEqual(
      watched.cave.tiles.map((t) => t.speciesId),
    );
  });

  it('survives a very long absence without hanging', () => {
    const sim = seeded();
    const start = Date.now();
    sim.advanceBy(120 * 24 * HOUR, false);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

describe('the shaft', () => {
  function working(): Simulation {
    const sim = new Simulation(createWorld(33));
    const vein = sim.shaft.veins[0]!;
    sim.workVein(vein.id);
    return sim;
  }

  it('opens at its starting depth with veins to work', () => {
    const sim = new Simulation(createWorld(1));
    expect(sim.shaft.depth).toBe(shaftConfig.startingDepth);
    expect(sim.shaft.veins.length).toBeGreaterThan(0);
  });

  it('yields ore in batches while worked', () => {
    const sim = working();
    const ingredientId = sim.shaft.veins[0]!.ingredientId;

    sim.advanceBy(HOUR);
    expect(countOf(sim.world, ingredientId)).toBeGreaterThan(0);
    expect(sim.world.statistics.oreExtracted).toBeGreaterThan(0);
  });

  it('yields nothing while idle', () => {
    const sim = new Simulation(createWorld(33));
    sim.advanceBy(6 * HOUR);
    expect(sim.world.statistics.oreExtracted).toBe(0);
  });

  it('stamps ore as ageless, because stone does not wilt', () => {
    const sim = working();
    sim.advanceBy(HOUR);
    const stack = sim.world.inventory.find((entry) => entry.count > 0);
    expect(stack?.harvestedAt).toBeNull();
  });

  it('depletes the vein and stops on its own', () => {
    const sim = working();
    sim.advanceBy(48 * HOUR);

    expect(sim.shaft.veins[0]!.remaining).toBe(0);
    expect(sim.shaft.workingVeinId).toBeNull();
    expect(sim.shaft.veins[0]!.refillsAt).not.toBeNull();
  });

  it('regrows an exhausted vein rather than leaving dead content', () => {
    const sim = working();
    sim.advanceBy(48 * HOUR);
    const vein = sim.shaft.veins[0]!;
    expect(isWorkable(vein, sim.now)).toBe(false);

    sim.advanceBy(shaftConfig.veinRefillMs);
    expect(isWorkable(vein, sim.now)).toBe(true);

    expect(sim.workVein(vein.id)).toBe(true);
    expect(vein.remaining).toBe(vein.size);
  });

  it('will not deepen past what the supports allow', () => {
    const sim = new Simulation(createWorld(1));
    expect(sim.canDeepenShaft()).toBe(false);
    expect(sim.deepenShaft()).toBe(false);
  });

  it('deepens once supported, and finds new rock', () => {
    const sim = new Simulation(createWorld(1));
    sim.world.shaft.supportedDepth = 80;

    const before = sim.shaft.veins.length;
    expect(sim.deepenShaft()).toBe(true);
    expect(sim.shaft.depth).toBe(shaftConfig.startingDepth + shaftConfig.depthStep);
    expect(sim.shaft.veins.length).toBeGreaterThan(before);
  });

  it('keeps the same rock across a reload', () => {
    const original = new Simulation(createWorld(4242));
    const clone = new Simulation(JSON.parse(JSON.stringify(original.world)));
    expect(clone.shaft.veins.map((v) => v.id)).toEqual(original.shaft.veins.map((v) => v.id));
  });

  it('yields nullstone somewhere in the deepest seam a full set of beams reaches', () => {
    /*
     * Night Glass and the Wraithwind Vial are only brewable with pure Umbra, and
     * the shaft is its only source. The essence maths saying "reachable" means
     * nothing if the rock never actually offers it, so this checks the rock.
     *
     * Across seeds, because one vein among several at weight 3 is a draw, not a
     * guarantee — what matters is that a player gets there in reasonable time.
     */
    const maxSupported =
      shaftConfig.startingDepth +
      (getEquipment('supportBeams').repeatable ?? 1) *
        (getEquipment('supportBeams').effect.addSupportedDepth ?? 0);

    let seedsOfferingNullstone = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const sim = new Simulation(createWorld(seed));
      sim.world.shaft.supportedDepth = maxSupported;
      while (sim.canDeepenShaft()) sim.deepenShaft();

      if (sim.shaft.veins.some((vein) => vein.ingredientId === 'nullstone')) {
        seedsOfferingNullstone += 1;
      }
    }

    expect(
      seedsOfferingNullstone,
      'the deep seam rarely or never offers nullstone, which strands two recipes',
    ).toBeGreaterThan(20);
  });

  it('groups veins by depth for display, deepest first', () => {
    const sim = new Simulation(createWorld(1));
    sim.world.shaft.supportedDepth = 80;
    sim.deepenShaft();

    const groups = veinsByDepth(sim.world);
    expect(groups.length).toBe(2);
    expect(groups[0]!.depth).toBeGreaterThan(groups[1]!.depth);
  });
});

/**
 * Soil.
 *
 * Every crop declared one and every plot had one, and nothing compared them —
 * four interchangeable plots and a decorative field. These check the comparison
 * is real and that it stays a bonus rather than a punishment.
 */
describe('soil', () => {
  it('yields more from the ground a crop wants', () => {
    const suited = new Simulation(createWorld(5));
    const wrong = new Simulation(createWorld(5));

    // Dewcap wants silt. Plot 3 is silt, plot 1 is loam.
    const siltPlot = suited.world.plots.find((plot) => plot.soil === 'silt')!;
    const loamPlot = wrong.world.plots.find((plot) => plot.soil === 'loam')!;

    for (const sim of [suited, wrong]) sim.world.seeds.dewcap = 4;
    suited.plant(siltPlot.id, 'dewcap');
    wrong.plant(loamPlot.id, 'dewcap');
    for (const sim of [suited, wrong]) sim.advanceBy(60 * 60 * 1000);

    const good = suited.harvest(siltPlot.id)!;
    const bad = wrong.harvest(loamPlot.id)!;
    expect(good.count).toBe(bad.count + 1);
  });

  it('still grows in the wrong ground', () => {
    // A missed opportunity, never a punishment — the crop must still come up.
    const sim = new Simulation(createWorld(5));
    const loam = sim.world.plots.find((plot) => plot.soil === 'loam')!;
    sim.world.seeds.dewcap = 2;

    expect(sim.plant(loam.id, 'dewcap')).toBe(true);
    sim.advanceBy(60 * 60 * 1000);
    expect(sim.harvest(loam.id)!.count).toBeGreaterThan(0);
  });

  it('gives every crop a plot that suits it', () => {
    // A crop whose soil appears on no starting plot can never earn its bonus.
    const sim = new Simulation(createWorld(5));
    const soils = new Set(sim.world.plots.map((plot) => plot.soil));
    for (const crop of crops) {
      expect(soils.has(crop.soil), `nothing in the starting garden suits ${crop.id}`).toBe(true);
    }
  });
});

describe('the quarry', () => {
  it('every vein the shaft can roll is a real ingredient', () => {
    // A vein naming an ingredient that does not exist renders its own key.
    const sim = new Simulation(createWorld(7));
    for (const v of sim.world.shaft.veins) {
      expect(getIngredient(v.ingredientId), v.ingredientId).toBeTruthy();
    }
  });
});
