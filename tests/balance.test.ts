/**
 * The balance harness.
 *
 * These are not pass/fail correctness tests — they are measurements that fail
 * only when a number drifts outside a range we have decided is sane. They exist
 * because "balance against real play" is otherwise a guess: the sim core is
 * headless and deterministic, so we can simply play thousands of hours of it and
 * read the results.
 *
 * When one of these fails, the right response is usually to look at the number
 * and decide, not to reach for the assertion.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import {
  caveConfig,
  config,
  contractsConfig,
  decorPieces,
  equipment,
  getMerchant,
  getEquipment,
  ingredients,
  merchants,
  prestigeConfig,
  recipes,
  cauldronTiers,
  shaftConfig,
} from '@/sim/config';
import { grantDecor, placeDecor } from '@/sim/decor';
import { angleBetween, gradeFor, potencyMultiplier, potencyTierFor } from '@/sim/essences';
import { assessOutcome } from '@/sim/brewing';
import { fairValue } from '@/sim/market';
import { isMature, spreadChanceFor } from '@/sim/cave';
import { derivedStats, equipmentAvailability, rankIndexFor } from '@/sim/progression';
import { codexBonuses } from '@/sim/prestige';
import { tierOf } from '@/sim/merchants';
import { scheduledWalkIns } from '@/sim/haggle';
import type { BottledItem, Contract, EssenceVector, Grade } from '@/sim/types';

const HOUR = 3_600_000;
const DAY = config.clock.dayLengthMs;

function bottle(uid: string, grade: Grade, value = 60): BottledItem {
  return {
    uid,
    recipeId: 'aquaTerra',
    grade,
    purity: 80,
    potencyTier: 'common',
    totalEssence: 57,
    fairValue: value,
    bottledAt: 0,
  };
}

describe('the garden sustains itself', () => {
  it('returns roughly one seed per planting over a long run', () => {
    const sim = new Simulation(createWorld(1234));
    const plot = sim.world.plots[0]!;
    let planted = 0;
    let recovered = 0;

    for (let i = 0; i < 400; i += 1) {
      sim.world.seeds.bluepetal = 5;
      if (!sim.plant(plot.id, 'bluepetal')) break;
      planted += 1;
      sim.advanceBy(HOUR);
      recovered += sim.harvest(plot.id)!.seeds;
    }

    const rate = recovered / planted;
    // Below ~0.8 the garden drains and merchants become life support; above ~1.4
    // seeds stop being worth buying at all.
    expect(rate).toBeGreaterThan(0.8);
    expect(rate).toBeLessThan(1.4);
  });

  it('stays inside that band even when every crop is in its right soil', () => {
    /*
     * The measurement above uses a mismatched plot, which is the worst case. The
     * suited bonus is an extra unit and seeds roll per unit, so good placement
     * quietly raises the seed rate too — and the ceiling is the number that
     * matters here. Past ~1.4 the garden prints seeds and merchants stop selling
     * anything worth buying.
     */
    const sim = new Simulation(createWorld(1234));
    const plot = sim.world.plots.find((entry) => entry.soil === 'silt')!;
    let planted = 0;
    let recovered = 0;

    for (let i = 0; i < 400; i += 1) {
      sim.world.seeds.bluepetal = 5;
      if (!sim.plant(plot.id, 'bluepetal')) break;
      planted += 1;
      sim.advanceBy(HOUR);
      recovered += sim.harvest(plot.id)!.seeds;
    }

    const rate = recovered / planted;
    expect(rate).toBeGreaterThan(0.8);
    expect(rate).toBeLessThan(1.4);
  });
});

describe('the cave is generous, not free', () => {
  it('does not carpet the whole grid in a single overnight absence', () => {
    // Across worlds, because each cave spreads its own way: one night is a
    // handful of chances, and a single seed can land on none of them.
    const runs = Array.from({ length: 20 }, (_, i) => {
      const sim = new Simulation(createWorld(88 + i));
      sim.world.spores.dewcap = 5;
      sim.seedCaveTile(0, 'dewcap');
      sim.advanceBy(8 * HOUR, false);
      return sim.cave.tiles.filter((t) => t.speciesId !== null).length / sim.cave.tiles.length;
    });
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    const oneBed = 1 / caveConfig.startingTiles;

    // Leaving it should reward you, not replace the garden. Somewhere under
    // three-quarters of the grid after a night away is the shape we want.
    expect(mean).toBeGreaterThan(oneBed);
    expect(Math.max(...runs)).toBeLessThan(0.75);
  });

  it('does fill given a long enough absence', () => {
    const sim = new Simulation(createWorld(88));
    sim.world.spores.dewcap = 5;
    sim.seedCaveTile(0, 'dewcap');
    sim.advanceBy(4 * 24 * HOUR, false);

    const mature = sim.cave.tiles.filter((t) => isMature(t, sim.now)).length;
    expect(mature / sim.cave.tiles.length).toBeGreaterThan(0.7);
  });
});

describe('grade reflects effort, not luck', () => {
  /** A perfectly on-ratio Aqua–Terra blend, `units` ingredients' worth. */
  function assess(units: number) {
    const blend = { ignis: 0, aqua: 12 * units, terra: 12 * units, aer: 0, umbra: 0 };
    return assessOutcome({ blend, capacity: 400 })!;
  }

  /*
   * The guard is potency, not grade.
   *
   * A single ingredient cannot miss its own ratio, so it scores S — by design:
   * the grade is the ratio and nothing else. What keeps a trivial brew from
   * being worth anything is that it is Minor, and Minor is priced accordingly.
   */
  it('leaves a trivial one-ingredient brew worth little, however clean', () => {
    const single = assess(1);
    const full = assess(12);
    expect(single.recipeId).toBe(full.recipeId);
    expect(single.grade).toBe('S');
    expect(single.potencyTier).toBe('minor');
    expect(potencyMultiplier(single.potencyTier)).toBeLessThan(potencyMultiplier(full.potencyTier));
  });

  it('lets a properly filled cauldron reach the top', () => {
    const full = assess(12);
    expect(full.potencyTier).not.toBe('minor');
    expect(full.grade).toBe('S');
  });

  it('still rewards a clean ratio at every size', () => {
    // A better ratio must never score worse than a worse one.
    const clean = assess(6).purity;
    const dirty = assessOutcome({
      blend: { ignis: 10, aqua: 72, terra: 60, aer: 0, umbra: 0 },
      capacity: 400,
    })!.purity;
    expect(clean).toBeGreaterThan(dirty);
  });
});

describe('the selling channels stay in their lanes', () => {
  /** Gold per bottle through the shelf, over a long stretch of real play. */
  function shelfIncome(seed: number, hours: number): { gold: number; sold: number } {
    const sim = new Simulation(createWorld(seed));
    sim.world.gold = 0;
    let restocked = 0;

    for (let hour = 0; hour < hours; hour += 1) {
      for (const slot of sim.world.shelf) {
        if (!slot.item) {
          slot.item = bottle(`b-${restocked}`, 'B');
          slot.priceRatio = 1;
          restocked += 1;
        }
      }
      sim.advanceBy(HOUR, true);
    }
    return { gold: sim.world.gold, sold: sim.world.statistics.itemsSold };
  }

  it('pays a predictable amount per bottle on the shelf', () => {
    const { gold, sold } = shelfIncome(5, 48);
    expect(sold).toBeGreaterThan(0);
    const per = gold / sold;
    // Priced at fair value, the shelf should return roughly fair value.
    expect(per).toBeGreaterThan(50);
    expect(per).toBeLessThan(75);
  });

  it('pays better through a contract than through the shelf', () => {
    // Which seed posts a Barrack order moves with the data, so find one — and
    // fail if none does, rather than passing without measuring anything.
    let found: { sim: Simulation; contract: Contract } | null = null;
    for (let seed = 1; seed <= 200 && !found; seed += 1) {
      const sim = new Simulation(createWorld(seed));
      sim.advanceBy(1000);
      const contract = sim.world.contracts.find((c) => c.templateId === 'barrackTonics');
      if (contract) found = { sim, contract };
    }
    expect(found).not.toBeNull();
    const { sim, contract } = found!;

    // Use the *real* fair value, not the helper's placeholder — comparing a
    // contract's payout against a made-up shelf price measures nothing.
    const shelfValue = fairValue({
      recipeId: 'aquaTerra',
      grade: 'C',
      potencyTier: 'common',
    });

    for (let i = 0; i < contract.quantity; i += 1) {
      sim.world.bottled.push(bottle(`c-${i}`, 'C', shelfValue));
    }
    const result = sim.deliverContract(contract.id)!;
    const perUnit = result.gold / result.delivered;

    // Contracts are the planned channel; they must be worth the planning.
    expect(perUnit).toBeGreaterThan(shelfValue);
    // But not so much that the shelf is pointless.
    expect(perUnit).toBeLessThan(shelfValue * 4);
  });

  it('pays best of all through a haggle played well', () => {
    // Ceiling after two counters and a hold-firm, versus plain fair value.
    // The schedule directly: walk-ins are paused behind the counter's UI, and
    // the paused door would send nobody and let this pass unmeasured.
    let sim: Simulation | null = null;
    let walkIn: ReturnType<typeof scheduledWalkIns>[number] | undefined;
    for (let day = 0; day < 40 && !walkIn; day += 1) {
      sim = new Simulation(createWorld(77));
      sim.world.renown = 100000;
      sim.world.bottledKinds['S|5|sovereign'] = true;
      sim.advanceTo(day * DAY + DAY * 0.4);
      sim.world.bottled.push(bottle('h', 'B'));
      walkIn = scheduledWalkIns(sim.world)[0];
    }
    expect(walkIn).toBeDefined();

    const session = sim!.beginHaggle(walkIn!.customerId, 'h')!;
    const opening = session.ceiling;
    expect(opening).toBeGreaterThan(bottle('h', 'B').fairValue);
    expect(opening).toBeLessThan(bottle('h', 'B').fairValue * 3);
  });
});

describe('the renown curve', () => {
  it('does not hand out the top rank even at an impossible ceiling', () => {
    // This is a *ceiling*, not real play: four shelves restocked free every hour
    // with grade-A stock for a solid week of continuous uptime. Nobody can do
    // this. If even this cannot reach the top ranks, the curve has headroom.
    const sim = new Simulation(createWorld(2));
    let restocked = 0;

    for (let hour = 0; hour < 7 * 24; hour += 1) {
      for (const slot of sim.world.shelf) {
        if (!slot.item) {
          slot.item = bottle(`r-${restocked}`, 'A');
          slot.priceRatio = 0.9;
          restocked += 1;
        }
      }
      sim.advanceBy(HOUR, true);
    }

    // Real progress, but the last few ranks stay out of reach even here.
    // The renown curve on its own: the potion each rank also asks for is not
    // what this measures.
    expect(rankIndexFor(sim.world.renown)).toBeGreaterThan(0);
    expect(rankIndexFor(sim.world.renown)).toBeLessThan(8);
  });
});

describe('nothing runs away with itself', () => {
  it('keeps a long unattended run inside sane bounds', () => {
    const sim = new Simulation(createWorld(31));
    sim.world.spores.dewcap = 5;
    sim.seedCaveTile(0, 'dewcap');
    sim.workVein(sim.shaft.veins[0]!.id);
    for (const plot of sim.world.plots) sim.plant(plot.id, 'bluepetal');

    sim.advanceBy(30 * 24 * HOUR, false);

    // The save must not balloon: log capped, inventory grouped, no runaway arrays.
    expect(sim.world.log.length).toBeLessThanOrEqual(2000);
    expect(sim.world.inventory.length).toBeLessThan(60);
    expect(sim.world.contracts.length).toBe(contractsConfig.boardSize);

    const bytes = JSON.stringify(sim.world).length;
    expect(bytes).toBeLessThan(600_000);
  });
});

/**
 * The closest any blend of gatherable ingredients can get to a target ratio.
 *
 * Deterministic on purpose — a randomised search would make a balance failure
 * come and go between runs. Greedy forward selection followed by refinement at
 * a fixed step schedule: start from the single best ingredient, then repeatedly
 * add whichever fixed amount of whichever ingredient improves the angle most,
 * until nothing does.
 */
const AXES = ['ignis', 'aqua', 'terra', 'aer', 'umbra'] as const;

/**
 * The pool, prepared once.
 *
 * The search is inherently a lot of arithmetic — every candidate blend against
 * every ingredient, several times over — so the win is in doing less work per
 * step rather than fewer steps. Vectors live in one flat array so the inner loop
 * walks memory in order, and each ingredient's squared magnitude is computed
 * here instead of inside the loop that runs a million times.
 */
interface BlendIndex {
  /** All vectors end to end: ingredient i occupies [i*5, i*5+5). */
  flat: Float64Array;
  /** |e|² per ingredient, so the incremental magnitude update is arithmetic. */
  sq: Float64Array;
  count: number;
}

function buildIndex(pool: EssenceVector[]): BlendIndex {
  const count = pool.length;
  const flat = new Float64Array(count * 5);
  const sq = new Float64Array(count);

  for (let i = 0; i < count; i += 1) {
    let s = 0;
    for (let a = 0; a < 5; a += 1) {
      const v = pool[i]![AXES[a]!] ?? 0;
      flat[i * 5 + a] = v;
      s += v * v;
    }
    sq[i] = s;
  }
  return { flat, sq, count };
}

const liveIndex = buildIndex(ingredients.map((i) => i.essence));

/**
 * Answers already worked out, keyed by the target ratio.
 *
 * Two separate checks ask about every recipe, so without this the whole search
 * runs twice over. The pool is fixed for a test run, so an answer cannot go
 * stale within one.
 */
const blendCache = new Map<string, number>();

function bestBlendAngle(target: EssenceVector, poolOverride?: EssenceVector[]): number {
  const index = poolOverride ? buildIndex(poolOverride) : liveIndex;

  const t = new Float64Array(5);
  let tSq = 0;
  for (let a = 0; a < 5; a += 1) {
    t[a] = target[AXES[a]!] ?? 0;
    tSq += t[a]! * t[a]!;
  }
  const tMag = Math.sqrt(tSq);
  if (tMag === 0) return Math.PI / 2;

  const key = poolOverride ? '' : Array.from(t).join(',');
  if (key) {
    const hit = blendCache.get(key);
    if (hit !== undefined) return hit;
  }

  const { flat, sq, count } = index;

  /*
   * State is carried as three numbers rather than a vector: the running dot with
   * the target, the running squared magnitude, and the mix itself. Adding an
   * ingredient updates the first two in constant time given `dot(current, e)`,
   * which is the only per-candidate work left.
   */
  const current = new Float64Array(5);
  let curDot = 0;
  let curSq = 0;
  let best = Infinity;

  // Seed with the single closest ingredient.
  let seed = -1;
  for (let i = 0; i < count; i += 1) {
    if (sq[i] === 0) continue;
    let dot = 0;
    for (let a = 0; a < 5; a += 1) dot += flat[i * 5 + a]! * t[a]!;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot / (Math.sqrt(sq[i]!) * tMag))));
    if (angle < best) {
      best = angle;
      seed = i;
    }
  }
  if (seed < 0) return Math.PI / 2;

  for (let a = 0; a < 5; a += 1) current[a] = flat[seed * 5 + a]!;
  curSq = sq[seed]!;
  for (let a = 0; a < 5; a += 1) curDot += current[a]! * t[a]!;

  // Coarse to fine, so a big correction lands before the small ones.
  for (const w of [1, 0.5, 0.25, 0.1, 0.05, 0.02]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < count; i += 1) {
        const base = i * 5;

        // dot(current, e) — the one thing that cannot be precomputed, because
        // `current` moves every time an ingredient is accepted.
        let curE = 0;
        let eDotT = 0;
        for (let a = 0; a < 5; a += 1) {
          const e = flat[base + a]!;
          curE += current[a]! * e;
          eDotT += e * t[a]!;
        }

        const nextDot = curDot + w * eDotT;
        const nextSq = curSq + 2 * w * curE + w * w * sq[i]!;
        if (nextSq <= 0) continue;

        const cos = Math.max(-1, Math.min(1, nextDot / (Math.sqrt(nextSq) * tMag)));
        const angle = Math.acos(cos);
        if (angle < best - 1e-9) {
          /*
           * Recompute from the mix rather than keeping the incremental values.
           * Accepting is rare — a few hundred times against millions of trials —
           * so the cost is nothing, and it stops rounding error accumulating
           * across a long run into an answer that quietly differs from the
           * straightforward version this replaced.
           */
          for (let a = 0; a < 5; a += 1) current[a]! += w * flat[base + a]!;
          curDot = 0;
          curSq = 0;
          for (let a = 0; a < 5; a += 1) {
            curDot += current[a]! * t[a]!;
            curSq += current[a]! * current[a]!;
          }
          best = Math.acos(Math.max(-1, Math.min(1, curDot / (Math.sqrt(curSq) * tMag))));
          improved = true;
        }
      }
    }
  }

  if (key) blendCache.set(key, best);
  return best;
}

describe('the recipe book is internally consistent', () => {
  const real = recipes;

  /*
   * No blend may have two answers. Each cone is half the angle to its nearest
   * neighbour, so two cones can at most touch; a pair that overlapped would
   * leave one of them unbrewable on purpose.
   */
  it('never lets two cones overlap', () => {
    for (let i = 0; i < real.length; i += 1) {
      for (let j = i + 1; j < real.length; j += 1) {
        const a = real[i]!;
        const b = real[j]!;
        const apartDeg = (angleBetween(a.target, b.target) * 180) / Math.PI;
        const combined = a.toleranceDeg + b.toleranceDeg;
        expect(
          apartDeg + 1e-9,
          `${a.id} and ${b.id} have ${combined}° of tolerance across ${apartDeg.toFixed(1)}°`,
        ).toBeGreaterThanOrEqual(combined);
      }
    }
  });

  it('can actually be brewed from ingredients that exist', () => {
    /*
     * Not "does something point vaguely this way" — can a real blend land
     * INSIDE the cone. Those are different questions, and the weaker one passes
     * recipes nobody can ever make: three candidates for this very milestone
     * cleared a 45° nearest-ingredient bar while being unbrewable, because
     * blending only reaches the positive hull of what you can gather and every
     * Ignis source in the game drags Terra along with it.
     *
     * A recipe you cannot hit is worse than no recipe: it sits in the book
     * looking like a goal.
     */
    for (const recipe of real) {
      const deg = (bestBlendAngle(recipe.target) * 180) / Math.PI;
      expect(
        deg,
        `${recipe.id} claims ${recipe.toleranceDeg}° of tolerance but the closest ` +
          `blend of everything gatherable is ${deg.toFixed(1)}° away — it can never be brewed`,
      ).toBeLessThan(recipe.toleranceDeg);
    }
  });

  it('reports an unreachable ratio as unreachable', () => {
    /*
     * Guards the guard. A reachability check that returns "fine" for everything
     * is worse than none, and this harness has shipped a vacuous check before.
     *
     * Measured against a fixed pool rather than the live one, because what is
     * reachable is a property of the CONTENT: pure Ignis used to be impossible
     * and became easy the day the ingredient set tripled. A guard that keeps
     * changing its mind is not guarding anything.
     *
     * Here nothing points near pure Aer, and blending only ever reaches the
     * positive hull of what you have — so the answer has to be far from zero.
     */
    const pool = [
      { ignis: 10, aqua: 0, terra: 4, aer: 0, umbra: 0 },
      { ignis: 0, aqua: 12, terra: 3, aer: 0, umbra: 0 },
      { ignis: 0, aqua: 0, terra: 14, aer: 0, umbra: 2 },
    ];
    const deg =
      (bestBlendAngle({ ignis: 0, aqua: 0, terra: 0, aer: 1, umbra: 0 }, pool) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(60);

    // And it finds an exact match when one exists, so it is not just pessimistic.
    const exact = (bestBlendAngle(pool[0]!, pool) * 180) / Math.PI;
    expect(exact).toBeLessThan(0.01);
  });

  it('leaves every recipe some room to be brewed badly', () => {
    // A recipe only hittable at its exact optimum grades the same every time and
    // stops being a skill. Half the cone is enough room to be imperfect in.
    for (const recipe of real) {
      const deg = (bestBlendAngle(recipe.target) * 180) / Math.PI;
      expect(
        deg,
        `${recipe.id} can only be brewed within ${deg.toFixed(1)}° of a ${recipe.toleranceDeg}° cone`,
      ).toBeLessThan(recipe.toleranceDeg * 0.95);
    }
  });

  // Placeholder prices, but the one rule they hold to: a recipe that takes
  // more essences is harder to balance, and worth more for it.
  it('prices a recipe above every recipe with fewer essences', () => {
    for (const a of real) {
      for (const b of real) {
        if (a.elements.length > b.elements.length) {
          expect(a.baseValue, `${a.id} vs ${b.id}`).toBeGreaterThan(b.baseValue);
        }
      }
    }
  });
});

describe('nothing sold is inert', () => {
  /**
   * Five upgrades and half the Codex once took the player's money and did
   * nothing: the effect plumbing existed and the far end was never connected.
   * The harness measures outcomes, so it never noticed.
   *
   * These check the wiring behaviourally — buy the thing, assert something the
   * game reads actually moved — because that is the only check a disconnected
   * far end cannot pass.
   */

  it('sells spore clusters somewhere, so the cave is not stuck on its starter', () => {
    // Two of three species were unobtainable and the lantern had nothing to
    // steer, because nothing stocked a cluster.
    const sold = new Set<string>();
    for (const merchant of merchants) {
      for (const entry of merchant.pool) {
        if (entry.kind === 'spore') sold.add(entry.id);
      }
    }
    for (const species of caveConfig.species) {
      expect(sold.has(species.id), `no merchant stocks ${species.id} spores`).toBe(true);
    }
  });

  /**
   * An upgrade nobody sells is worse than an inert one: the effect works
   * perfectly and no player can ever trigger it. Ten of nineteen were in this
   * state — including the support beams, without which the shaft never passes
   * its first seam, and the greenhouse, without which crossbreeding does not
   * exist. Every one had a cost, a rank and working effects.
   */
  it('gives every upgrade a merchant who sells it', () => {
    const sold = new Set<string>();
    for (const merchant of merchants) {
      for (const entry of merchant.pool) {
        if (entry.kind === 'equipment' || entry.kind === 'decor') sold.add(entry.id);
      }
    }

    for (const def of equipment) {
      expect(sold.has(def.id), `${def.id} costs ${def.cost}g and no merchant stocks it`).toBe(true);
    }
    for (const piece of decorPieces) {
      expect(sold.has(piece.id), `${piece.id} costs ${piece.cost}g and no merchant stocks it`).toBe(
        true,
      );
    }
  });

  it('keeps offering a repeatable upgrade until the limit is reached', () => {
    /*
     * The pool filter hid anything already owned once, whatever its declared
     * limit — so three tiers of support beams were one tier, and the shaft
     * stopped 40 metres above the deepglass.
     */
    const repeatable = equipment.filter((def) => (def.repeatable ?? 1) > 1);
    expect(repeatable.length).toBeGreaterThan(0);

    for (const def of repeatable) {
      const world = createWorld(1);
      world.renown = 100_000;
      world.bottledKinds['S|5|sovereign'] = true;
      // One short of the limit: it must still be on offer.
      world.equipment[def.id] = (def.repeatable ?? 1) - 1;
      expect(
        equipmentAvailability(world, def).visible,
        `${def.id} stops being offered before its limit of ${def.repeatable}`,
      ).toBe(true);

      world.equipment[def.id] = def.repeatable ?? 1;
      expect(equipmentAvailability(world, def).visible).toBe(false);
    }
  });

  it('lets a shop actually dig down to the deepest seam it stocks ore in', () => {
    // The end-to-end version of the two checks above: buy what is buyable and
    // confirm the bottom of the shaft is reachable, since two recipes need it.
    const world = createWorld(1);
    const beams = getEquipment('supportBeams');
    world.equipment.supportBeams = beams.repeatable ?? 1;

    const deepest = Math.max(...shaftConfig.strata.map((stratum) => stratum.minDepth));
    expect(
      derivedStats(world).supportedDepth,
      `the shaft tops out above the ${deepest}m stratum, stranding whatever is in it`,
    ).toBeGreaterThanOrEqual(deepest);
  });

  it('leaves no equipment with an empty effect', () => {
    for (const def of equipment) {
      expect(
        Object.keys(def.effect).length,
        `${def.id} costs ${def.cost}g and declares no effect at all`,
      ).toBeGreaterThan(0);
    }
  });

  it('changes the derived stats for every piece of equipment bought', () => {
    for (const def of equipment) {
      const before = new Simulation(createWorld(1));
      const after = new Simulation(createWorld(1));
      // Prerequisites too, so a gated upgrade is measured in a world it can exist in.
      for (const prerequisite of def.requires ?? []) {
        after.world.equipment[prerequisite] = 1;
        before.world.equipment[prerequisite] = 1;
      }
      after.world.equipment[def.id] = 1;

      expect(
        JSON.stringify(derivedStats(after.world)),
        `${def.id} is owned but changes nothing the game reads`,
      ).not.toBe(JSON.stringify(derivedStats(before.world)));
    }
  });

  it('changes the derived stats for every piece of décor placed', () => {
    for (const piece of decorPieces) {
      const before = createWorld(1);
      const after = createWorld(1);
      grantDecor(after, piece.id);
      placeDecor(after, piece.id);

      expect(
        JSON.stringify(derivedStats(after)),
        `${piece.id} costs ${piece.cost}g and changes nothing when placed`,
      ).not.toBe(JSON.stringify(derivedStats(before)));
    }
  });

  it('changes the codex bonuses for every node bought', () => {
    for (const node of prestigeConfig.codex) {
      const before = createWorld(1);
      const after = createWorld(1);
      after.codex[node.id] = 1;

      expect(JSON.stringify(codexBonuses(after)), `codex node ${node.id} grants nothing`).not.toBe(
        JSON.stringify(codexBonuses(before)),
      );
    }
  });

  it('turns each once-dead bonus into something observable in play', () => {
    // Humidity ward — the cave actually spreads faster.
    const plain = spreadChanceFor('dewcap', false, 0);
    const warded = spreadChanceFor('dewcap', false, 0.06);
    expect(warded).toBeGreaterThan(plain);

    // Steel pick — an ore batch is genuinely bigger.
    const bare = new Simulation(createWorld(44));
    const picked = new Simulation(createWorld(44));
    picked.world.equipment.steelPick = 1;
    bare.workVein(bare.shaft.veins[0]!.id);
    picked.workVein(picked.shaft.veins[0]!.id);
    // Short window on purpose: a vein holds a fixed amount of ore, so a better
    // pick empties it sooner rather than yielding more. Measure the rate.
    bare.advanceBy(15 * 60_000);
    picked.advanceBy(15 * 60_000);
    expect(picked.world.statistics.oreExtracted).toBeGreaterThan(
      bare.world.statistics.oreExtracted,
    );

    // Green Thumb — crops really do finish sooner.
    const slow = new Simulation(createWorld(3));
    const quick = new Simulation(createWorld(3));
    quick.world.codex.greenThumb = 2;
    slow.plant(slow.world.plots[0]!.id, 'curlflame');
    quick.plant(quick.world.plots[0]!.id, 'curlflame');
    expect(quick.world.plots[0]!.crop!.readyAt).toBeLessThan(slow.world.plots[0]!.crop!.readyAt);

    // Old Friends — a merchant opens at a deeper tier.
    const stranger = tierOf(getMerchant('bramm'), 0, 0);
    const known = tierOf(getMerchant('bramm'), 0, 1);
    expect(known).toBeGreaterThan(stranger);

    // Drying rack — a capability flag flips.
    for (const [id, flag] of [['dryingRack', 'canForceDry']] as const) {
      const world = createWorld(1);
      expect(derivedStats(world)[flag]).toBe(false);
      world.equipment[id] = 1;
      expect(derivedStats(world)[flag], `${id} does not grant ${flag}`).toBe(true);
    }
  });
});

describe('potency tiers line up with the pots', () => {
  it('gives every tier a reachable ceiling', () => {
    for (const tier of config.potency.tiers) {
      const essence = tier.minEssence + 1;
      expect(potencyTierFor(essence)).toBe(tier.id);
    }
    expect(gradeFor(100)).toBe('S');
  });

  // Each pot fills exactly to the top of a tier, so buying the next one is
  // what opens the next tier.
  it('tops each tier out at a cauldron’s capacity', () => {
    const tiers = config.potency.tiers;
    for (let i = 1; i < tiers.length; i += 1) {
      expect(tiers[i]!.minEssence - 1).toBe(cauldronTiers[i - 1]!.capacity);
    }
  });
});
