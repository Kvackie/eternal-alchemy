/**
 * A shop at full tilt.
 *
 * Every other test checks a rule; this one checks that the rules still hold
 * when there is a lot of everything. A late-game shop is 25 beds in the ground,
 * fifty shelves on the wall and a hundred bottles moving through them, and the
 * failures that scale brings — quadratic lookups, a day that takes a second to
 * tick, a shelf that stops taking stock — do not show up at four plots and six
 * shelves.
 *
 * Note that 25 plots is deliberately PAST `garden.maxPlots`, which is 16, and
 * past the 8 that equipment can actually reach. The point is to know what
 * happens above the ceiling before the ceiling is ever raised.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config, crops, getRecipe, ingredients, realRecipes, shelfTiers, vessels } from '@/sim/config';
import { assessOutcome } from '@/sim/brewing';
import { makePlots } from '@/sim/garden';
import { makeShelf } from '@/sim/market';
import { availableForms, availableSeals, availableVessels } from '@/sim/bottling';
import type { BottleRequest } from '@/sim/bottling';
import { addVectors, angleBetween, zeroVector } from '@/sim/essences';
import type { BrewMethod, EssenceVector, Grade, World } from '@/sim/types';

const HOUR = 3_600_000;
const PLOTS = 25;
const SHELVES = 50;
const POTIONS = 100;

/**
 * A blend that lands in a recipe's cone.
 *
 * Greedy: repeatedly add whichever ingredient most reduces the angle to the
 * target. Not the cheapest blend a player would find, but a real one — these
 * are ingredients that exist, added through the real cauldron.
 */
function blendFor(target: EssenceVector, cap = 7): string[] {
  const chosen: string[] = [];
  let sum = zeroVector();
  let best = Infinity;

  for (let step = 0; step < cap; step += 1) {
    let pick: string | null = null;
    let pickSum = sum;
    for (const ing of ingredients) {
      const trial = addVectors(sum, ing.essence);
      const angle = angleBetween(trial, target);
      if (angle < best - 1e-9) {
        best = angle;
        pick = ing.id;
        pickSum = trial;
      }
    }
    if (!pick) break;
    chosen.push(pick);
    sum = pickSum;
  }
  return chosen;
}

/**
 * A vessel, form and seal that will actually take this brew.
 *
 * Hardcoding the clay vial bottled two potions and then stopped: a vial has a
 * `potencyCap`, a seven-ingredient blend blows past it, and a brew that cannot
 * be bottled stays in `pendingBrew` and blocks every accept after it. Asking
 * the same availability the workbench asks is what a player does.
 */
function bottleFor(sim: Simulation): BottleRequest {
  const brew = sim.cauldron.pendingBrew!;
  const formId = availableForms(brew).find((f) => f.available)?.formId ?? 'potion';
  const vesselId =
    availableVessels(sim.world, brew, formId).find((v) => v.available)?.vesselId ?? 'clayVial';
  const sealId = availableSeals(sim.world, brew).find((s) => s.available)?.sealId ?? 'cork';
  return { formId, vesselId, sealId };
}

/** Brew one potion end to end, the way the workbench does. Returns the grade. */
function brewOne(sim: Simulation, index: number, tally?: Record<string, number>): Grade | null {
  const recipes = realRecipes();
  const recipe = recipes[index % recipes.length]!;

  for (const id of blendFor(recipe.target)) {
    sim.grant({ ingredient: { id, count: 1 } });
    sim.addToCauldron(id);
  }

  /*
   * Vary the temperature within and just outside the band, so a hundred brews
   * come out as a spread of grades rather than a hundred identical S's — which
   * is what a shelf full of real stock looks like.
   */
  const mid = (recipe.temperature.min + recipe.temperature.max) / 2;
  const drift = ((index % 5) - 2) * ((recipe.temperature.max - recipe.temperature.min) / 4);
  sim.cauldron.temperature = mid + drift;
  sim.setMethod(recipe.method as BrewMethod);

  const note = (key: string) => {
    if (tally) tally[key] = (tally[key] ?? 0) + 1;
  };

  if (!sim.acceptBrew()) {
    note('refused:accept');
    sim.emptyCauldron();
    return null;
  }
  sim.advanceBy(HOUR, false);

  const item = sim.bottlePending(bottleFor(sim));
  if (!item) {
    // `pendingBrew` IS the outcome, not a wrapper around one.
    note(`refused:bottle:${sim.cauldron.pendingBrew?.potencyTier ?? 'none'}`);
    // Never leave a brew in the pot: pendingBrew blocks the next accept, and one
    // stuck bottle would silently end the run.
    sim.discardPending();
    return null;
  }
  return item.grade;
}

/** A late-game shop, built through the real API wherever one exists. */
function bigShop(seed = 4242): Simulation {
  const world: World = createWorld(seed);
  world.plots = makePlots(PLOTS);
  world.shelf = makeShelf(SHELVES);

  // Boards across all five tiers, so quality is a spread rather than a value.
  world.shelf.forEach((slot, i) => {
    slot.quality = shelfTiers[i % shelfTiers.length]!.id;
  });

  world.gold = 500_000;
  world.renown = 250_000;
  for (const vessel of vessels) world.vessels[vessel.id] = 999;

  return new Simulation(world);
}

/** Plant every bed with a different crop. */
function plantEverything(sim: Simulation): string[] {
  const planted: string[] = [];
  sim.world.plots.forEach((plot, i) => {
    const crop = crops[i % crops.length]!;
    sim.grant({ seed: { id: crop.id, count: 5 } });
    sim.plant(plot.id, crop.id);
    planted.push(crop.id);
  });
  return planted;
}

describe('a shop at scale', () => {
  it('plants 25 beds at staggered growth without losing one', () => {
    const sim = bigShop();
    const planted: string[] = [];

    sim.world.plots.forEach((plot, i) => {
      const crop = crops[i % crops.length]!;
      sim.grant({ seed: { id: crop.id, count: 5 } });
      expect(sim.plant(plot.id, crop.id), `plot ${plot.id} refused ${crop.id}`).toBe(true);
      planted.push(crop.id);

      // Stagger the clock so the garden is a spread of growth stages rather
      // than 25 beds that all come ready on the same tick.
      const bed = sim.world.plots[i]!;
      if (bed.crop) {
        const span = bed.crop.readyAt - bed.crop.plantedAt;
        bed.crop.plantedAt -= Math.round((span * i) / PLOTS);
        bed.crop.readyAt -= Math.round((span * i) / PLOTS);
      }
    });

    expect(sim.world.plots).toHaveLength(PLOTS);
    expect(sim.world.plots.every((p) => p.crop !== null)).toBe(true);
    // Four soils cycling, so suitability varies across the beds.
    expect(new Set(sim.world.plots.map((p) => p.soil)).size).toBeGreaterThan(1);
    expect(new Set(planted).size).toBeGreaterThan(10);
  });

  it('harvests all 25 and banks every yield', () => {
    const sim = bigShop();
    plantEverything(sim);

    sim.advanceBy(48 * HOUR, false);
    const results = sim.harvestAll();

    expect(results.length, 'every ready bed should hand something back').toBe(PLOTS);
    expect(results.every((r) => r.count > 0)).toBe(true);
    expect(sim.world.plots.every((p) => p.crop === null)).toBe(true);
  });

  it('brews a hundred potions across the whole recipe book', () => {
    const sim = bigShop();
    const grades: Record<string, number> = {};
    const tally: Record<string, number> = {};
    let brewed = 0;

    for (let i = 0; i < POTIONS; i += 1) {
      const grade = brewOne(sim, i, tally);
      if (grade) {
        brewed += 1;
        grades[grade] = (grades[grade] ?? 0) + 1;
      }
    }

    // eslint-disable-next-line no-console
    console.log(`brewed ${brewed}/${POTIONS}`, JSON.stringify(grades), JSON.stringify(tally));

    expect(brewed, 'a hundred attempts should yield a hundred bottles').toBe(POTIONS);
    expect(sim.world.bottled).toHaveLength(POTIONS);
    expect(
      Object.keys(grades).length,
      'temperature drift should produce a spread of grades',
    ).toBeGreaterThan(1);
  });

  it('fills fifty shelves and sells from them', () => {
    const sim = bigShop();
    for (let i = 0; i < POTIONS; i += 1) brewOne(sim, i);

    let stocked = 0;
    for (const slot of sim.world.shelf) {
      const item = sim.world.bottled[0];
      if (!item) break;
      if (sim.stock(slot.id, item.uid)) stocked += 1;
    }

    expect(stocked, 'all fifty shelves should take a bottle').toBe(SHELVES);
    expect(sim.world.shelf.filter((s) => s.item).length).toBe(SHELVES);

    // And the shop actually trades: a week of footfall should move stock.
    const before = sim.world.gold;
    sim.advanceBy(7 * 24 * HOUR, false);
    expect(sim.world.gold).toBeGreaterThan(before);
  });

  it('ticks a full shop inside a frame', () => {
    const sim = bigShop();
    plantEverything(sim);
    for (const slot of sim.world.shelf) {
      slot.item = {
        uid: `stock-${slot.id}`,
        recipeId: 'healthTonic',
        formId: 'potion',
        vesselId: 'clayVial',
        sealId: 'cork',
        grade: 'B' as Grade,
        purity: 0.9,
        potencyTier: 'common',
        totalEssence: 6,
        dosesLeft: 1,
        fairValue: 40,
        bottledAt: sim.now,
      };
      slot.quantity = 1;
    }

    const started = Date.now();
    for (let i = 0; i < 24; i += 1) sim.advanceBy(HOUR, true);
    const elapsed = Date.now() - started;

    // eslint-disable-next-line no-console
    console.log(`24 online ticks of a full shop: ${elapsed}ms`);
    expect(elapsed, 'a full shop must not stall the frame').toBeLessThan(500);
  });

  it('survives a month away with everything full', () => {
    const sim = bigShop();
    plantEverything(sim);

    const started = Date.now();
    sim.advanceBy(30 * 24 * HOUR, false);
    const elapsed = Date.now() - started;

    // eslint-disable-next-line no-console
    console.log(`30-day catch-up of a full shop: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(2000);
    expect(Number.isFinite(sim.world.gold)).toBe(true);
    expect(sim.world.plots).toHaveLength(PLOTS);
  });

  /*
   * The top of the potency ladder has to be winnable.
   *
   * Before the cauldron tiers existed, capacity stopped at 180 while Sovereign
   * needed 300 essence — so a Sovereign brew was always over capacity, always
   * capped at grade D, and worth LESS than a Strong one at S. The whole top of
   * the ladder was a trap you could enter and never score in.
   */
  it('lets the best pot reach Sovereign at a real grade', () => {
    const sim = bigShop();
    sim.world.gold = 1_000_000;
    sim.world.renown = 1_000_000;
    const best = sim.buyCauldron('cauldronSix')!;
    // Bought pots arrive in storage; put it out before brewing in it.
    sim.setCauldronStored(best.id, false);
    sim.setActiveCauldron(best.id);

    expect(sim.cauldronCapacity).toBeGreaterThanOrEqual(300);

    const outcome = assessOutcome({
      // Pure Ignis, well past the Sovereign threshold and still inside the pot.
      blend: { ignis: 420, aqua: 0, terra: 0, aer: 0, umbra: 0 },
      temperature: (getRecipe('emberSovereign').temperature.min + getRecipe('emberSovereign').temperature.max) / 2,
      method: getRecipe('emberSovereign').method as BrewMethod,
      capacity: sim.cauldronCapacity,
    })!;

    expect(outcome.potencyTier).toBe('sovereign');
    expect(outcome.overCapacity).toBe(false);
    expect(['S', 'A']).toContain(outcome.grade);
  });

  it('records that 25 beds is past the declared ceiling', () => {
    // Not a failure — a record. If maxPlots is ever raised to meet the content,
    // this is the line that should change with it.
    expect(config.garden.maxPlots).toBe(16);
    expect(PLOTS).toBeGreaterThan(config.garden.maxPlots);
  });
});
