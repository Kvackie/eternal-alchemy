import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  applyFreshness,
  cauldronVector,
  freshnessOf,
  gradeFor,
  potencyTierFor,
  totalEssence,
  zeroVector,
} from '@/sim/essences';
import { assessOutcome } from '@/sim/brewing';
import { config, getIngredient, getRecipe, recipes } from '@/sim/config';
import type { CauldronContents, EssenceVector } from '@/sim/types';

const HOUR = 3_600_000;

function contents(...ids: string[]): CauldronContents {
  return { units: ids.map((ingredientId) => ({ ingredientId, harvestedAt: 0 })) };
}

/** Assess a pot of these ingredients, fresh, in a 60-essence cauldron. */
function assess(...ids: string[]) {
  return assessOutcome({ blend: cauldronVector(contents(...ids), 0), capacity: 60 });
}

function assessBlend(blend: EssenceVector) {
  return assessOutcome({ blend, capacity: 1000 });
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

  // `sunleaf` is a herb and `dewcap` a fungus.
  it('ages fungus twice as fast in every stage', () => {
    const f = config.freshness;
    const halfHerbDewfresh = f.dewfreshUntilMs / 2 + 1;
    const halfHerbFresh = f.freshUntilMs / 2 + 1;

    expect(freshnessOf('sunleaf', 0, halfHerbDewfresh)).toBe('dewfresh');
    expect(freshnessOf('dewcap', 0, halfHerbDewfresh)).toBe('fresh');

    expect(freshnessOf('sunleaf', 0, halfHerbFresh)).toBe('fresh');
    expect(freshnessOf('dewcap', 0, halfHerbFresh)).toBe('dried');
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
    const fresh = applyFreshness(base, 'fresh');
    const dried = applyFreshness(base, 'dried');

    // The stated strength is the dewfresh one; drying costs up to a fifth.
    expect(totalEssence(dew)).toBe(totalEssence(base));
    expect(totalEssence(fresh)).toBeLessThan(totalEssence(base));
    expect(totalEssence(dried)).toBeCloseTo(totalEssence(base) * 0.8, 6);

    // Same direction: every component keeps its share of the whole.
    for (const stage of [fresh, dried]) {
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

describe('the recipe book', () => {
  it('has one recipe for every set of essences', () => {
    expect(recipes).toHaveLength(31);
    const sets = new Set(recipes.map((recipe) => [...recipe.elements].sort().join('+')));
    expect(sets.size).toBe(31);
  });

  it('asks for each essence in equal measure', () => {
    for (const recipe of recipes) {
      const parts = Object.values(recipe.target).filter((value) => value > 0);
      expect(parts).toHaveLength(recipe.elements.length);
      expect(new Set(parts).size).toBe(1);
    }
  });

  // Half the angle to the nearest neighbour: 45° apart for a single essence and
  // its pairs, about 26.6° for a four and the five.
  it('sizes each cone halfway to its nearest neighbour', () => {
    expect(getRecipe('ignis').toleranceDeg).toBeCloseTo(22.5, 5);
    expect(getRecipe('ignisAquaTerraAer').toleranceDeg).toBeCloseTo(13.28, 2);
    expect(getRecipe('ignisAquaTerraAerUmbra').toleranceDeg).toBeCloseTo(13.28, 2);
  });
});

describe('purity', () => {
  it('is 100 when the blend sits exactly on the recipe ratio', () => {
    const brew = assessBlend({ ignis: 0, aqua: 20, terra: 20, aer: 0, umbra: 0 });
    expect(brew?.recipeId).toBe('aquaTerra');
    // acos of a dot product lands a few ulps short of exactly zero radians.
    expect(brew?.purity).toBeCloseTo(100, 3);
  });

  it('falls as the ratio drifts, whatever essence moves it', () => {
    const exact = assessBlend({ ignis: 0, aqua: 20, terra: 20, aer: 0, umbra: 0 })!;
    const lopsided = assessBlend({ ignis: 0, aqua: 24, terra: 20, aer: 0, umbra: 0 })!;
    const stray = assessBlend({ ignis: 4, aqua: 20, terra: 20, aer: 0, umbra: 0 })!;
    expect(lopsided.recipeId).toBe('aquaTerra');
    expect(stray.recipeId).toBe('aquaTerra');
    expect(lopsided.purity).toBeLessThan(exact.purity);
    expect(stray.purity).toBeLessThan(exact.purity);
  });

  it('reaches 0 at the edge of the cone, and nothing is made beyond it', () => {
    const edge = (getRecipe('ignis').toleranceDeg * Math.PI) / 180;
    const inside = assessBlend({ ignis: 1, aqua: Math.tan(edge * 0.999), terra: 0, aer: 0, umbra: 0 });
    expect(inside?.recipeId).toBe('ignis');
    expect(inside?.purity).toBeLessThan(1);

    const outside = assessBlend({ ignis: 1, aqua: Math.tan(edge * 1.001), terra: 0, aer: 0, umbra: 0 });
    expect(outside).toBeNull();
  });

  /*
   * The grade is the ratio and nothing else: potency does not cap it, and a
   * great pot does not rescue it.
   */
  it('grades a small exact brew S and a huge sloppy one poorly', () => {
    const small = assessBlend({ ignis: 10, aqua: 0, terra: 0, aer: 0, umbra: 0 })!;
    expect(small.potencyTier).toBe('minor');
    expect(small.grade).toBe('S');

    const huge = assessBlend({ ignis: 400, aqua: 140, terra: 0, aer: 0, umbra: 0 })!;
    expect(huge.recipeId).toBe('ignis');
    expect(huge.potencyTier).toBe('sovereign');
    expect(huge.grade).toBe('F');
  });
});

describe('potency tiers', () => {
  it('buckets by total essence, matching the pots', () => {
    expect(potencyTierFor(1)).toBe('minor');
    expect(potencyTierFor(60)).toBe('minor');
    expect(potencyTierFor(61)).toBe('common');
    expect(potencyTierFor(110)).toBe('common');
    expect(potencyTierFor(111)).toBe('greater');
    expect(potencyTierFor(190)).toBe('greater');
    expect(potencyTierFor(191)).toBe('grand');
    expect(potencyTierFor(320)).toBe('grand');
    expect(potencyTierFor(321)).toBe('sovereign');
  });
});

describe('grading bands', () => {
  it('maps purity onto letters in order', () => {
    expect(gradeFor(100)).toBe('S');
    expect(gradeFor(90)).toBe('S');
    expect(gradeFor(89)).toBe('A');
    expect(gradeFor(75)).toBe('B');
    expect(gradeFor(60)).toBe('C');
    expect(gradeFor(50)).toBe('D');
    expect(gradeFor(30)).toBe('E');
    expect(gradeFor(0)).toBe('F');
  });

  it('asks bigger mixes to sit closer to their ratio', () => {
    // One or two essences: S from 90. Three: every band up 4. Four or five: up 7.
    expect(gradeFor(91, 2)).toBe('S');
    expect(gradeFor(91, 3)).toBe('A');
    expect(gradeFor(94, 3)).toBe('S');
    expect(gradeFor(96, 5)).toBe('A');
    expect(gradeFor(97, 4)).toBe('S');
    expect(gradeFor(60, 5)).toBe('D');
    expect(gradeFor(30, 5)).toBe('F');
    expect(gradeFor(30, 1)).toBe('E');
  });
});

describe('identifying a brew from real ingredients', () => {
  it('makes an Aqua–Terra potion from bilberry and broadleaf', () => {
    const brew = assess('bilberry', 'broadleaf');
    expect(brew?.recipeId).toBe('aquaTerra');
    expect(brew?.grade).toBe('S');
  });

  it('makes an Ignis potion from pepper', () => {
    expect(assess('pepper', 'pepper')?.recipeId).toBe('ignis');
  });

  it('makes an Aer potion from gale thistle', () => {
    expect(assess('galeThistle', 'galeThistle')?.recipeId).toBe('aer');
  });

  it('makes nothing when the blend sits between recipes', () => {
    // Autumnmaple is Ignis and Terra at two to one, which is too much Terra
    // for the Ignis potion and too little for the Ignis–Terra one.
    expect(assess('autumnmaple', 'autumnmaple')).toBeNull();
  });

  it('caps an over-capacity brew at the unstable grade', () => {
    // Three chalk nodules is 72 essence against a capacity of 60.
    const brew = assess('chalkNodule', 'chalkNodule', 'chalkNodule');
    expect(brew?.recipeId).toBe('terra');
    expect(brew?.overCapacity).toBe(true);
    expect(brew?.grade).toBe(config.cauldron.unstableGrade);
  });

  it('does not cap a brew that fits', () => {
    expect(assess('bilberry', 'broadleaf')?.overCapacity).toBe(false);
  });

  it('shows minerals are too coarse to correct a small brew', () => {
    // One chalk nodule is 24 Terra in a single unit. It doesn't nudge the
    // ratio, it slams past it — far enough that the brew stops being the
    // Aqua–Terra potion. Minerals carry mass; herbs do the steering.
    const overshot = assess('bilberry', 'broadleaf', 'chalkNodule');
    expect(overshot?.recipeId).not.toBe('aquaTerra');
  });
});
