/**
 * Pillar 04, enforced: nothing the player has worked for is lost to a closed tab
 * or to a schema that moved on without them.
 */

import { describe, expect, it } from 'vitest';
import { SaveManager, memoryAdapter } from '@/platform/save';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { rankIndexFor } from '@/sim/progression';
import { caveConfig, config, crops, ingredients } from '@/sim/config';
import { fairValue } from '@/sim/market';
import type { BottledItem, World } from '@/sim/types';

const HOUR = 3_600_000;

function brewing(seed = 606): Simulation {
  const sim = new Simulation(createWorld(seed));
  sim.grant({ ingredient: { id: 'bluecone', count: 3 } });
  sim.addToCauldron('bluecone');
  sim.addToCauldron('bluecone');
  sim.addToCauldron('bluecone');
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
    expect(resumed.pendingBrew?.recipeId).toBe('aqua');
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
    original.grant({ ingredient: { id: 'bluecone', count: 2 } });
    original.addToCauldron('bluecone');

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
    expect(resumed.bottlePending()).not.toBeNull();
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
    expect(sim.bottlePending()).not.toBeNull();
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
    const item = original.bottlePending()!;
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
    const world = createWorld(1) as unknown as Record<string, unknown> &
      ReturnType<typeof createWorld>;
    world.bottled = [
      {
        uid: 'a',
        recipeId: 'aquaTerra',
        formId: 'tincture',
        dosesLeft: 2,
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
    world.inventory = [
      { ingredientId: 'sunleaf', count: 2, harvestedAt: 0, strainId: 'strain-1' } as never,
    ];
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

describe('migrating a save from before the ingredient rebuild', () => {
  function v15Save(): string {
    const world = createWorld(1);
    // Emberroot, the old moonpetal crop and witchCap are all gone; dewcap
    // stays, as a fungus.
    world.inventory = [
      { ingredientId: 'emberroot', count: 3, harvestedAt: 0 },
      { ingredientId: 'dewcap', count: 2, harvestedAt: 0 },
    ];
    world.seeds = { moonpetal: 0, dewcap: 3, emberroot: 2 };
    world.spores = { witchCap: 2 };
    world.cave.tiles[0]!.speciesId = 'witchCap';
    world.plots[0]!.crop = { cropId: 'emberroot', plantedAt: 0, readyAt: 1 };
    world.cauldrons[0]!.contents.units = [{ ingredientId: 'emberroot', harvestedAt: 0 }];
    world.log = [
      { id: 1, at: 0, kind: 'harvested', params: { ingredient: 'emberroot', count: 3 } },
    ];
    return JSON.stringify({ schemaVersion: 15, savedAt: Date.now(), world });
  }

  it('folds every ingredient, seed and spore that went into one that stayed', () => {
    const world = new SaveManager(memoryAdapter()).import(v15Save())!;
    const ids = new Set(ingredients.map((ing) => ing.id));
    const cropIds = new Set(crops.map((crop) => crop.id));
    const species = new Set(caveConfig.species.map((entry) => entry.id));

    for (const stack of world.inventory) expect(ids.has(stack.ingredientId)).toBe(true);
    expect(world.inventory.find((s) => s.ingredientId === 'dewcap')?.count).toBe(2);
    expect(world.inventory.reduce((sum, s) => sum + s.count, 0)).toBe(5);

    for (const id of Object.keys(world.seeds)) expect(cropIds.has(id)).toBe(true);
    expect(Object.values(world.seeds).reduce((a, b) => a + b, 0)).toBe(5);
    for (const id of Object.keys(world.spores)) expect(species.has(id)).toBe(true);
    expect(species.has(world.cave.tiles[0]!.speciesId!)).toBe(true);

    expect(cropIds.has(world.plots[0]!.crop!.cropId)).toBe(true);
    expect(ids.has(world.cauldrons[0]!.contents.units[0]!.ingredientId)).toBe(true);
    expect(ids.has(String(world.log[0]!.params.ingredient))).toBe(true);
  });
});

describe('paying back what the overhaul took away', () => {
  it('refunds the Lagged cauldron and Deft Hands when their mechanics went', () => {
    const world = createWorld(1);
    world.gold = 100;
    world.mastery = 2;
    world.equipment.lagged = 1;
    world.codex.deftHands = 3;
    const raw = JSON.stringify({ schemaVersion: 13, savedAt: Date.now(), world });
    const migrated = new SaveManager(memoryAdapter()).import(raw)!;

    expect(migrated.gold).toBe(100 + 180);
    // Tiers 1, 2 and 3 at 3 Mastery a tier: 3 + 6 + 9.
    expect(migrated.mastery).toBe(2 + 18);
    expect(migrated.codex.deftHands).toBeUndefined();
  });

  it('refunds the greenhouse, and names its strains by their crop in the Ledger', () => {
    const world = createWorld(1) as unknown as Record<string, unknown> &
      ReturnType<typeof createWorld>;
    world.gold = 0;
    world.equipment.greenhouse = 1;
    world.strains = [{ id: 'strain-1', baseCropId: 'sunleaf', generation: 1 }];
    world.log = [{ id: 1, at: 0, kind: 'planted', params: { crop: 'strain-1' } }];
    const raw = JSON.stringify({ schemaVersion: 14, savedAt: Date.now(), world });
    const migrated = new SaveManager(memoryAdapter()).import(raw)!;

    expect(migrated.gold).toBe(1400);
    expect(migrated.log[0]!.params.crop).toBe('sunleaf');
  });
});

describe('migrating a save from before the loose ends were tied', () => {
  it('seeds the cave, fills the shallow strata and re-deals packed stalls', () => {
    const world = createWorld(1);
    delete (world.cave as { seed?: number }).seed;
    world.shaft.depth = 20;
    world.shaft.veins = world.shaft.veins.map((vein) => ({ ...vein, depth: 20 }));
    world.merchantVisits = { bramm: { dayNumber: 0, bought: {}, picks: ['emberroot'] } };
    const raw = JSON.stringify({ schemaVersion: 16, savedAt: Date.now(), world });
    const migrated = new SaveManager(memoryAdapter()).import(raw)!;

    expect(typeof migrated.cave.seed).toBe('number');
    for (const depth of [0, 5, 10, 15, 20]) {
      expect(
        migrated.shaft.veins.some((vein) => vein.depth === depth),
        `${depth}m`,
      ).toBe(true);
    }
    expect(migrated.merchantVisits.bramm!.picks).toBeUndefined();
  });
});

describe('migrating a save from before vessels and seals went', () => {
  it('unbottles every potion, refunds the moulds and press, and unstacks shelves', () => {
    const world = createWorld(1);
    const loose = world as unknown as Record<string, unknown>;
    loose.vessels = { clayVial: 4, glassFlask: 2 };
    loose.seals = { waxRibbon: 3 };
    world.equipment.vesselMoulds = 1;
    world.equipment.sealPress = 1;
    const goldBefore = world.gold;

    const old = (uid: string) =>
      ({
        uid,
        recipeId: 'aquaTerra',
        vesselId: 'crystalOrb',
        sealId: 'silverClasp',
        grade: 'A',
        purity: 85,
        potencyTier: 'common',
        totalEssence: 70,
        fairValue: 999,
        bottledAt: 0,
      }) as unknown as BottledItem;
    world.bottled = [old('a')];
    world.shelf[0]!.item = old('pouch');
    world.shelf[0]!.quantity = 3;
    world.contracts = [
      {
        id: 'contract-1',
        templateId: '',
        terms: {
          faction: 'greycloaks',
          recipeId: 'aquaTerra',
          minGrade: 'C',
          requiresSeal: 'cork',
        },
        quantity: 3,
        delivered: 0,
        payout: 100,
        renown: 5,
        msRemaining: 1000,
        deadlineDays: 4,
        postedAt: 0,
      } as unknown as World['contracts'][number],
    ];

    const raw = JSON.stringify({ schemaVersion: 17, savedAt: Date.now(), world });
    const migrated = new SaveManager(memoryAdapter()).import(raw)!;
    const after = migrated as unknown as Record<string, unknown>;

    expect(after.vessels).toBeUndefined();
    expect(after.seals).toBeUndefined();
    expect(migrated.gold).toBe(goldBefore + 900 + 1200);
    expect(migrated.equipment.vesselMoulds).toBeUndefined();

    // Two bottles came off the stacked shelf; every bottle is plain now and
    // worth what a plain potion is worth.
    expect(migrated.shelf[0]!.quantity).toBe(1);
    expect(migrated.bottled).toHaveLength(3);
    for (const item of [...migrated.bottled, migrated.shelf[0]!.item!]) {
      expect('vesselId' in item).toBe(false);
      expect('sealId' in item).toBe(false);
      expect(item.fairValue).toBe(fairValue(item));
    }
    expect('requiresSeal' in migrated.contracts[0]!.terms!).toBe(false);
  });
});

describe('migrating a save from before the guild order was renamed', () => {
  it('points a posted sealedTonics order at guildTonics', () => {
    const world = createWorld(1);
    world.contracts = [
      {
        id: 'contract-1',
        templateId: 'sealedTonics',
        quantity: 3,
        delivered: 0,
        payout: 100,
        renown: 5,
        msRemaining: 1000,
        deadlineDays: 4,
        postedAt: 0,
      },
    ];
    const raw = JSON.stringify({ schemaVersion: 18, savedAt: Date.now(), world });
    const migrated = new SaveManager(memoryAdapter()).import(raw)!;
    expect(migrated.contracts[0]!.templateId).toBe('guildTonics');
  });
});

describe('migrating a save from before the Iron Pot went', () => {
  it('refunds it and frees the floor', () => {
    const world = createWorld(1);
    world.decorOwned = { ironPot: 1 };
    world.decor.floor = 'ironPot';
    const gold = world.gold;
    const raw = JSON.stringify({ schemaVersion: 19, savedAt: Date.now(), world });
    const migrated = new SaveManager(memoryAdapter()).import(raw)!;
    expect(migrated.gold).toBe(gold + 150);
    expect(migrated.decorOwned.ironPot).toBeUndefined();
    expect(migrated.decor.floor).toBeNull();
  });
});

describe('migrating a save from before ranks asked for a potion', () => {
  it('keeps the rank the renown had given, and records the potions held', () => {
    const world = createWorld(1);
    world.renown = 1_000;
    const loose = world as unknown as Record<string, unknown>;
    delete loose.bottledKinds;
    world.bottled = [
      {
        uid: 'held',
        recipeId: 'ignisAquaTerraAerUmbra',
        grade: 'S',
        purity: 99,
        potencyTier: 'sovereign',
        totalEssence: 400,
        fairValue: 1,
        bottledAt: 0,
      },
    ];
    const raw = JSON.stringify({ schemaVersion: 21, savedAt: Date.now(), world });
    const migrated = new SaveManager(memoryAdapter()).import(raw)!;
    const sim = new Simulation(migrated);

    expect(migrated.bottledKinds['S|5|sovereign']).toBe(true);
    // Chandler, where 1000 renown had put it; the held potion would allow more,
    // and renown is what holds it here.
    expect(sim.rankId).toBe('chandler');
  });

  it('does not demote a shop with nothing on hand', () => {
    const world = createWorld(1);
    world.renown = 1_000;
    delete (world as unknown as Record<string, unknown>).bottledKinds;
    const raw = JSON.stringify({ schemaVersion: 21, savedAt: Date.now(), world });
    const sim = new Simulation(new SaveManager(memoryAdapter()).import(raw)!);
    expect(sim.rankId).toBe('chandler');
  });

  it('keeps a high rank whose requirements are not nested', () => {
    // Master asks for an A five-way Grand, which an earlier rank's S Common
    // does not satisfy: every rank up to the earned one has to be recorded.
    const world = createWorld(1);
    world.renown = 3_000;
    world.acknowledgedRank = rankIndexFor(3_000);
    delete (world as unknown as Record<string, unknown>).bottledKinds;
    const raw = JSON.stringify({ schemaVersion: 21, savedAt: Date.now(), world });
    const sim = new Simulation(new SaveManager(memoryAdapter()).import(raw)!);
    expect(sim.rankIndex).toBe(rankIndexFor(3_000));
  });
});
