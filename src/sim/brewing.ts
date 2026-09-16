/**
 * Brewing: temperature, method, and the outcome the player accepts or rejects.
 *
 * A potion is three things at once — a ratio between essences, a temperature
 * band, and a method. Miss the ratio and you are making something else. Miss the
 * method and you are making something else entirely. Miss the temperature and
 * you are making the right thing badly, which is the one of the three that
 * degrades gracefully rather than failing.
 *
 * Nothing here consumes ingredients. The cauldron holds them until the player
 * accepts an outcome, so experimenting is free — which is what makes a numeric
 * temperature band worth discovering by hand.
 */

import { config, getRecipe, fallbackRecipe, realRecipes } from './config';
import {
  angleBetween,
  emptyComposition,
  gradeCeilingFor,
  gradeFor,
  potencyTierFor,
  totalEssence,
  worseOf,
  type BrewComposition,
} from './essences';
import type { BrewMethod, BrewOutcome, EssenceVector, PotencyTierId } from './types';

/** Clamp a temperature into the range the cauldron can physically reach. */
export function clampTemperature(value: number): number {
  const b = config.brewing;
  return Math.min(b.maxTemperature, Math.max(b.minTemperature, value));
}

/**
 * Advance the temperature by one frame.
 *
 * Left alone the cauldron drifts back toward the room, so a temperature is
 * something you hold rather than something you set. The drift is deliberately
 * slow — fast enough that walking away loses your heat, slow enough that you can
 * pick a method and read the outcome without fighting the gauge.
 */
export function driftTemperature(current: number, deltaMs: number, multiplier = 1): number {
  const b = config.brewing;
  const ambient = b.ambientTemperature;
  if (current === ambient) return current;

  // A lagged cauldron holds its heat, which is what that upgrade buys.
  const step = (b.driftRatePerSecond * multiplier * deltaMs) / 1000;
  if (current > ambient) return Math.max(ambient, current - step);
  return Math.min(ambient, current + step);
}

/** Apply held heat or chill for one frame. */
export function applyBurner(
  current: number,
  burner: 'heat' | 'chill' | null,
  deltaMs: number,
): number {
  if (!burner) return current;
  const b = config.brewing;
  const rate = burner === 'heat' ? b.heatRatePerSecond : -b.chillRatePerSecond;
  return clampTemperature(current + (rate * deltaMs) / 1000);
}

/**
 * A single tap, for players who would rather not hold a button down.
 *
 * `degrees` overrides the configured step, which is what the fine controls use:
 * a recipe band can be a few degrees wide, and ramping onto it by holding a
 * burner is a game of reflexes nobody asked for.
 */
export function nudgeTemperature(
  current: number,
  burner: 'heat' | 'chill',
  degrees = config.brewing.tapStepDegrees,
): number {
  return clampTemperature(current + (burner === 'heat' ? degrees : -degrees));
}

/**
 * Does this blend's total essence fall in the recipe's window?
 *
 * A recipe with no window takes any magnitude, which is how every recipe
 * behaved before windows existed.
 */
export function withinEssenceWindow(
  recipe: { essence?: { min: number; max: number | null } },
  essence: number,
): boolean {
  if (!recipe.essence) return true;
  if (essence < recipe.essence.min) return false;
  // Half-open: the top bound belongs to the next rung. Inclusive on both ends
  // made exactly 45 essence both a Faint and a plain Ember Essence, which is
  // one blend with two honest answers.
  return recipe.essence.max === null || essence < recipe.essence.max;
}

/** How tight a recipe's essence window is. Infinity when it names none. */
export function essenceWindowWidth(recipe: {
  essence?: { min: number; max: number | null };
}): number {
  if (!recipe.essence) return Number.POSITIVE_INFINITY;
  // An open-topped window (Sovereign and up) is wide, but still narrower than
  // naming no window at all.
  if (recipe.essence.max === null) return Number.MAX_SAFE_INTEGER;
  return recipe.essence.max - recipe.essence.min;
}

/** How far outside its band a temperature sits. Zero when inside. */
export function degreesOutside(temperature: number, band: { min: number; max: number }): number {
  if (temperature < band.min) return band.min - temperature;
  if (temperature > band.max) return temperature - band.max;
  return 0;
}

/**
 * Work out what the cauldron would produce right now.
 *
 * Identification is a three-way match, and the order matters. Method is checked
 * first because it is a different preparation, not a worse one: simmering a
 * tonic does not make a bad tonic, it makes Murk. Ratio is checked next, against
 * each recipe's own tolerance. Only then does temperature apply, as a penalty
 * proportional to how far outside the band you finished.
 */
export function assessOutcome(args: {
  blend: EssenceVector;
  temperature: number;
  method: BrewMethod | null;
  capacity: number;
  composition?: BrewComposition;
}): BrewOutcome | null {
  const { blend, temperature, method, capacity } = args;
  const composition = args.composition ?? emptyComposition();
  const essence = totalEssence(blend);
  if (essence <= 0) return null;

  let best = fallbackRecipe();
  let bestAngle = Number.POSITIVE_INFINITY;
  let matched = false;

  /*
   * Identification is direction, method AND scale.
   *
   * Direction alone made "a small Ignis draught" and "a sovereign Ignis draught"
   * the same recipe, because potency was derived afterwards from the magnitude
   * and never fed back into which recipe you had made. An `essence` window lets
   * one direction carry a whole ladder of recipes, and lets a signature recipe
   * sit at an exact magnitude inside a broad one.
   *
   * Where two recipes both match, a HAND-AUTHORED one always wins. Ranking by
   * window width instead looked principled and was fragile: a signature needs a
   * window wide enough to actually brew — three dewcaps rather than exactly
   * fifty-one essence — and a generous signature window then lost to a narrow
   * grid band. Being a signature is the thing that should win, so it is what the
   * comparison asks. Within a class, the tighter cone takes it.
   */
  let bestSignature = false;

  if (method) {
    for (const recipe of realRecipes()) {
      if (recipe.method !== 'any' && recipe.method !== method) continue;
      if (!withinEssenceWindow(recipe, essence)) continue;

      const angle = angleBetween(blend, recipe.target);
      if (angle > (recipe.toleranceDeg * Math.PI) / 180) continue;

      const signature = !recipe.generated;
      const better =
        !matched || (signature && !bestSignature) || (signature === bestSignature && angle < bestAngle);
      if (better) {
        best = recipe;
        bestAngle = angle;
        bestSignature = signature;
        matched = true;
      }
    }
  }

  const recipe = getRecipe(best.id);
  const offIdealRad = matched ? bestAngle : angleBetween(blend, recipe.target);

  let contaminantPoints = 0;
  for (const contaminant of recipe.contaminants) contaminantPoints += blend[contaminant];

  const g = config.grading;
  const b = config.brewing;

  const outside = degreesOutside(temperature, recipe.temperature);
  const angular = 100 - offIdealRad * g.purityPerRadian;
  const purity = Math.max(
    g.purityFloor,
    Math.min(
      100,
      angular -
        contaminantPoints * g.contaminantPenaltyPerPoint -
        outside * b.purityPerDegreeOutside,
    ),
  );

  const overCapacity = essence > capacity;
  const potencyTier = potencyTierFor(essence);

  /*
   * Ceilings, and which of them still applies.
   *
   * The potency ceiling exists because a single ingredient cannot miss its own
   * ratio, so direction-only matching handed out a free S for no skill. A recipe
   * that names an essence window has its own skill check — you have to land the
   * magnitude, not just the direction — so the potency ceiling would only stop a
   * precisely-hit signature recipe from ever scoring above C for the crime of
   * being small. Recipes with a window are therefore exempt; direction-only ones
   * keep it.
   *
   * The instability ceiling always applies: boiling over is boiling over.
   */
  let grade = gradeFor(purity);
  if (!recipe.essence) grade = worseOf(grade, gradeCeilingFor(potencyTier));
  if (overCapacity) grade = worseOf(grade, config.cauldron.unstableGrade);

  return {
    recipeId: recipe.id,
    isFallback: !matched,
    total: blend,
    totalEssence: essence,
    offIdealRad,
    contaminantPoints,
    temperature,
    degreesOutsideBand: outside,
    method,
    purity,
    potencyTier,
    overCapacity,
    grade,
    composition,
  };
}

/** How long an accepted brew sits in the pot before it can be bottled. */
export function brewDurationFor(tier: PotencyTierId): number {
  return config.brewing.brewDuration[tier] ?? config.brewing.brewDuration.common;
}

/**
 * Whether the outcome is worth telling the player about before they accept.
 *
 * Used to colour the step 3 summary: a match is green, a wrong method or a
 * badly-missed band is a warning, not an error — rejecting costs nothing.
 */
export function outcomeProblems(outcome: BrewOutcome): string[] {
  const problems: string[] = [];
  if (!outcome.method) problems.push('cauldron.problem.noMethod');
  else if (outcome.isFallback) problems.push('cauldron.problem.noMatch');
  if (outcome.degreesOutsideBand > 0) problems.push('cauldron.problem.temperature');
  if (outcome.contaminantPoints > 0.5) problems.push('cauldron.problem.contaminants');
  if (outcome.overCapacity) problems.push('cauldron.problem.capacity');
  return problems;
}
