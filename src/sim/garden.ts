/**
 * The garden.
 *
 * Crops finish on a schedule and then wait indefinitely. Nothing wilts, nothing
 * dies. There is no tending: a plot you planted is a plot that will be ready,
 * and the only decision it carries is which soil you put the seed in.
 * That is what makes the garden safe to leave for a week.
 */

import { config, findCrop, getCrop } from './config';
import { addIngredient } from './inventory';
import { derivedStats } from './progression';
import { codexBonuses } from './prestige';
import { cropGrowthMultiplier } from './town';
import type { Rng } from './rng';
import type { Plot, SoilId, World } from './types';
import { boostedYield } from './boosters';

export interface HarvestResult {
  plotId: string;
  ingredientId: string;
  count: number;
  /** Seeds recovered from this harvest. */
  seeds: number;
}

const SOILS: SoilId[] = ['loam', 'ash', 'silt', 'loam'];

/** The plot at position `index`, empty. Its soil follows from where it sits. */
export function makePlot(index: number): Plot {
  return {
    id: `plot-${index + 1}`,
    soil: SOILS[index % SOILS.length] ?? 'loam',
    crop: null,
  };
}

export function makePlots(count: number): Plot[] {
  return Array.from({ length: count }, (_, i) => makePlot(i));
}

export function plotById(world: World, plotId: string): Plot | undefined {
  return world.plots.find((plot) => plot.id === plotId);
}

export function isReady(plot: Plot, now: number): boolean {
  return plot.crop !== null && now >= plot.crop.readyAt;
}

export function plant(world: World, plotId: string, seedId: string): boolean {
  const plot = plotById(world, plotId);
  if (!plot || plot.crop !== null) return false;
  if ((world.seeds[seedId] ?? 0) <= 0) return false;
  const seed = findCrop(seedId);
  if (!seed) return false;

  world.seeds[seedId] = (world.seeds[seedId] ?? 0) - 1;
  plot.crop = {
    cropId: seed.id,
    plantedAt: world.now,
    // Green Thumb in the Codex shortens everything that grows, and the town's
    // soil decides the rest — Cinderhold's is poor, Saltmarsh's is not.
    readyAt:
      world.now + seed.growMs * codexBonuses(world).timerMultiplier * cropGrowthMultiplier(world),
  };
  return true;
}

/**
 * Pull a crop out and throw it away.
 *
 * For a bed planted with the wrong thing, or one a player wants back now
 * rather than in forty minutes. Nothing comes of it — no ingredient, no seed,
 * not the seed it was planted from — which is what makes it a choice rather
 * than a free undo of `plant`. Ready or not makes no difference.
 */
export function destroyCrop(world: World, plotId: string): string | null {
  const plot = plotById(world, plotId);
  if (!plot?.crop) return null;
  const cropId = plot.crop.cropId;
  plot.crop = null;
  return cropId;
}

/**
 * Harvest a plot.
 *
 * Seeds roll per unit harvested, not per plot. That distinction is the whole
 * garden economy: at one roll per plot the garden drains, because planting costs
 * a seed and returns a quarter of one. Rolling against each unit puts a
 * four-unit harvest at roughly break-even, so the garden sustains itself and
 * merchants become a way to expand rather than a life-support machine.
 */
/**
 * How many units this plot will give up when picked.
 *
 * Shared with the world view, which draws one plant per unit — so a bed on its
 * right soil is visibly fuller than one on the wrong soil, and the picture
 * cannot promise a different harvest from the one you get.
 *
 * Ground it likes yields one more. Every crop declared a soil and every plot had
 * one, and nothing had ever compared them — four interchangeable plots and a
 * decorative field. A bonus rather than a penalty on purpose: wrong soil still
 * grows, so the choice is "where is this best" and never "you planted it wrong".
 */
export function harvestSize(plot: Plot): number {
  if (!plot.crop) return 0;
  const crop = getCrop(plot.crop.cropId);

  /*
   * One multiplier, set at what a tended plot used to give.
   *
   * Tending is gone, and the seed economy above is balanced against a four-unit
   * harvest — the figure a tended plot produced. Keeping the untended 1.0
   * instead would have quietly cut every harvest by a quarter and left the
   * garden draining seeds, which is a different change from removing a chore.
   */
  const suited = plot.soil === crop.soil ? config.garden.suitedSoilBonus : 0;

  return Math.max(1, Math.round(crop.yieldCount * config.garden.yieldMultiplier) + suited);
}

export function harvest(world: World, plotId: string, rng: Rng): HarvestResult | null {
  const plot = plotById(world, plotId);
  if (!plot?.crop || !isReady(plot, world.now)) return null;

  const crop = getCrop(plot.crop.cropId);
  const base = harvestSize(plot);
  // A garden booster doubles what is picked; the seeds it gives back are
  // rolled on the ordinary harvest, so it is not a seed press as well.
  const count = boostedYield(plot, 'garden', base);

  const seedId = crop.id;
  const dropChance = derivedStats(world).seedDropChance;
  let seeds = 0;
  for (let i = 0; i < base; i += 1) {
    if (rng.chance(dropChance)) seeds += 1;
  }
  if (seeds > 0) world.seeds[seedId] = (world.seeds[seedId] ?? 0) + seeds;

  // Harvest stamps the *current* world time, so a crop that finished while the
  // player was away is Dewfresh when they pick it, not stale on arrival.
  addIngredient(world, crop.yields, count, world.now);
  plot.crop = null;
  world.statistics.cropsHarvested += count;
  world.statistics.seedsRecovered += seeds;

  return { plotId, ingredientId: crop.yields, count, seeds };
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
