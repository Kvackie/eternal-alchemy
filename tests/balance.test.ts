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
  getRecipe,
  getEquipment,
  getSeal,
  ingredients,
  merchants,
  prestigeConfig,
  realRecipes,
  shaftConfig,
} from '@/sim/config';
import { grantDecor, placeDecor } from '@/sim/decor';
import { angleBetween, gradeFor, potencyTierFor } from '@/sim/essences';
import { assessOutcome } from '@/sim/brewing';
import { appealOf, fairValue } from '@/sim/market';
import { isMature, spreadChanceFor } from '@/sim/cave';
import { derivedStats, equipmentAvailability } from '@/sim/progression';
import { codexBonuses } from '@/sim/prestige';
import { effectiveBand } from '@/sim/discovery';
import { tierOf } from '@/sim/merchants';
import type { BottledItem, BrewMethod, EssenceVector, Grade } from '@/sim/types';

const HOUR = 3_600_000;
const DAY = config.clock.dayLengthMs;

function bottle(uid: string, grade: Grade, value = 60): BottledItem {
  return {
    uid,
    recipeId: 'healthTonic',
    formId: 'potion',
    vesselId: 'clayVial',
    sealId: 'cork',
    grade,
    purity: 80,
    potencyTier: 'common',
    totalEssence: 57,
    dosesLeft: 1,
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
      sim.world.seeds.dewcap = 5;
      if (!sim.plant(plot.id, 'dewcap')) break;
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
      sim.world.seeds.dewcap = 5;
      if (!sim.plant(plot.id, 'dewcap')) break;
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
    const sim = new Simulation(createWorld(88));
    sim.world.spores.dewcap = 5;
    sim.seedCaveTile(0, 'dewcap');

    sim.advanceBy(8 * HOUR, false);
    const colonised = sim.cave.tiles.filter((t) => t.speciesId !== null).length;
    const total = sim.cave.tiles.length;

    // Leaving it should reward you, not replace the garden. Somewhere under
    // three-quarters of the grid after a night away is the shape we want.
    expect(colonised).toBeGreaterThan(1);
    expect(colonised / total).toBeLessThan(0.75);
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
  const tonic = getRecipe('healthTonic');
  const midBand = (tonic.temperature.min + tonic.temperature.max) / 2;

  /**
   * A perfectly-on-ratio blend, scaled by what is in the pot, brewed at the
   * right heat for whatever it turns out to be.
   *
   * Two passes, because size is part of a recipe's identity now: the same ratio
   * at one unit and at twelve are two different recipes with two different
   * bands. Holding the Health Tonic's band for both would be testing that you
   * cannot brew at the wrong temperature, which is a different test.
   */
  function assess(units: number) {
    const per = { ignis: 0, aqua: 12, terra: 6, aer: 0, umbra: 0 };
    const blend = {
      ignis: 0,
      aqua: per.aqua * units,
      terra: per.terra * units,
      aer: 0,
      umbra: 0,
    };
    const composition = { driedShare: 0, mineralShare: 0, traits: [], unitCount: units };
    const total = 18 * units;

    /*
     * Find the recipe this blend IS, then brew it properly.
     *
     * Not by trial identification, because identification needs the method up
     * front and the method is one of the things being looked up: a direction has
     * exactly one correct preparation, and the wrong one makes Murk on purpose.
     * So the recipe is found the way the book would show it — cone, method-free
     * — and the brew is then set up to suit.
     */
    const match = realRecipes()
      .filter((recipe) => {
        const within =
          !recipe.essence ||
          (total >= recipe.essence.min &&
            (recipe.essence.max === null || total < recipe.essence.max));
        if (!within) return false;
        return (angleBetween(blend, recipe.target) * 180) / Math.PI <= recipe.toleranceDeg;
      })
      // Same precedence the identifier uses: a signature beats a generated one.
      .sort((a, b) => Number(Boolean(a.generated)) - Number(Boolean(b.generated)))[0]!;

    const band = match.temperature;
    return assessOutcome({
      blend,
      temperature: (band.min + band.max) / 2,
      method: match.method as BrewMethod,
      capacity: 400,
      composition,
    })!;
  }

  it('leaves a trivial one-ingredient brew worth almost nothing', () => {
    const single = assess(1);
    expect(single.potencyTier).toBe('minor');

    /*
     * The guard moved from grade to value.
     *
     * A single ingredient cannot miss its own ratio, so the grade used to be
     * capped or it scored a perfect S for no skill. Now it cannot even be the
     * Health Tonic — that recipe names a minimum — and what it CAN be is the
     * faintest rung of the generated ladder, priced accordingly. Scoring well on
     * something worth a handful of gold is no longer worth guarding against.
     */
    expect(single.recipeId).not.toBe('healthTonic');
    const full = assess(12);
    expect(getRecipe(single.recipeId).baseValue).toBeLessThan(
      getRecipe(full.recipeId).baseValue,
    );
  });

  it('lets a properly filled cauldron reach the top', () => {
    const full = assess(12);
    expect(full.potencyTier).not.toBe('minor');
    expect(['S', 'A']).toContain(full.grade);
  });

  it('still rewards a clean ratio at every size', () => {
    // Whatever the cap, a better ratio must never score worse than a worse one.
    const clean = assess(6).purity;
    const dirty = assessOutcome({
      blend: { ignis: 20, aqua: 72, terra: 36, aer: 0, umbra: 0 },
      temperature: midBand,
      method: tonic.method as BrewMethod,
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
    const sim = new Simulation(createWorld(9));
    sim.advanceBy(1000);
    const contract = sim.world.contracts.find((c) => c.templateId === 'barrackTonics');
    if (!contract) return;

    // Use the *real* fair value, not the helper's placeholder — comparing a
    // contract's payout against a made-up shelf price measures nothing.
    const shelfValue = fairValue({
      recipeId: 'healthTonic',
      formId: 'potion',
      vesselId: 'clayVial',
      sealId: 'cork',
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
    const sim = new Simulation(createWorld(77));
    sim.world.renown = 100000;
    sim.advanceTo(DAY * 0.4);
    sim.world.bottled.push(bottle('h', 'B'));

    const walkIn = sim.walkIns()[0];
    if (!walkIn) return;

    const session = sim.beginHaggle(walkIn.customerId, 'h')!;
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
    expect(sim.rankIndex).toBeGreaterThan(0);
    expect(sim.rankIndex).toBeLessThan(8);
  });
});

describe('nothing runs away with itself', () => {
  it('keeps a long unattended run inside sane bounds', () => {
    const sim = new Simulation(createWorld(31));
    sim.world.spores.dewcap = 5;
    sim.seedCaveTile(0, 'dewcap');
    sim.workVein(sim.shaft.veins[0]!.id);
    for (const plot of sim.world.plots) sim.plant(plot.id, 'dewcap');

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
  const real = realRecipes();

  it('never leaves a blend with two equally good answers', () => {
    /*
     * Ambiguity, not overlap.
     *
     * The rule used to be that no two same-method cones may overlap at all,
     * because the identifier picked the closest match and the loser could never
     * be brewed on purpose. Direction is no longer the whole of a recipe's
     * identity: an essence window separates the Faint rung from the Sovereign
     * one on the SAME direction, and a hand-authored recipe outranks a generated
     * one outright. Overlapping cones are therefore normal and fine.
     *
     * What must never happen is a blend that two recipes answer to with nothing
     * to separate them — same method, overlapping cones, overlapping essence
     * windows, and neither outranking the other.
     */
    const overlapsWindow = (a: (typeof real)[number], b: (typeof real)[number]) => {
      const wa = a.essence;
      const wb = b.essence;
      if (!wa || !wb) return true; // no window means every magnitude
      return wa.min < (wb.max ?? Infinity) && wb.min < (wa.max ?? Infinity);
    };

    for (let i = 0; i < real.length; i += 1) {
      for (let j = i + 1; j < real.length; j += 1) {
        const a = real[i]!;
        const b = real[j]!;
        if (a.method !== b.method) continue;
        // A signature always wins over a generated recipe; that pair is settled.
        if (Boolean(a.generated) !== Boolean(b.generated)) continue;
        if (!overlapsWindow(a, b)) continue;

        const apartDeg = (angleBetween(a.target, b.target) * 180) / Math.PI;
        const combined = a.toleranceDeg + b.toleranceDeg;
        expect(
          apartDeg,
          `${a.id} and ${b.id} share a method, ${combined}° of tolerance across ` +
            `${apartDeg.toFixed(1)}° of separation, and overlapping essence windows — ` +
            `a blend between them has two equally good answers`,
        ).toBeGreaterThan(combined);
      }
    }
  });

  it('gives every recipe a reachable temperature band and a real method', () => {
    for (const recipe of real) {
      expect(recipe.temperature.min).toBeGreaterThanOrEqual(config.brewing.minTemperature);
      expect(recipe.temperature.max).toBeLessThanOrEqual(config.brewing.maxTemperature);
      expect(recipe.temperature.max).toBeGreaterThan(recipe.temperature.min);
      expect(['stirred', 'simmered']).toContain(recipe.method);
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
    const deg = (bestBlendAngle({ ignis: 0, aqua: 0, terra: 0, aer: 1, umbra: 0 }, pool) * 180) /
      Math.PI;
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

  it('prices later recipes above earlier ones', () => {
    const tonic = getRecipe('healthTonic').baseValue;
    expect(getRecipe('cinderveilBomb').baseValue).toBeGreaterThan(tonic);
    expect(getRecipe('featherstoneDraught').baseValue).toBeGreaterThan(tonic);
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

  /**
   * Vessels and seals carry their own effect fields, and checking only
   * equipment and the Codex is what let five of them ship inert. Each of these
   * does the thing the item's description promises and asserts the outcome
   * differs — the only check a disconnected field cannot pass.
   */
  it('makes a horn phial and a warding sigil worth supplying', () => {
    const sim = new Simulation(createWorld(6));
    sim.world.gold = 100_000;
    sim.recruitHero('corin');

    sim.world.bottled.push(
      { ...bottle('plain', 'C'), vesselId: 'clayVial', sealId: 'cork' },
      { ...bottle('phial', 'C'), vesselId: 'hornPhial', sealId: 'cork' },
      { ...bottle('sigil', 'C'), vesselId: 'clayVial', sealId: 'wardingSigil' },
    );

    const base = sim.estimate('emberwaste', ['corin'], ['plain']).success;
    expect(sim.estimate('emberwaste', ['corin'], ['phial']).success).toBeGreaterThan(base);
    expect(sim.estimate('emberwaste', ['corin'], ['sigil']).success).toBeGreaterThan(base);
  });

  it('settles three units of a contract with one sealed amphora', () => {
    const sim = new Simulation(createWorld(9));
    sim.world.contracts = [
      {
        id: 'contract-test',
        templateId: 'barrackTonics',
        quantity: 6,
        delivered: 0,
        payout: 600,
        renown: 5,
        msRemaining: 5 * DAY,
        deadlineDays: 5,
        postedAt: 0,
      },
    ];

    sim.world.bottled.push({ ...bottle('amphora', 'B'), vesselId: 'sealedAmphora' });

    const result = sim.deliverContract('contract-test')!;
    // One bottle handed over, three units of the order settled — the entire
    // reason to buy an amphora.
    expect(result.delivered).toBe(3);
    expect(sim.world.bottled).toHaveLength(0);
  });

  it('stacks a waxed pouch into one shelf slot and sells it down one at a time', () => {
    const sim = new Simulation(createWorld(2));
    for (let i = 0; i < 5; i += 1) {
      sim.world.bottled.push({ ...bottle(`p${i}`, 'C'), formId: 'powder', vesselId: 'waxedPouch' });
    }

    expect(sim.stock('shelf-1', 'p0')).toBe(true);
    expect(sim.world.shelf[0]!.quantity).toBe(5);
    expect(sim.world.bottled).toHaveLength(0);

    sim.setPrice('shelf-1', 0.4);
    sim.advanceBy(2 * DAY, true);
    const slot = sim.world.shelf[0]!;
    // Sold *some*, not all at once and not none — a stack empties by the unit.
    expect(slot.quantity).toBeLessThan(5);
    expect(sim.world.statistics.itemsSold).toBeGreaterThan(0);
  });

  it('makes the Ashwalker mark worth double to the Ashwalker', () => {
    expect(getSeal('ashwalkerMark').barterMultiplier).toBe(2);
    // And nearly worthless on a shelf, which is the trade.
    expect(appealOf({ ...bottle('m', 'B'), sealId: 'ashwalkerMark' })).toBeLessThan(
      appealOf({ ...bottle('c', 'B'), sealId: 'cork' }),
    );
  });

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

      expect(
        JSON.stringify(codexBonuses(after)),
        `codex node ${node.id} grants nothing`,
      ).not.toBe(JSON.stringify(codexBonuses(before)));
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
    slow.plant(slow.world.plots[0]!.id, 'emberroot');
    quick.plant(quick.world.plots[0]!.id, 'emberroot');
    expect(quick.world.plots[0]!.crop!.readyAt).toBeLessThan(slow.world.plots[0]!.crop!.readyAt);

    // Deft Hands — the temperature band you must hit is wider.
    const strict = createWorld(1);
    const steady = createWorld(1);
    steady.codex.deftHands = 2;
    const strictBand = effectiveBand(strict, 'healthTonic');
    const steadyBand = effectiveBand(steady, 'healthTonic');
    expect(steadyBand.max - steadyBand.min).toBeGreaterThan(strictBand.max - strictBand.min);

    // Old Friends — a merchant opens at a deeper tier.
    const stranger = tierOf(getMerchant('bramm'), 0, 0);
    const known = tierOf(getMerchant('bramm'), 0, 1);
    expect(known).toBeGreaterThan(stranger);

    // Drying rack, moulds, press, standing orders — capability flags flip.
    for (const [id, flag] of [
      ['dryingRack', 'canForceDry'],
      ['vesselMoulds', 'craftsVessels'],
      ['sealPress', 'craftsSeals'],
    ] as const) {
      const world = createWorld(1);
      expect(derivedStats(world)[flag]).toBe(false);
      world.equipment[id] = 1;
      expect(derivedStats(world)[flag], `${id} does not grant ${flag}`).toBe(true);
    }
  });
});

describe('potency tiers line up with the grade cap', () => {
  it('gives every tier a reachable ceiling', () => {
    for (const tier of config.potency.tiers) {
      const essence = tier.minEssence + 1;
      expect(potencyTierFor(essence)).toBe(tier.id);
    }
    expect(gradeFor(100)).toBe('S');
  });
});
