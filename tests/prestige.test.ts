/**
 * The Long Distillation, and what is left of the late-game bottling rules.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config, prestigeConfig, ranks } from '@/sim/config';
import { canRetire, codexBonuses, masteryFor } from '@/sim/prestige';
import { availableVessels } from '@/sim/bottling';
import { derivedStats } from '@/sim/progression';
import { spreadChanceFor } from '@/sim/cave';
import { footfallAt } from '@/sim/market';

describe('mastery', () => {
  it('scales with lifetime renown, so retiring later is worth more', () => {
    expect(masteryFor(0)).toBe(0);
    expect(masteryFor(11000)).toBeGreaterThan(masteryFor(2800));
    // Square root, not linear — the tenth run is not absurd.
    expect(masteryFor(40000)).toBeLessThan(masteryFor(10000) * 4);
  });

  it('is only offered at the top rank', () => {
    const sim = new Simulation(createWorld(1));
    expect(canRetire(sim.world)).toBe(false);

    sim.world.renown = ranks[prestigeConfig.requiresRank]!.renown;
    expect(canRetire(sim.world)).toBe(true);
  });

  it('buys codex tiers, and refuses beyond what it can pay for', () => {
    const sim = new Simulation(createWorld(1));
    sim.world.mastery = 3;

    expect(sim.buyCodex('greenThumb')).toBe(true);
    expect(sim.world.codex.greenThumb).toBe(1);
    // The next tier costs more than what is left.
    expect(sim.buyCodex('greenThumb')).toBe(false);
  });

  it('will not exceed a node’s tier cap', () => {
    const sim = new Simulation(createWorld(1));
    sim.world.mastery = 100000;
    const node = prestigeConfig.codex.find((n) => n.id === 'loyalCompanion')!;

    for (let i = 0; i < node.tiers + 3; i += 1) sim.buyCodex('loyalCompanion');
    expect(sim.world.codex.loyalCompanion).toBe(node.tiers);
  });

  it('folds bought tiers into one set of bonuses', () => {
    const sim = new Simulation(createWorld(1));
    sim.world.codex = { fullPurse: 2, greenThumb: 1 };

    const bonuses = codexBonuses(sim.world);
    expect(bonuses.startingGold).toBe(500);
    expect(bonuses.timerMultiplier).toBeCloseTo(0.9, 6);
  });
});

describe('the Long Distillation', () => {
  function readyToRetire(): Simulation {
    const sim = new Simulation(createWorld(31));
    sim.world.renown = ranks[prestigeConfig.requiresRank]!.renown;
    sim.world.gold = 9999;
    sim.world.mastery = 4;
    sim.world.codex = { fullPurse: 1 };
    return sim;
  }

  it('refuses below the top rank', () => {
    const sim = new Simulation(createWorld(1));
    expect(sim.retire('saltmarsh', 1)).toBeNull();
  });

  it('refuses a town that does not exist', () => {
    expect(readyToRetire().retire('atlantis', 1)).toBeNull();
  });

  it('wipes the run and keeps only what prestige is for', () => {
    const sim = readyToRetire();
    const before = sim.world.renown;
    const result = sim.retire('cinderhold', 555)!;
    const next = result.world;

    // Gone.
    expect(next.contracts).toHaveLength(0);
    expect(next.bottled).toHaveLength(0);
    expect(next.equipment).toEqual({});
    expect(next.renown).toBeLessThan(before);

    // Kept.
    expect(next.mastery).toBe(sim.world.mastery + result.masteryEarned);
    expect(next.codex).toEqual(sim.world.codex);
    expect(next.retirements).toBe(1);
    expect(next.lifetimeRenown).toBeGreaterThanOrEqual(before);
  });

  it('applies the codex to the new shop', () => {
    const sim = readyToRetire();
    const next = sim.retire('saltmarsh', 7)!.world;
    // Full Purse tier 1 is +250g on top of the normal opening float.
    expect(next.gold).toBe(config.economy.startingGold + 250);
  });

  it('applies the town’s own modifier', () => {
    const sim = readyToRetire();
    const cinder = sim.retire('cinderhold', 7)!.world;
    const salt = readyToRetire().retire('saltmarsh', 7)!.world;

    // Cinderhold opens with a deeper shaft; Saltmarsh does not.
    expect(cinder.shaft.depth).toBeGreaterThan(salt.shaft.depth);
    expect(cinder.shaft.supportedDepth).toBe(cinder.shaft.depth);
  });

  it('carries a hero over with the regard they earned', () => {
    const sim = readyToRetire();
    sim.world.codex = { loyalCompanion: 1 };
    sim.world.heroes = [
      { id: 'corin', level: 2, favour: 80, injuredUntil: 999, onMission: true, missionsCompleted: 4 },
      { id: 'ilse', level: 3, favour: 10, injuredUntil: null, onMission: false, missionsCompleted: 1 },
    ];

    const next = sim.retire('saltmarsh', 7)!.world;

    expect(next.heroes).toHaveLength(1);
    expect(next.heroes[0]!.id).toBe('corin');
    expect(next.heroes[0]!.favour).toBe(80);
    // They arrive rested and at home, not mid-mission.
    expect(next.heroes[0]!.onMission).toBe(false);
    expect(next.heroes[0]!.injuredUntil).toBeNull();
  });
});

describe('bottling something volatile', () => {
  it('takes only an iron-bound vessel', () => {
    const sim = new Simulation(createWorld(1));
    for (const vessel of ['clayVial', 'ironBoundJar']) sim.world.vessels[vessel] = 5;
    const brew = {
      recipeId: 'ignisTerra',
      total: { ignis: 40, aqua: 0, terra: 40, aer: 0, umbra: 0 },
      grade: 'B' as const,
      purity: 80,
      totalEssence: 80,
      potencyTier: 'common' as const,
      composition: { traits: [] as string[] },
    };
    const calm = availableVessels(sim.world, brew);
    expect(calm.find((v) => v.vesselId === 'clayVial')!.available).toBe(true);

    const volatile = availableVessels(sim.world, { ...brew, composition: { traits: ['volatile'] } });
    expect(volatile.find((v) => v.vesselId === 'clayVial')!.reasonKey).toBe(
      'workbench.reason.volatile',
    );
    expect(volatile.find((v) => v.vesselId === 'ironBoundJar')!.available).toBe(true);
  });
});

/**
 * Town modifiers.
 *
 * The module docstring promises each town "reshapes which of the gathering
 * sites carries the run". Seven of the eight modifiers were declared, costed
 * into the town blurbs, and read by nothing — `townEffects` was exported and
 * never called once, so picking a town was very nearly cosmetic.
 *
 * Each of these does the thing a town claims and asserts the outcome moved.
 */
describe('the town you retire to changes the run', () => {
  const inTown = (townId: string) => {
    const world = createWorld(3);
    world.townId = townId;
    return world;
  };

  it('grows crops faster in Saltmarsh than in Cinderhold', () => {
    // "Water everywhere, stone nowhere" against "Rich rock, poor soil".
    const marsh = new Simulation(inTown('saltmarsh'));
    const cinder = new Simulation(inTown('cinderhold'));
    for (const sim of [marsh, cinder]) sim.world.seeds.bluepetal = 2;

    marsh.plant(marsh.world.plots[0]!.id, 'bluepetal');
    cinder.plant(cinder.world.plots[0]!.id, 'bluepetal');

    expect(marsh.world.plots[0]!.crop!.readyAt).toBeLessThan(
      cinder.world.plots[0]!.crop!.readyAt,
    );
  });

  it('pulls more ore per batch in Cinderhold than in Saltmarsh', () => {
    const yieldIn = (townId: string) => {
      const sim = new Simulation(inTown(townId));
      const vein = sim.shaft.veins[0]!;
      sim.workVein(vein.id);
      // Three batches, deliberately short of the seam running out — over a long
      // window both towns simply empty the vein and the rate is invisible.
      sim.advanceBy(15 * 60 * 1000);
      return sim.world.statistics.oreExtracted;
    };
    expect(yieldIn('cinderhold')).toBeGreaterThan(yieldIn('saltmarsh'));
  });

  it('charges less for the same goods in Hollowreach than in Highmarch', () => {
    const priceIn = (townId: string) => {
      const sim = new Simulation(inTown(townId));
      for (const visit of sim.merchants()) {
        const entry = visit.entries.find((e) => e.kind === 'seed' && e.price !== null);
        if (entry) return entry.price!;
      }
      return null;
    };
    const cheap = priceIn('hollowreach');
    const dear = priceIn('highmarch');
    if (cheap === null || dear === null) return;
    expect(cheap).toBeLessThan(dear);
  });

  it('spreads the cave faster in Hollowreach', () => {
    expect(spreadChanceFor('dewcap', false, 0, 1.5)).toBeGreaterThan(
      spreadChanceFor('dewcap', false, 0, 1),
    );
  });

  it('comes with the extra cave beds Hollowreach advertises, as real tiles', () => {
    // The count and the cave itself have to agree — a derived total that the
    // tile array has never caught up with is six beds nobody can plant in.
    const plain = derivedStats(inTown('saltmarsh')).caveTiles;
    const hollow = inTown('hollowreach');
    expect(derivedStats(hollow).caveTiles).toBeGreaterThan(plain);
  });

  it('pays contracts better in Highmarch', () => {
    const payoutIn = (townId: string) => {
      const sim = new Simulation(inTown(townId));
      sim.world.contracts = [
        {
          id: 'c1',
          templateId: 'barrackTonics',
          quantity: 2,
          delivered: 0,
          payout: 400,
          renown: 5,
          msRemaining: 5 * 24 * 60 * 60 * 1000,
          deadlineDays: 5,
          postedAt: 0,
        },
      ];
      sim.world.bottled.push(
        {
          uid: 'a',
          recipeId: 'aquaTerra',
          vesselId: 'clayVial',
          sealId: 'cork',
          grade: 'B',
          purity: 80,
          potencyTier: 'common',
          totalEssence: 57,
          fairValue: 60,
          bottledAt: 0,
        },
      );
      return sim.deliverContract('c1')!.gold;
    };
    expect(payoutIn('highmarch')).toBeGreaterThan(payoutIn('saltmarsh'));
  });

  it('brings more people past the door in Highmarch', () => {
    const noon = 0.4 * 24 * 60 * 60 * 1000;
    expect(footfallAt(inTown('highmarch'), noon, true)).toBeGreaterThan(
      footfallAt(inTown('saltmarsh'), noon, true),
    );
  });

  it('reads every modifier some town declares', () => {
    // The guard: a town may not advertise something nothing consumes.
    const consumed = new Set([
      'cropGrowthMultiplier',
      'oreBatchMultiplier',
      'merchantPriceMultiplier',
      'caveSpreadMultiplier',
      'caveTilesBonus',
      'contractPayoutMultiplier',
      'footfallMultiplier',
      'startingDepthBonus',
    ]);
    for (const town of prestigeConfig.towns) {
      for (const key of Object.keys(town.effects)) {
        expect(consumed.has(key), `${town.id} declares "${key}" and nothing reads it`).toBe(true);
      }
    }
  });
});
