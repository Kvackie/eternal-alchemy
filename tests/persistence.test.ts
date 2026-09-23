/**
 * Pillar 04, enforced: nothing the player has worked for is lost to a closed tab
 * or to a schema that moved on without them.
 */

import { describe, expect, it } from 'vitest';
import { SaveManager, memoryAdapter } from '@/platform/save';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config } from '@/sim/config';
import { fairValue } from '@/sim/market';
import type { BottledItem } from '@/sim/types';

const HOUR = 3_600_000;

function brewing(seed = 606): Simulation {
  const sim = new Simulation(createWorld(seed));
  sim.grant({ ingredient: { id: 'dewcap', count: 3 } });
  sim.addToCauldron('dewcap');
  sim.addToCauldron('dewcap');
  sim.addToCauldron('dewcap');
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
    expect(resumed.pendingBrew?.recipeId).toBe('aquaTerra');
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
  it('keeps its ingredients across a save', () => {
    const saves = new SaveManager(memoryAdapter());
    const original = new Simulation(createWorld(11));
    original.grant({ ingredient: { id: 'dewcap', count: 2 } });
    original.addToCauldron('dewcap');

    saves.save(original.world);
    const resumed = new Simulation(saves.load()!);

    // Losing a half-filled pot to a tab switch would make experimenting
    // expensive, which is exactly what it must not be.
    expect(resumed.cauldron.contents.units).toHaveLength(1);
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
      resumed.bottlePending({ vesselId: 'clayVial', sealId: 'cork' }),
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
     * v3 filled these as loose fields; v13 folded them into the cauldron list,
     * and v14 took the heat back out. A save imported today runs the whole
     * chain, so what it ends up with is one plain starter pot.
     */
    const pot = world.cauldrons[0]! as unknown as Record<string, unknown>;
    expect('temperature' in pot).toBe(false);
    expect('method' in pot).toBe(false);
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
    // The tonic it was brewing is the Aqua–Terra potion now.
    expect(sim.pendingBrew?.recipeId).toBe('aquaTerra');
    expect(
      sim.bottlePending({ vesselId: 'clayVial', sealId: 'cork' }),
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

describe('migrating a save from the 197-recipe book', () => {
  function bottle(uid: string, recipeId: string): BottledItem {
    return {
      uid,
      recipeId,
      vesselId: 'clayVial',
      sealId: 'cork',
      grade: 'B',
      purity: 80,
      potencyTier: 'common',
      totalEssence: 70,
      fairValue: 20,
    } as BottledItem;
  }

  function v13Save(): string {
    const world = createWorld(1);
    world.recipes = {
      healthTonic: { discovered: true, timesBrewed: 4 },
      brineflintTincture: { discovered: true, timesBrewed: 2 },
      emberMinor: { discovered: false, timesBrewed: 0 },
      murk: { discovered: true, timesBrewed: 9 },
    };
    world.bottled = [bottle('a', 'healthTonic'), bottle('b', 'murk'), bottle('c', 'nightGlass')];
    world.shelf[0]!.item = bottle('d', 'murk');
    world.shelf[0]!.quantity = 1;
    world.shelf[1]!.item = bottle('e', 'windDraught');
    world.shelf[1]!.quantity = 1;
    world.log = [
      { id: 1, at: 0, kind: 'recipeFound', params: { recipe: 'shadowPhiltre' } },
      { id: 2, at: 0, kind: 'brewStarted', params: { recipe: 'murk', grade: 'F' } },
    ];
    world.nextLogId = 3;
    return JSON.stringify({ schemaVersion: 13, savedAt: Date.now(), world });
  }

  it('folds every old recipe into the potion made of the same essences', () => {
    const world = new SaveManager(memoryAdapter()).import(v13Save())!;

    // A Health Tonic and a Brineflint Tincture were both Aqua and Terra.
    expect(world.recipes.aquaTerra).toEqual({ discovered: true, timesBrewed: 6 });
    expect(world.recipes.ignis?.discovered).toBe(true);
    expect(world.bottled.map((item) => item.recipeId)).toEqual(['aquaTerra', 'umbra']);
    expect(world.shelf[1]!.item?.recipeId).toBe('aquaAer');
    expect(world.log.map((entry) => entry.params.recipe)).toEqual(['terraUmbra']);
  });

  it('pours the Murk away, since nothing replaces it', () => {
    const world = new SaveManager(memoryAdapter()).import(v13Save())!;

    expect(world.recipes.murk).toBeUndefined();
    expect(world.bottled.some((item) => item.recipeId === 'murk')).toBe(false);
    expect(world.shelf[0]!.item).toBeNull();
    expect(world.shelf[0]!.quantity).toBe(0);
  });
});

describe('migrating a save from before forms and the greenhouse went', () => {
  function v14Save(): string {
    const world = createWorld(1) as unknown as Record<string, unknown> & ReturnType<typeof createWorld>;
    world.bottled = [
      {
        uid: 'a',
        recipeId: 'aquaTerra',
        formId: 'tincture',
        dosesLeft: 2,
        vesselId: 'clayVial',
        sealId: 'cork',
        grade: 'B',
        purity: 80,
        potencyTier: 'common',
        totalEssence: 70,
        fairValue: 3,
        bottledAt: 0,
      } as unknown as BottledItem,
    ];
    world.strains = [{ id: 'strain-1', baseCropId: 'sunleaf', generation: 1 }];
    world.nextStrainId = 2;
    world.seeds['strain-1'] = 3;
    world.seeds.sunleaf = 1;
    world.inventory = [{ ingredientId: 'sunleaf', count: 2, harvestedAt: 0, strainId: 'strain-1' } as never];
    (world.statistics as unknown as Record<string, number>).strainsBred = 1;
    world.equipment.greenhouse = 1;
    return JSON.stringify({ schemaVersion: 14, savedAt: Date.now(), world });
  }

  it('makes every bottle a plain potion and prices it again', () => {
    const world = new SaveManager(memoryAdapter()).import(v14Save())!;
    const item = world.bottled[0]! as unknown as Record<string, unknown>;

    expect('formId' in item).toBe(false);
    expect('dosesLeft' in item).toBe(false);
    // A tincture was priced at 0.65 of a potion; the value is worked out anew.
    expect(item.fairValue).toBe(fairValue(world.bottled[0]!));
  });

  it('folds bred strains back into the crop they came from', () => {
    const world = new SaveManager(memoryAdapter()).import(v14Save())!;
    const loose = world as unknown as Record<string, unknown>;

    expect(world.seeds.sunleaf).toBe(4);
    expect(world.seeds['strain-1']).toBeUndefined();
    expect('strainId' in world.inventory[0]!).toBe(false);
    expect('strains' in loose).toBe(false);
    expect(world.equipment.greenhouse).toBeUndefined();
    expect('strainsBred' in world.statistics).toBe(false);
  });
});
