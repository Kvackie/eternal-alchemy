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
import type {
  CauldronContents,
  Essence,
  EssenceVector,
  Freshness,
  Grade,
  PotencyTierId,
} from './types';

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
 * fungus keeps twice as long knows it about every fungus, without checking each
 * one. The `stable` trait no longer decides this — it was set on 157
 * ingredients and told the same story less precisely.
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

/**
 * One unit of an ingredient, aged to `now`.
 *
 * A crossbred unit uses its strain's own essence rather than the wild plant's —
 * that difference is the entire point of breeding, so it has to survive all the
 * way into the pot.
 */
export function unitVector(
  ingredientId: string,
  harvestedAt: number | null,
  now: number,
  strainEssence?: EssenceVector | null,
): EssenceVector {
  const base = strainEssence ?? getIngredient(ingredientId).essence;
  return applyFreshness(base, freshnessOf(ingredientId, harvestedAt, now));
}

export function cauldronVector(
  contents: CauldronContents,
  now: number,
  strainEssenceOf?: (strainId: string) => EssenceVector | null,
): EssenceVector {
  let total = zeroVector();
  for (const unit of contents.units) {
    const strain = unit.strainId ? (strainEssenceOf?.(unit.strainId) ?? null) : null;
    total = addVectors(total, unitVector(unit.ingredientId, unit.harvestedAt, now, strain));
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

export function gradeFor(purity: number): Grade {
  for (const band of config.grading.bands) {
    if (purity >= band.minPurity) return band.grade;
  }
  return 'F';
}

/** Grades are ordered S..F; lower index is better. Used to clamp an Unstable brew. */
const GRADE_ORDER: Grade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

export function worseOf(a: Grade, b: Grade): Grade {
  return GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? a : b;
}

/**
 * What physically went into the pot, as opposed to what it adds up to.
 *
 * Some forms care about the ingredients rather than the blend: Powder needs dry
 * material, Crystal needs stone, a Bomb needs something volatile in it. None of
 * that survives into the essence vector, so it is summarised here at the moment
 * the cauldron is read.
 */
export interface BrewComposition {
  /** 0..1 of units that were Dried. */
  driedShare: number;
  /** 0..1 of units that were minerals. */
  mineralShare: number;
  /** Every trait carried by anything in the pot. */
  traits: string[];
  unitCount: number;
}

export function cauldronComposition(contents: CauldronContents, now: number): BrewComposition {
  const units = contents.units;
  if (units.length === 0) {
    return { driedShare: 0, mineralShare: 0, traits: [], unitCount: 0 };
  }

  let dried = 0;
  let mineral = 0;
  const traits = new Set<string>();

  for (const unit of units) {
    const def = getIngredient(unit.ingredientId);
    if (freshnessOf(unit.ingredientId, unit.harvestedAt, now) === 'dried') dried += 1;
    if (def.category === 'mineral') mineral += 1;
    for (const trait of def.traits) traits.add(trait);
  }

  return {
    driedShare: dried / units.length,
    mineralShare: mineral / units.length,
    traits: [...traits],
    unitCount: units.length,
  };
}

export function emptyComposition(): BrewComposition {
  return { driedShare: 0, mineralShare: 0, traits: [], unitCount: 0 };
}

/** Share of the blend made up by one essence, 0..1. */
export function essenceShare(v: EssenceVector, essence: Essence): number {
  const total = totalEssence(v);
  return total === 0 ? 0 : v[essence] / total;
}
