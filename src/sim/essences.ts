/**
 * Essence vectors, purity, potency and grading.
 *
 * The whole crafting system reduces to one idea: an ingredient is a vector in
 * 5-space, a recipe is a direction in that space, and purity is how close your
 * blend's direction is to the recipe's. Potency is the blend's total essence,
 * bucketed into tiers. Those two numbers are independent: the grade reads the
 * first, the potency the second.
 */

import { config, getIngredient } from './config';
import { ESSENCES } from './types';
import type { CauldronContents, EssenceVector, Freshness, Grade, PotencyTierId } from './types';

export function zeroVector(): EssenceVector {
  return { ignis: 0, aqua: 0, terra: 0, aer: 0, umbra: 0 };
}

export function addVectors(a: EssenceVector, b: EssenceVector): EssenceVector {
  const out = zeroVector();
  for (const e of ESSENCES) out[e] = a[e] + b[e];
  return out;
}

export function scaleVector(v: EssenceVector, k: number): EssenceVector {
  const out = zeroVector();
  for (const e of ESSENCES) out[e] = v[e] * k;
  return out;
}

export function magnitude(v: EssenceVector): number {
  let sum = 0;
  for (const e of ESSENCES) sum += v[e] * v[e];
  return Math.sqrt(sum);
}

/** Total essence — the number the potency tiers read. Sum, not length. */
export function totalEssence(v: EssenceVector): number {
  let sum = 0;
  for (const e of ESSENCES) sum += v[e];
  return sum;
}

/** Angle between two essence vectors, radians. Zero-length vectors are maximally distant. */
export function angleBetween(a: EssenceVector, b: EssenceVector): number {
  const ma = magnitude(a);
  const mb = magnitude(b);
  if (ma === 0 || mb === 0) return Math.PI / 2;
  let dot = 0;
  for (const e of ESSENCES) dot += a[e] * b[e];
  const cos = Math.min(1, Math.max(-1, dot / (ma * mb)));
  return Math.acos(cos);
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * How long a category's stages last, as a multiple of the base schedule.
 *
 * Zero means it never ages. Reading it from the category rather than from a
 * per-ingredient trait is what keeps the rule learnable: a player who knows
 * fungus ages twice as fast knows it about every fungus, without checking each
 * one.
 */
export function agingRateFor(ingredientId: string): number {
  const { category } = getIngredient(ingredientId);
  const f = config.freshness;
  if (f.agelessCategories.includes(category)) return 0;
  return f.categoryAgeMultiplier[category] ?? 1;
}

/**
 * Which stage a unit is in.
 *
 * `harvestedAt: null` — how mined stone is stored — is Fresh for ever, and so
 * is anything in an ageless category even if it does carry a stamp.
 */
export function freshnessOf(
  ingredientId: string,
  harvestedAt: number | null,
  now: number,
): Freshness {
  if (harvestedAt === null) return 'fresh';

  const rate = agingRateFor(ingredientId);
  if (rate <= 0) return 'fresh';

  const age = Math.max(0, now - harvestedAt);
  if (age < config.freshness.dewfreshUntilMs * rate) return 'dewfresh';
  if (age < config.freshness.freshUntilMs * rate) return 'fresh';
  return 'dried';
}

/**
 * When a unit next drops a stage, or null if it never will again.
 *
 * The same boundaries `freshnessOf` reads, at the same category rate — a
 * countdown built from the bare config figures ran a fungus's clock at twice
 * its real speed and counted down on stone that never ages.
 */
export function nextFreshnessChangeAt(
  ingredientId: string,
  harvestedAt: number | null,
  now: number,
): number | null {
  if (harvestedAt === null) return null;
  const rate = agingRateFor(ingredientId);
  if (rate <= 0) return null;

  for (const until of [config.freshness.dewfreshUntilMs, config.freshness.freshUntilMs]) {
    const at = harvestedAt + until * rate;
    if (now < at) return at;
  }
  return null;
}

/**
 * Freshness scales an ingredient's essence and nothing else.
 *
 * Drying used to move a share of Aqua into Terra as well, which made a dried
 * herb point at a different recipe than a fresh one — a rule that applied to
 * some ingredients and not others, and that no player could see coming. It is
 * one multiplier now: the blend keeps its direction at every age, and only its
 * strength moves. Nothing ever rots to nothing.
 */
export function applyFreshness(base: EssenceVector, freshness: Freshness): EssenceVector {
  const f = config.freshness;
  if (freshness === 'dewfresh') return scaleVector(base, f.dewfreshEssenceMultiplier);
  if (freshness === 'fresh') return scaleVector(base, f.freshEssenceMultiplier);
  return scaleVector(base, f.driedEssenceMultiplier);
}

/** One unit of an ingredient, aged to `now`. */
export function unitVector(
  ingredientId: string,
  harvestedAt: number | null,
  now: number,
): EssenceVector {
  return applyFreshness(
    getIngredient(ingredientId).essence,
    freshnessOf(ingredientId, harvestedAt, now),
  );
}

export function cauldronVector(contents: CauldronContents, now: number): EssenceVector {
  let total = zeroVector();
  for (const unit of contents.units) {
    total = addVectors(total, unitVector(unit.ingredientId, unit.harvestedAt, now));
  }
  return total;
}

// ---------------------------------------------------------------------------
// Potency & grading
// ---------------------------------------------------------------------------

export function potencyTierFor(essence: number): PotencyTierId {
  const tiers = config.potency.tiers;
  let current: PotencyTierId = 'minor';
  for (const tier of tiers) {
    if (essence >= tier.minEssence) current = tier.id;
  }
  return current;
}

export function potencyMultiplier(tier: PotencyTierId): number {
  return config.potency.tiers.find((t) => t.id === tier)?.valueMultiplier ?? 1;
}

export function potencyRank(tier: PotencyTierId): number {
  return config.potency.tiers.findIndex((t) => t.id === tier);
}

/**
 * The letter for a purity, on the ladder for a potion of this many essences.
 *
 * The bands are written for S at 90. A bigger mix raises S, and every band
 * above F rises with it by the same amount, so a three- or five-way blend has
 * to sit closer to its ratio for each letter than a simple one does. F stays at
 * 0: it is everything below E, however high E has gone.
 */
export function gradeFor(purity: number, essenceCount = 1): Grade {
  const bands = config.grading.bands;
  const sFromByEssenceCount = config.grading.sFromByEssenceCount;
  const index = Math.min(Math.max(essenceCount, 1), sFromByEssenceCount.length) - 1;
  const shift = sFromByEssenceCount[index]! - bands[0]!.minPurity;
  for (const band of bands) {
    const from = band.minPurity > 0 ? Math.min(100, band.minPurity + shift) : 0;
    if (purity >= from) return band.grade;
  }
  return 'F';
}

/** Grades run S..F, best first: a lower index is a better grade. */
export const GRADE_ORDER: readonly Grade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

/** Whether `grade` is `minimum` or better. A grade this build does not know never is. */
export function gradeAtLeast(grade: Grade, minimum: Grade): boolean {
  const index = GRADE_ORDER.indexOf(grade);
  return index >= 0 && index <= GRADE_ORDER.indexOf(minimum);
}

export function worseOf(a: Grade, b: Grade): Grade {
  return GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? a : b;
}
