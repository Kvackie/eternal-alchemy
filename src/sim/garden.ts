/**
 * The garden.
 *
 * Crops finish on a schedule and then wait indefinitely. Nothing wilts, nothing
 * dies, and an untended plot still yields — tending is a bonus, never a duty.
 * That is what makes the garden safe to leave for a week.
 */

import { config, getCrop } from './config';
import { addIngredient } from './inventory';
import { derivedStats } from './progression';
import { codexBonuses } from './prestige';
import { cropGrowthMultiplier } from './town';
import type { Rng } from './rng';
import type { Plot, SoilId, World } from './types';

export interface HarvestResult {
  plotId: string;
  ingredientId: string;
  count: number;
  tended: boolean;
  /** Seeds recovered from this harvest. */
  seeds: number;
}

export function makePlots(count: number): Plot[] {
  const soils: SoilId[] = ['loam', 'ash', 'silt', 'loam'];
  return Array.from({ length: count }, (_, i) => ({
    id: `plot-${i + 1}`,
    soil: soils[i % soils.length] ?? 'loam',
    crop: null,
  }));
}

export function plotById(world: World, plotId: string): Plot | undefined {
  return world.plots.find((plot) => plot.id === plotId);
}

export function isReady(plot: Plot, now: number): boolean {
  return plot.crop !== null && now >= plot.crop.readyAt;
}

/**
 * Seeds are keyed by crop id for wild plants and by strain id for bred ones, so
 * a seed id resolves to one or the other.
 */
function resolveSeed(
  world: World,
  seedId: string,
): { cropId: string; strainId: string | null; growMs: number } | null {
  const strain = world.strains.find((entry) => entry.id === seedId);
  if (strain) {
    return { cropId: strain.baseCropId, strainId: strain.id, growMs: strain.growMs };
  }
  const crop = world.seeds[seedId] !== undefined ? getCrop(seedId) : null;
  if (!crop) return null;
  return { cropId: crop.id, strainId: null, growMs: crop.growMs };
}

export function canPlant(world: World, plotId: string, seedId: string): boolean {
  const plot = plotById(world, plotId);
  if (!plot || plot.crop !== null) return false;
  if ((world.seeds[seedId] ?? 0) <= 0) return false;
  return resolveSeed(world, seedId) !== null;
}

export function plant(world: World, plotId: string, seedId: string): boolean {
  if (!canPlant(world, plotId, seedId)) return false;
  const plot = plotById(world, plotId);
  const seed = resolveSeed(world, seedId);
  if (!plot || !seed) return false;

  world.seeds[seedId] = (world.seeds[seedId] ?? 0) - 1;
  plot.crop = {
    cropId: seed.cropId,
    strainId: seed.strainId,
    plantedAt: world.now,
    // Green Thumb in the Codex shortens everything that grows, and the town's
    // soil decides the rest — Cinderhold's is poor, Saltmarsh's is not.
    readyAt:
      world.now +
      seed.growMs * codexBonuses(world).timerMultiplier * cropGrowthMultiplier(world),
    tended: false,
  };
  return true;
}

/**
 * Tending is available for the first part of a crop's life. Late tending does
 * nothing rather than failing loudly — the UI simply stops offering it.
 */
export function canTend(world: World, plotId: string): boolean {
  const plot = plotById(world, plotId);
  if (!plot?.crop || plot.crop.tended) return false;
  const crop = getCrop(plot.crop.cropId);
  const elapsed = world.now - plot.crop.plantedAt;
  return elapsed <= crop.growMs * config.garden.tendWindowFraction;
}

export function tend(world: World, plotId: string): boolean {
  if (!canTend(world, plotId)) return false;
  const plot = plotById(world, plotId);
  if (!plot?.crop) return false;
  plot.crop.tended = true;
  return true;
}

/**
 * Harvest a plot.
 *
 * Seeds roll per unit harvested, not per plot. That distinction is the whole
 * garden economy: at one roll per plot the garden drains, because planting costs
 * a seed and returns a quarter of one. Rolling against each unit puts a tended
 * four-unit harvest at roughly break-even, so the garden sustains itself and
 * merchants become a way to expand rather than a life-support machine.
 */
/**
 * How many units this plot will give up when picked.
 *
 * Shared with the world view, which draws one plant per unit — so a tended bed
 * on its right soil is visibly fuller than a neglected one, and the picture
 * cannot promise a different harvest from the one you get.
 *
 * Ground it likes yields one more. Every crop declared a soil and every plot had
 * one, and nothing had ever compared them — four interchangeable plots and a
 * decorative field. A bonus rather than a penalty on purpose: wrong soil still
 * grows, so the choice is "where is this best" and never "you planted it wrong".
 */
export function harvestSize(world: World, plot: Plot): number {
  if (!plot.crop) return 0;
  const crop = getCrop(plot.crop.cropId);
  const strain = plot.crop.strainId
    ? world.strains.find((entry) => entry.id === plot.crop!.strainId)
    : undefined;

  const multiplier = plot.crop.tended
    ? config.garden.tendedYieldMultiplier
    : config.garden.untendedYieldMultiplier;
  const suited = plot.soil === crop.soil ? config.garden.suitedSoilBonus : 0;

  return Math.max(1, Math.round(crop.yieldCount * multiplier) + (strain?.yieldBonus ?? 0) + suited);
}

export function harvest(world: World, plotId: string, rng: Rng): HarvestResult | null {
  const plot = plotById(world, plotId);
  if (!plot?.crop || !isReady(plot, world.now)) return null;

  const crop = getCrop(plot.crop.cropId);
  const strainId = plot.crop.strainId ?? null;
  const strain = strainId ? world.strains.find((entry) => entry.id === strainId) : undefined;

  const count = harvestSize(world, plot);
  const tended = plot.crop.tended;

  // A bred line drops its own seed, not its wild parent's — otherwise a strain
  // could only ever be planted as many times as it was crossed.
  const seedId = strainId ?? crop.id;
  const dropChance = derivedStats(world).seedDropChance;
  let seeds = 0;
  for (let i = 0; i < count; i += 1) {
    if (rng.chance(dropChance)) seeds += 1;
  }
  if (seeds > 0) world.seeds[seedId] = (world.seeds[seedId] ?? 0) + seeds;

  // Harvest stamps the *current* world time, so a crop that finished while the
  // player was away is Dewfresh when they pick it, not stale on arrival.
  addIngredient(world, crop.yields, count, world.now, strainId);
  plot.crop = null;
  world.statistics.cropsHarvested += count;
  world.statistics.seedsRecovered += seeds;

  return { plotId, ingredientId: crop.yields, count, tended, seeds };
}

export function harvestAllReady(world: World, rng: Rng): HarvestResult[] {
  const results: HarvestResult[] = [];
  for (const plot of world.plots) {
    if (isReady(plot, world.now)) {
      const result = harvest(world, plot.id, rng);
      if (result) results.push(result);
    }
  }
  return results;
}

export function readyCount(world: World): number {
  return world.plots.filter((plot) => isReady(plot, world.now)).length;
}
