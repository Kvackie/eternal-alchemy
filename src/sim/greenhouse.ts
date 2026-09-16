/**
 * The greenhouse and crossbreeding.
 *
 * This is the long-tail hook. A player who has seen everything else is still
 * breeding a perfect Aqua donor at hour sixty, because a crossed seed inherits a
 * *blend* of its parents' essences and occasionally picks up a trait neither
 * had.
 *
 * Crossbred strains are stored on the world rather than in the data files —
 * they are the one kind of content the player makes rather than finds.
 */

import { config, getCrop, getIngredient } from './config';
import { ESSENCES } from './types';
import type { EssenceVector, Strain, World } from './types';
import type { Rng } from './rng';

/** Traits a cross can throw up, and what each is worth. */
export const MUTATIONS = ['potent', 'pure', 'twinned', 'volatile'] as const;
export type Mutation = (typeof MUTATIONS)[number];

export function strainById(world: World, strainId: string): Strain | undefined {
  return world.strains.find((strain) => strain.id === strainId);
}

/** The essence a strain yields — its own blend, not its parent crop's. */
export function strainEssence(world: World, strainId: string): EssenceVector | null {
  return strainById(world, strainId)?.essence ?? null;
}

export interface CrossCandidate {
  cropId: string;
  strainId: string | null;
  essence: EssenceVector;
  label: string;
}

/**
 * What a cross between two parents would produce.
 *
 * The child sits midway between its parents, which is the whole point: crossing
 * a high-Aqua herb with a high-Terra one gives something neither parent could
 * reach on its own, and repeated crossing walks a lineage toward a target.
 */
export function previewCross(a: EssenceVector, b: EssenceVector): EssenceVector {
  const out = { ignis: 0, aqua: 0, terra: 0, aer: 0, umbra: 0 } as EssenceVector;
  for (const essence of ESSENCES) {
    out[essence] = (a[essence] + b[essence]) / 2;
  }
  return out;
}

function applyMutation(essence: EssenceVector, mutation: Mutation): EssenceVector {
  const out = { ...essence };
  if (mutation === 'potent') {
    for (const key of ESSENCES) out[key] *= 1.25;
  }
  if (mutation === 'pure') {
    // Pure sharpens the dominant essence and dulls the rest, which is what makes
    // a bred strain able to hit a ratio the wild plants cannot.
    let dominant: (typeof ESSENCES)[number] = 'terra';
    for (const key of ESSENCES) if (out[key] > out[dominant]) dominant = key;
    for (const key of ESSENCES) out[key] = key === dominant ? out[key] * 1.3 : out[key] * 0.6;
  }
  return out;
}

export interface CrossResult {
  strain: Strain;
  mutation: Mutation | null;
}

/**
 * Cross two parents into a new strain.
 *
 * The result is a seed, not a plant: you still have to grow it. That keeps
 * breeding a project rather than a button.
 */
export function cross(
  world: World,
  rng: Rng,
  parentA: CrossCandidate,
  parentB: CrossCandidate,
): CrossResult | null {
  const gh = config.greenhouse;
  if (world.strains.length >= gh.maxStrains) return null;

  let essence = previewCross(parentA.essence, parentB.essence);

  let mutation: Mutation | null = null;
  if (rng.chance(gh.mutationChance)) {
    mutation = MUTATIONS[rng.int(0, MUTATIONS.length - 1)] ?? null;
    if (mutation) essence = applyMutation(essence, mutation);
  }

  // Round so the numbers a player reads are the numbers the maths uses.
  for (const key of ESSENCES) essence[key] = Math.round(essence[key] * 10) / 10;

  const parentCrop = getCrop(parentA.cropId);
  const strain: Strain = {
    id: `strain-${world.nextStrainId}`,
    baseCropId: parentA.cropId,
    generation:
      Math.max(
        parentA.strainId ? (strainById(world, parentA.strainId)?.generation ?? 0) : 0,
        parentB.strainId ? (strainById(world, parentB.strainId)?.generation ?? 0) : 0,
      ) + 1,
    essence,
    traits: mutation === 'volatile' ? ['volatile'] : mutation === 'pure' ? ['pure'] : [],
    growMs: Math.round(parentCrop.growMs * (mutation === 'twinned' ? 1.2 : 1)),
    yieldBonus: mutation === 'twinned' ? 2 : 0,
  };

  world.nextStrainId += 1;
  world.strains.push(strain);
  world.seeds[strain.id] = (world.seeds[strain.id] ?? 0) + gh.seedsPerCross;
  world.statistics.strainsBred += 1;

  return { strain, mutation };
}

/** Every parent available to cross: wild crops plus everything already bred. */
export function crossCandidates(world: World): CrossCandidate[] {
  const wild: CrossCandidate[] = [];
  for (const crop of config.greenhouse.crossableCrops) {
    const def = getCrop(crop);
    wild.push({
      cropId: crop,
      strainId: null,
      essence: getIngredient(def.yields).essence,
      label: crop,
    });
  }

  const bred = world.strains.map((strain) => ({
    cropId: strain.baseCropId,
    strainId: strain.id,
    essence: strain.essence,
    label: strain.id,
  }));

  return [...wild, ...bred];
}

export function hasGreenhouse(world: World): boolean {
  return (world.equipment.greenhouse ?? 0) > 0;
}
