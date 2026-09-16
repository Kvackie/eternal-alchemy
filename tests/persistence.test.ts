/**
 * Pillar 04, enforced: nothing the player has worked for is lost to a closed tab
 * or to a schema that moved on without them.
 */

import { describe, expect, it } from 'vitest';
import { SaveManager, memoryAdapter } from '@/platform/save';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config, getRecipe } from '@/sim/config';
import type { BrewMethod } from '@/sim/types';

const HOUR = 3_600_000;

function brewing(seed = 606): Simulation {
  const sim = new Simulation(createWorld(seed));
  sim.grant({ ingredient: { id: 'dewcap', count: 3 } });
  sim.addToCauldron('dewcap');
  sim.addToCauldron('dewcap');
  sim.addToCauldron('dewcap');

  const recipe = getRecipe('healthTonic');
  sim.cauldron.temperature = (recipe.temperature.min + recipe.temperature.max) / 2;
  sim.setMethod(recipe.method as BrewMethod);
  sim.acceptBrew();
  return sim;
}

describe('a brew still in the pot', () => {
  it('survives a save and keeps counting down', () => {
    const saves = new SaveManager(memoryAdapter());
    const original = brewing();
    const readyAt = original.brewing!.readyAt;

    saves.save(original.world);
    const resumed = new Simulation(saves.load()!);

    expect(resumed.brewing).not.toBeNull();
    expect(resumed.brewing!.readyAt).toBe(readyAt);

    resumed.advanceTo(readyAt + 1);
    expect(resumed.pendingBrew?.recipeId).toBe('healthTonic');
  });

  it('finishes across an absence rather than pausing', () => {
    const world = brewing(77).world;
    world.lastSeenRealTime = 1_000_000;
    const sim = new Simulation(world);

    const summary = sim.resume(1_000_000 + 2 * HOUR);
    expect(summary.brewReady).toBe(true);
  });
});

describe('an unaccepted pot', () => {
  it('keeps its ingredients, temperature and method across a save', () => {
    const saves = new SaveManager(memoryAdapter());
    const original = new Simulation(createWorld(11));
    original.grant({ ingredient: { id: 'dewcap', count: 2 } });
    original.addToCauldron('dewcap');
    original.cauldron.temperature = 165;
    original.setMethod('stirred');

    saves.save(original.world);
    const resumed = new Simulation(saves.load()!);

    // Bringing a pot up to heat takes real seconds; losing that to a tab switch
    // would make experimenting expensive, which is exactly what it must not be.
    expect(resumed.cauldron.contents.units).toHaveLength(1);
    expect(resumed.temperature).toBe(165);
    expect(resumed.method).toBe('stirred');
  });
});

describe('a brew waiting to be bottled', () => {
  it('survives a reload', () => {
    const saves = new SaveManager(memoryAdapter());
    const original = brewing();
    original.finishAllTimers();
    const grade = original.pendingBrew!.grade;

    saves.save(original.world);
    const resumed = new Simulation(saves.load()!);

    expect(resumed.pendingBrew?.grade).toBe(grade);
    expect(
      resumed.bottlePending({ formId: 'potion', vesselId: 'clayVial', sealId: 'cork' }),
    ).not.toBeNull();
  });
});

describe('migrating a save from the alembic era', () => {
  /** A v2 save: alembic wheel state, old statistics, no temperature or log. */
  function v2Save(): string {
    const world = createWorld(1) as unknown as Record<string, unknown>;
    world.gold = 412;
    delete world.temperature;
    delete world.method;
    delete world.brewing;
    delete world.log;
    delete world.nextLogId;

    world.alembic = { angle: -0.58, radius: 0.4, capacity: 60, actionsLeft: 2, finished: false };
    world.distilling = { recipeId: 'healthTonic' };
    world.alembicTier = 2;
    world.alembicModules = ['governor'];
    world.statistics = {
      itemsSold: 9,
      goldEarned: 640,
      brewsDistilled: 5,
      cropsHarvested: 31,
    };
    world.pendingBrew = {
      recipeId: 'healthTonic',
      isFallback: false,
      total: { ignis: 0, aqua: 36, terra: 20, aer: 0, umbra: 0 },
      totalEssence: 56,
      offIdealRad: 0.04,
      contaminantPoints: 0,
      purity: 88,
      potencyTier: 'common',
      overCapacity: false,
      grade: 'A',
    };

    return JSON.stringify({ schemaVersion: 2, savedAt: Date.now(), world });
  }

  it('loads, and drops the wheel that no longer exists', () => {
    const world = new SaveManager(memoryAdapter()).import(v2Save())!;

    expect(world).not.toBeNull();
    expect(world.gold).toBe(412);
    expect('alembic' in world).toBe(false);
    expect('distilling' in world).toBe(false);
    expect('alembicTier' in world).toBe(false);
  });

  it('fills the fields the new model needs', () => {
    const world = new SaveManager(memoryAdapter()).import(v2Save())!;

    /*
     * Read off the pot, not the world.
     *
     * v3 filled these as loose fields; v13 folded them into the cauldron list.
     * A save imported today runs the whole chain, so what it ends up with is
     * one starter pot carrying the defaults v3 supplied.
     */
    const pot = world.cauldrons[0]!;
    expect(pot.temperature).toBe(config.brewing.ambientTemperature);
    expect(pot.method).toBeNull();
    expect(pot.brewing).toBeNull();
    expect(world.log).toEqual([]);
    expect(world.nextLogId).toBe(1);
  });

  it('carries the old brew count into both new counters', () => {
    const world = new SaveManager(memoryAdapter()).import(v2Save())!;

    expect(world.statistics.itemsSold).toBe(9);
    expect(world.statistics.brewsStarted).toBe(5);
    expect(world.statistics.brewsFinished).toBe(5);
    expect(world.statistics.seedsRecovered).toBe(0);
  });

  it('hands a finished brew straight through, since that work was already done', () => {
    const world = new SaveManager(memoryAdapter()).import(v2Save())!;
    const sim = new Simulation(world);

    expect(sim.pendingBrew?.grade).toBe('A');
    expect(
      sim.bottlePending({ formId: 'potion', vesselId: 'clayVial', sealId: 'cork' }),
    ).not.toBeNull();
  });

  it('still refuses a save from a schema newer than this build', () => {
    const saves = new SaveManager(memoryAdapter());
    const future = JSON.stringify({
      schemaVersion: config.save.schemaVersion + 1,
      savedAt: Date.now(),
      world: createWorld(1),
    });
    expect(saves.import(future)).toBeNull();
  });
});

describe('a stocked shelf', () => {
  it('keeps selling across a reload', () => {
    const saves = new SaveManager(memoryAdapter());
    const original = brewing(31);
    original.finishAllTimers();
    const item = original.bottlePending({
      formId: 'potion',
      vesselId: 'clayVial',
      sealId: 'cork',
    })!;
    original.stock('shelf-1', item.uid);
    original.setPrice('shelf-1', 0.7);

    saves.save(original.world);
    const resumed = new Simulation(saves.load()!);

    expect(resumed.world.shelf[0]?.item?.uid).toBe(item.uid);
    resumed.advanceBy(12 * HOUR, false);
    expect(resumed.world.gold).toBeGreaterThan(original.world.gold);
  });
});
