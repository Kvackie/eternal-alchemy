/**
 * Crossbreeding and the Long Distillation.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config, getIngredient, prestigeConfig, ranks } from '@/sim/config';
import { previewCross } from '@/sim/greenhouse';
import { canRetire, codexBonuses, masteryFor } from '@/sim/prestige';
import { availableForms } from '@/sim/bottling';
import { totalEssence } from '@/sim/essences';
import { addIngredient, inventoryRows } from '@/sim/inventory';
import { derivedStats } from '@/sim/progression';
import { spreadChanceFor } from '@/sim/cave';
import { footfallAt } from '@/sim/market';
import type { EssenceVector } from '@/sim/types';

const HOUR = 3_600_000;

function withGreenhouse(seed = 3): Simulation {
  const sim = new Simulation(createWorld(seed));
  sim.world.equipment.greenhouse = 1;
  return sim;
}

describe('crossbreeding', () => {
  it('needs a greenhouse', () => {
    const sim = new Simulation(createWorld(1));
    const [a, b] = sim.crossCandidates();
    expect(sim.crossStrains(a!, b!)).toBeNull();
  });

  it('puts the child midway between its parents', () => {
    const a: EssenceVector = { ignis: 0, aqua: 20, terra: 0, aer: 0, umbra: 0 };
    const b: EssenceVector = { ignis: 0, aqua: 0, terra: 10, aer: 0, umbra: 0 };
    expect(previewCross(a, b)).toEqual({ ignis: 0, aqua: 10, terra: 5, aer: 0, umbra: 0 });
  });

  it('produces a seed, not a plant', () => {
    const sim = withGreenhouse();
    const [a, b] = sim.crossCandidates();
    const result = sim.crossStrains(a!, b!)!;

    expect(result.strain.generation).toBe(1);
    expect(sim.world.seeds[result.strain.id]).toBe(config.greenhouse.seedsPerCross);
    expect(sim.world.statistics.strainsBred).toBe(1);
  });

  it('reaches blends no wild plant has', () => {
    const sim = withGreenhouse();
    const candidates = sim.crossCandidates();
    const sunleaf = candidates.find((c) => c.cropId === 'sunleaf')!;
    const dewcap = candidates.find((c) => c.cropId === 'dewcap')!;

    const child = sim.crossStrains(sunleaf, dewcap)!.strain;
    const wild = config.greenhouse.crossableCrops.map((id) => getIngredient(id).essence);

    // The child should not be identical to either parent's wild profile.
    for (const profile of wild) {
      expect(JSON.stringify(child.essence)).not.toBe(JSON.stringify(profile));
    }
    expect(totalEssence(child.essence)).toBeGreaterThan(0);
  });

  it('can be crossed again, deepening the lineage', () => {
    const sim = withGreenhouse(9);
    const [a, b] = sim.crossCandidates();
    const first = sim.crossStrains(a!, b!)!.strain;

    const withChild = sim.crossCandidates();
    const child = withChild.find((c) => c.strainId === first.id)!;
    const second = sim.crossStrains(child, a!)!.strain;

    expect(second.generation).toBe(2);
  });

  it('sometimes throws a mutation, and never a bad one', () => {
    const sim = withGreenhouse(4242);
    const mutations = new Set<string>();

    for (let i = 0; i < config.greenhouse.maxStrains - 1; i += 1) {
      const candidates = sim.crossCandidates();
      const result = sim.crossStrains(candidates[0]!, candidates[1]!);
      if (!result) break;
      if (result.mutation) mutations.add(result.mutation);
      // Nothing a cross produces is worthless.
      expect(totalEssence(result.strain.essence)).toBeGreaterThan(0);
    }

    expect(mutations.size).toBeGreaterThan(0);
  });

  it('produces a seed you can actually plant, grow and brew with', () => {
    // Breeding is decorative unless the strain survives all the way into the pot.
    const sim = withGreenhouse(17);
    const candidates = sim.crossCandidates();
    const sunleaf = candidates.find((c) => c.cropId === 'sunleaf')!;
    const dewcap = candidates.find((c) => c.cropId === 'dewcap')!;
    const strain = sim.crossStrains(sunleaf, dewcap)!.strain;

    // Plant the bred seed, not a wild one.
    const plot = sim.world.plots[0]!;
    expect(sim.plant(plot.id, strain.id)).toBe(true);
    expect(plot.crop?.strainId).toBe(strain.id);

    sim.advanceBy(HOUR);
    const harvest = sim.harvest(plot.id)!;
    expect(harvest.count).toBeGreaterThan(0);

    // The harvested stack remembers which line it came from.
    const stack = sim.world.inventory.find((s) => s.strainId === strain.id);
    expect(stack).toBeDefined();

    // And the pot reads the strain's essence, not the wild plant's.
    sim.addToCauldron(harvest.ingredientId, 'dewfresh', strain.id);
    const blend = sim.assess()!.total;
    const wild = getIngredient(harvest.ingredientId).essence;
    expect(JSON.stringify(blend)).not.toBe(JSON.stringify(wild));
  });

  it('drops its own seed on harvest, so a line can be replanted forever', () => {
    const sim = withGreenhouse(23);
    const candidates = sim.crossCandidates();
    const strain = sim.crossStrains(candidates[0]!, candidates[1]!)!.strain;
    const plot = sim.world.plots[0]!;

    let recovered = 0;
    for (let i = 0; i < 40; i += 1) {
      sim.world.seeds[strain.id] = (sim.world.seeds[strain.id] ?? 0) + 1;
      sim.plant(plot.id, strain.id);
      sim.advanceBy(HOUR);
      recovered += sim.harvest(plot.id)!.seeds;
    }
    // Seeds come back as the strain, never as its wild parent.
    expect(recovered).toBeGreaterThan(0);
    expect(sim.world.seeds[strain.id]).toBeGreaterThan(0);
  });

  it('keeps two strains of the same plant apart in stores', () => {
    const sim = withGreenhouse(29);
    const candidates = sim.crossCandidates();
    const a = sim.crossStrains(candidates[0]!, candidates[1]!)!.strain;
    const b = sim.crossStrains(candidates[1]!, candidates[2]!)!.strain;

    sim.grant({ ingredient: { id: 'sunleaf', count: 2 } });
    const rows = () => inventoryRows(sim.world, sim.now);
    const before = rows().length;

    // Same base plant, different lines — they must not merge into one stack.
    addIngredient(sim.world, 'sunleaf', 1, sim.now, a.id);
    addIngredient(sim.world, 'sunleaf', 1, sim.now, b.id);
    expect(rows().length).toBe(before + 2);
  });

  it('stops at the strain cap rather than growing the save forever', () => {
    const sim = withGreenhouse(11);
    for (let i = 0; i < config.greenhouse.maxStrains + 10; i += 1) {
      const candidates = sim.crossCandidates();
      sim.crossStrains(candidates[0]!, candidates[1]!);
    }
    expect(sim.world.strains.length).toBeLessThanOrEqual(config.greenhouse.maxStrains);
  });
});

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

    expect(sim.buyCodex('deftHands')).toBe(true);
    expect(sim.world.codex.deftHands).toBe(1);
    // The next tier costs more than what is left.
    expect(sim.buyCodex('deftHands')).toBe(false);
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
    sim.world.codex = { fullPurse: 2, deftHands: 1 };

    const bonuses = codexBonuses(sim.world);
    expect(bonuses.startingGold).toBe(500);
    // Deft Hands buys temperature tolerance now that the wheel it was written
    // for no longer exists.
    expect(bonuses.temperatureToleranceBonus).toBe(8);
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

describe('the full bottling range', () => {
  it('gates Powder behind dry material', () => {
    const brew = {
      recipeId: 'healthTonic',
      total: { ignis: 0, aqua: 36, terra: 20, aer: 0, umbra: 0 },
      grade: 'B' as const,
      purity: 80,
      totalEssence: 56,
      potencyTier: 'common' as const,
      composition: { driedShare: 0.5, mineralShare: 0, traits: [], unitCount: 2 },
    };
    const powder = availableForms(brew).find((f) => f.formId === 'powder')!;
    expect(powder.available).toBe(false);
    expect(powder.reasonKey).toBe('workbench.reason.dried');

    const allDry = availableForms({
      ...brew,
      composition: { ...brew.composition, driedShare: 1 },
    }).find((f) => f.formId === 'powder')!;
    expect(allDry.available).toBe(true);
  });

  it('gates Crystal behind stone and potency', () => {
    const brew = {
      recipeId: 'healthTonic',
      total: { ignis: 0, aqua: 120, terra: 90, aer: 0, umbra: 0 },
      grade: 'A' as const,
      purity: 90,
      totalEssence: 210,
      potencyTier: 'grand' as const,
      composition: { driedShare: 0, mineralShare: 0.2, traits: [], unitCount: 5 },
    };
    expect(availableForms(brew).find((f) => f.formId === 'crystal')!.reasonKey).toBe(
      'workbench.reason.mineral',
    );

    const stony = availableForms({
      ...brew,
      composition: { ...brew.composition, mineralShare: 0.6 },
    }).find((f) => f.formId === 'crystal')!;
    expect(stony.available).toBe(true);
  });

  it('gates a Bomb behind something volatile in the pot', () => {
    const brew = {
      recipeId: 'emberDraught',
      total: { ignis: 60, aqua: 0, terra: 20, aer: 0, umbra: 0 },
      grade: 'B' as const,
      purity: 80,
      totalEssence: 80,
      potencyTier: 'common' as const,
      composition: { driedShare: 0, mineralShare: 0, traits: [], unitCount: 3 },
    };
    expect(availableForms(brew).find((f) => f.formId === 'bomb')!.reasonKey).toBe(
      'workbench.reason.trait',
    );

    const volatile = availableForms({
      ...brew,
      composition: { ...brew.composition, traits: ['volatile'] },
    }).find((f) => f.formId === 'bomb')!;
    expect(volatile.available).toBe(true);
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
    for (const sim of [marsh, cinder]) sim.world.seeds.dewcap = 2;

    marsh.plant(marsh.world.plots[0]!.id, 'dewcap');
    cinder.plant(cinder.world.plots[0]!.id, 'dewcap');

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
          recipeId: 'healthTonic',
          formId: 'potion',
          vesselId: 'clayVial',
          sealId: 'cork',
          grade: 'B',
          purity: 80,
          potencyTier: 'common',
          totalEssence: 57,
          dosesLeft: 1,
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
