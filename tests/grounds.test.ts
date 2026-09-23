/**
 * The cave and the shaft — the two sources whose whole point is that they are
 * not the garden. The cave spreads on its own; the shaft depletes and deepens.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import {
  caveConfig,
  crops,
  getEquipment,
  getIngredient,
  ingredients,
  shaftConfig,
} from '@/sim/config';
import { isMature, maturityOf, neighboursOf, spreadChanceFor, tileAt } from '@/sim/cave';
import { isWorkable, veinsByDepth } from '@/sim/shaft';
import { addIngredient, countOf } from '@/sim/inventory';
import { veinTitle } from '@/ui/dom/panels/grounds';
import type { ShaftVein } from '@/sim/types';

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
    expect(sim.world.spores.azurecap).toBeGreaterThan(0);
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

  it('moves its one crew to a new vein, and works two with a second crew', () => {
    const sim = new Simulation(createWorld(33));
    const [a, b] = sim.shaft.veins;
    expect(b).toBeDefined();

    sim.workVein(a!.id);
    sim.workVein(b!.id);
    expect(sim.shaft.workingVeinIds).toEqual([b!.id]);

    sim.world.equipment.secondCrew = 1;
    sim.workVein(a!.id);
    expect([...sim.shaft.workingVeinIds].sort()).toEqual([a!.id, b!.id].sort());

    const before = [a!.remaining, b!.remaining];
    sim.advanceBy(HOUR);
    expect(a!.remaining).toBeLessThan(before[0]!);
    expect(b!.remaining).toBeLessThan(before[1]!);
  });

  it('opens at the surface with veins to work, and the first metres free to dig', () => {
    const sim = new Simulation(createWorld(1));
    expect(sim.shaft.depth).toBe(0);
    expect(sim.world.shaft.supportedDepth).toBe(shaftConfig.startingDepth);
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

  it('stacks every batch of an exotic, since it never ages either', () => {
    const world = createWorld(1);
    const exotic = ingredients.find((ing) => ing.category === 'exotic')!;
    addIngredient(world, exotic.id, 1, 0);
    addIngredient(world, exotic.id, 2, 10 * HOUR);
    const stacks = world.inventory.filter((stack) => stack.ingredientId === exotic.id);
    expect(stacks).toEqual([{ ingredientId: exotic.id, count: 3, harvestedAt: null }]);
  });

  it('depletes the vein and stops on its own', () => {
    const sim = working();
    sim.advanceBy(48 * HOUR);

    expect(sim.shaft.veins[0]!.remaining).toBe(0);
    expect(sim.shaft.workingVeinIds).toEqual([]);
    expect(sim.shaft.veins[0]!.refillsAt).not.toBeNull();
  });

  it('starts the refill when the vein ran dry, however long the catch-up', () => {
    const live = working();
    for (let i = 0; i < 48 * 60; i += 1) live.advanceBy(60_000);
    const away = working();
    away.advanceBy(48 * HOUR, false);

    const refill = (sim: Simulation) => sim.shaft.veins[0]!.refillsAt!;
    // Live play notices on the minute; a catch-up knows the exact batch.
    expect(Math.abs(refill(away) - refill(live))).toBeLessThanOrEqual(60_000);
  });

  it('regrows an exhausted vein rather than leaving dead content', () => {
    const sim = working();
    const vein = sim.shaft.veins[0]!;
    while (vein.remaining > 0) sim.advanceBy(60_000);
    expect(isWorkable(vein, sim.now)).toBe(false);

    sim.advanceBy(shaftConfig.veinRefillMs);
    expect(isWorkable(vein, sim.now)).toBe(true);

    expect(sim.workVein(vein.id)).toBe(true);
    expect(vein.remaining).toBe(vein.size);
  });

  it('will not deepen past what the supports allow', () => {
    const sim = new Simulation(createWorld(1));
    while (sim.canDeepenShaft()) sim.deepenShaft();
    expect(sim.shaft.depth).toBe(shaftConfig.startingDepth);
    expect(sim.deepenShaft()).toBe(false);
  });

  it('deepens once supported, and finds new rock', () => {
    const sim = new Simulation(createWorld(1));
    sim.world.shaft.supportedDepth = 80;

    const before = sim.shaft.veins.length;
    expect(sim.deepenShaft()).toBe(true);
    expect(sim.shaft.depth).toBe(shaftConfig.depthStep);
    expect(sim.shaft.veins.length).toBeGreaterThan(before);
  });

  it('keeps the same rock across a reload', () => {
    const original = new Simulation(createWorld(4242));
    const clone = new Simulation(JSON.parse(JSON.stringify(original.world)));
    expect(clone.shaft.veins.map((v) => v.id)).toEqual(original.shaft.veins.map((v) => v.id));
  });

  it('turns up every mineral somewhere a full set of beams reaches', () => {
    /*
     * The essence maths saying "reachable" means nothing if the rock never
     * actually offers it, so this checks the rock. Across seeds, because a vein
     * among several is a draw, not a guarantee — what matters is that a player
     * digging all the way down meets every mineral in reasonable odds.
     */
    const maxSupported =
      shaftConfig.startingDepth +
      (getEquipment('supportBeams').repeatable ?? 1) *
        (getEquipment('supportBeams').effect.addSupportedDepth ?? 0);

    const seen = new Map<string, number>();
    const SEEDS = 40;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const sim = new Simulation(createWorld(seed));
      sim.world.shaft.supportedDepth = maxSupported;
      while (sim.canDeepenShaft()) sim.deepenShaft();
      for (const id of new Set(sim.shaft.veins.map((vein) => vein.ingredientId))) {
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }

    const rare = ingredients
      .filter((ing) => ing.category === 'mineral')
      .filter((ing) => (seen.get(ing.id) ?? 0) < SEEDS / 2)
      .map((ing) => `${ing.id} in ${seen.get(ing.id) ?? 0} of ${SEEDS}`);
    expect(rare, 'these minerals seldom or never surface').toEqual([]);
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

    for (const sim of [suited, wrong]) sim.world.seeds.bluepetal = 4;
    suited.plant(siltPlot.id, 'bluepetal');
    wrong.plant(loamPlot.id, 'bluepetal');
    for (const sim of [suited, wrong]) sim.advanceBy(60 * 60 * 1000);

    const good = suited.harvest(siltPlot.id)!;
    const bad = wrong.harvest(loamPlot.id)!;
    expect(good.count).toBe(bad.count + 1);
  });

  it('still grows in the wrong ground', () => {
    // A missed opportunity, never a punishment — the crop must still come up.
    const sim = new Simulation(createWorld(5));
    const loam = sim.world.plots.find((plot) => plot.soil === 'loam')!;
    sim.world.seeds.bluepetal = 2;

    expect(sim.plant(loam.id, 'bluepetal')).toBe(true);
    sim.advanceBy(60 * 60 * 1000);
    expect(sim.harvest(loam.id)!.count).toBeGreaterThan(0);
  });

  it('destroys a crop for nothing, ready or not', () => {
    // No ingredient, no seed back — not even the one it was planted from —
    // or pulling a bed up would be a free undo of planting it.
    for (const ripen of [false, true]) {
      const sim = new Simulation(createWorld(5));
      const plot = sim.world.plots[0]!;
      sim.world.seeds.bluepetal = 2;
      sim.plant(plot.id, 'bluepetal');
      if (ripen) sim.advanceBy(HOUR);

      const seeds = sim.world.seeds.bluepetal;
      const held = countOf(sim.world, 'bluepetal');
      const harvested = sim.world.statistics.cropsHarvested;

      expect(sim.destroyCrop(plot.id)).toBe(true);
      expect(plot.crop).toBeNull();
      expect(sim.world.seeds.bluepetal).toBe(seeds);
      expect(countOf(sim.world, 'bluepetal')).toBe(held);
      expect(sim.world.statistics.cropsHarvested).toBe(harvested);
      expect(sim.world.log.at(-1)?.kind).toBe('cropDestroyed');
    }
  });

  it('has nothing to destroy in an empty bed', () => {
    const sim = new Simulation(createWorld(5));
    expect(sim.destroyCrop(sim.world.plots[0]!.id)).toBe(false);
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
  const vein = (ingredientId: string, id: string): ShaftVein => ({
    id,
    ingredientId,
    depth: 20,
    batch: 1,
    size: 10,
    remaining: 10,
    refillsAt: null,
    nextBatchAt: null,
  });

  /*
   * A panel, under test.
   *
   * This could not be written until the DOM layer stopped importing Phaser: a
   * panel module pulled in the canvas engine, which wants a `window`, so every
   * rule about how a panel words something was only checkable in a browser.
   */
  it('numbers seams only when a stratum repeats an ingredient', () => {
    // Two rows reading the same name, each with its own size and its own Work
    // it, are two seams a player cannot tell apart.
    const veins = [vein('cloudJasper', 'a'), vein('barkOpal', 'b'), vein('cloudJasper', 'c')];
    const seen = new Map<string, number>();
    for (const v of veins) seen.set(v.ingredientId, (seen.get(v.ingredientId) ?? 0) + 1);
    const ordinal = new Map<string, number>();

    const titles = veins.map((v) => veinTitle(v, seen, ordinal));
    expect(titles[0]).toMatch(/seam 1$/);
    expect(titles[2]).toMatch(/seam 2$/);
    expect(titles[1]).not.toMatch(/seam/);
  });

  it('every vein the shaft can roll is a real ingredient', () => {
    // A vein naming an ingredient that does not exist renders its own key.
    const sim = new Simulation(createWorld(7));
    for (const v of sim.world.shaft.veins) {
      expect(getIngredient(v.ingredientId), v.ingredientId).toBeTruthy();
    }
  });
});
