import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  applyFreshness,
  cauldronVector,
  freshnessOf,
  gradeFor,
  potencyTierFor,
  purityFor,
  totalEssence,
  zeroVector,
} from '@/sim/essences';
import { assessOutcome } from '@/sim/brewing';
import { config, getIngredient, getRecipe } from '@/sim/config';
import type { BrewMethod, CauldronContents } from '@/sim/types';

const HOUR = 3_600_000;

function contents(...ids: string[]): CauldronContents {
  return { units: ids.map((ingredientId) => ({ ingredientId, harvestedAt: 0 })) };
}

/** Assess a pot at the right temperature and method for a given recipe. */
function assess(recipeId: string, ...ids: string[]) {
  const recipe = getRecipe(recipeId);
  return assessOutcome({
    blend: cauldronVector(contents(...ids), 0),
    temperature: (recipe.temperature.min + recipe.temperature.max) / 2,
    method: (recipe.method === 'any' ? 'stirred' : recipe.method) as BrewMethod,
    capacity: 60,
  });
}

describe('essence vectors', () => {
  it('sums an empty blend to zero', () => {
    expect(totalEssence(zeroVector())).toBe(0);
  });

  it('treats identical directions as zero angle regardless of magnitude', () => {
    const a = { ignis: 0, aqua: 2, terra: 1, aer: 0, umbra: 0 };
    const b = { ignis: 0, aqua: 20, terra: 10, aer: 0, umbra: 0 };
    expect(angleBetween(a, b)).toBeCloseTo(0, 6);
  });
});

describe('freshness', () => {
  it('is dewfresh immediately after harvest', () => {
    expect(freshnessOf('sunleaf', 0, HOUR)).toBe('dewfresh');
  });

  it('reaches dried past the fresh window', () => {
    expect(freshnessOf('sunleaf', 0, config.freshness.freshUntilMs + 1)).toBe('dried');
  });

  it('never ages minerals', () => {
    expect(freshnessOf('chalkNodule', null, 100 * HOUR)).toBe('fresh');
  });

  /*
   * Ageing belongs to the category.
   *
   * A mineral with a harvest stamp on it — which happens the moment anything
   * grants one through the normal ingredient path rather than the shaft's
   * null-stamped one — must still never age, or the rule would hold only for
   * stock that arrived by one particular route.
   */
  it('never ages a mineral even when it carries a stamp', () => {
    expect(freshnessOf('chalkNodule', 0, 100 * HOUR)).toBe('fresh');
  });

  // `sunleaf` is a herb and `dewcap` a fungus, despite the names.
  it('gives fungus twice as long in every stage', () => {
    const f = config.freshness;
    const pastHerbDewfresh = f.dewfreshUntilMs + 1;
    const pastHerbFresh = f.freshUntilMs + 1;

    expect(freshnessOf('sunleaf', 0, pastHerbDewfresh)).toBe('fresh');
    expect(freshnessOf('dewcap', 0, pastHerbDewfresh)).toBe('dewfresh');

    expect(freshnessOf('sunleaf', 0, pastHerbFresh)).toBe('dried');
    expect(freshnessOf('dewcap', 0, pastHerbFresh)).toBe('fresh');
    expect(freshnessOf('dewcap', 0, f.freshUntilMs * 2 + 1)).toBe('dried');
  });

  /*
   * Freshness scales and never steers.
   *
   * Drying used to convert a share of Aqua into Terra, so a dried herb pointed
   * at a different recipe than a fresh one. That is gone: the ratio between
   * essences must survive every age, or an ingredient's dialog cannot tell a
   * player what their stock is for.
   */
  it('scales essence with age and leaves the blend pointing the same way', () => {
    const base = getIngredient('dewcap').essence;
    const dew = applyFreshness(base, 'dewfresh');
    const dried = applyFreshness(base, 'dried');

    expect(totalEssence(dew)).toBeGreaterThan(totalEssence(base));
    expect(totalEssence(dried)).toBeLessThan(totalEssence(base));

    // Same direction: every component keeps its share of the whole.
    for (const stage of [dew, dried]) {
      const ratio = totalEssence(stage) / totalEssence(base);
      expect(stage.aqua).toBeCloseTo(base.aqua * ratio, 6);
      expect(stage.terra).toBeCloseTo(base.terra * ratio, 6);
    }
  });

  it('never reduces an ingredient to nothing', () => {
    const base = getIngredient('sunleaf').essence;
    expect(totalEssence(applyFreshness(base, 'dried'))).toBeGreaterThan(0);
  });
});

describe('purity', () => {
  it('is highest when the blend sits exactly on the recipe ratio', () => {
    const onTarget = { ignis: 0, aqua: 20, terra: 10, aer: 0, umbra: 0 };
    // acos of a dot product lands a few ulps short of exactly zero radians.
    expect(purityFor(onTarget, 'healthTonic').purity).toBeCloseTo(100, 5);
  });

  it('is penalised by essences the recipe does not want', () => {
    const clean = { ignis: 0, aqua: 20, terra: 10, aer: 0, umbra: 0 };
    const dirty = { ignis: 6, aqua: 20, terra: 10, aer: 0, umbra: 0 };
    expect(purityFor(dirty, 'healthTonic').purity).toBeLessThan(purityFor(clean, 'healthTonic').purity);
  });

  it('never falls below the configured floor', () => {
    const awful = { ignis: 100, aqua: 0, terra: 0, aer: 100, umbra: 100 };
    expect(purityFor(awful, 'healthTonic').purity).toBe(config.grading.purityFloor);
  });
});

describe('potency tiers', () => {
  it('buckets by total essence', () => {
    expect(potencyTierFor(30)).toBe('minor');
    expect(potencyTierFor(57)).toBe('common');
    expect(potencyTierFor(120)).toBe('greater');
    expect(potencyTierFor(200)).toBe('grand');
    expect(potencyTierFor(400)).toBe('sovereign');
  });
});

describe('grading bands', () => {
  it('maps purity onto letters in order', () => {
    expect(gradeFor(100)).toBe('S');
    expect(gradeFor(90)).toBe('A');
    expect(gradeFor(80)).toBe('B');
    expect(gradeFor(71)).toBe('C');
    expect(gradeFor(55)).toBe('D');
    expect(gradeFor(0)).toBe('F');
  });
});

describe('identifying a brew from real ingredients', () => {
  it('identifies the health tonic from dewcaps', () => {
    const brew = assess('healthTonic', 'dewcap', 'dewcap', 'dewcap');
    expect(brew?.recipeId).toBe('healthTonic');
    expect(brew?.isFallback).toBe(false);
  });

  it('identifies the ember draught from emberroot', () => {
    const brew = assess('emberDraught', 'emberroot', 'emberroot');
    expect(brew?.recipeId).toBe('emberDraught');
  });

  it('identifies the wind draught from gale thistle', () => {
    const brew = assess('windDraught', 'galeThistle', 'galeThistle');
    expect(brew?.recipeId).toBe('windDraught');
  });

  it('falls back to murk when nothing matches', () => {
    // Sunleaf spreads its essence across Ignis, Aqua and Aer at once, which
    // points at no recipe's ratio in particular.
    const brew = assess('healthTonic', 'sunleaf', 'sunleaf');
    expect(brew?.isFallback).toBe(true);
    expect(brew?.recipeId).toBe('murk');
  });

  it('caps an over-capacity brew at the unstable grade', () => {
    // Six chalk nodules is 156 essence against a capacity of 60.
    const brew = assess('healthTonic', ...Array(6).fill('chalkNodule'));
    expect(brew?.overCapacity).toBe(true);
    expect(['D', 'E', 'F']).toContain(brew?.grade);
  });

  it('does not cap a brew that fits', () => {
    const brew = assess('healthTonic', 'dewcap', 'dewcap', 'dewcap');
    expect(brew?.overCapacity).toBe(false);
  });

  it('shows minerals are too coarse to correct a small brew', () => {
    // Three emberroot sit at 3.5:1 Ignis:Terra against an ideal of 3:1 — close.
    const plain = assess('emberDraught', 'emberroot', 'emberroot', 'emberroot');
    expect(plain?.recipeId).toBe('emberDraught');

    // One chalk nodule is 26 Terra in a single unit. It doesn't nudge the ratio,
    // it slams past it — far enough that the brew stops being an Ember Draught.
    // This is the intended shape: minerals carry mass, herbs do the steering.
    const overshot = assess(
      'emberDraught',
      'emberroot',
      'emberroot',
      'emberroot',
      'chalkNodule',
    );
    expect(overshot?.isFallback).toBe(true);
    expect(overshot?.recipeId).toBe('murk');
  });
});
