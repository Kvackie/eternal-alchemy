/**
 * The mining shaft.
 *
 * The verb is *extract*. You point the shaft at a vein and it yields ore in
 * batches until the vein runs out; then you go deeper. Depth is bought — support
 * beams and picks come from merchants — so the shaft is the equipment-hungry
 * source, in contrast to the garden's patience and the cave's neglect.
 *
 * Minerals carry the highest essence per unit in the game and never age, which
 * is what makes a large cauldron reachable at all. They are also far too coarse
 * to steer a ratio with, so a good high-tier brew is minerals for mass and herbs
 * for correction.
 */

import { shaftConfig, strataFor } from './config';
import { addIngredient } from './inventory';
import { derivedStats } from './progression';
import { codexBonuses } from './prestige';
import { oreBatchMultiplier } from './town';
import type { Rng } from './rng';
import type { ShaftVein, World } from './types';

/**
 * Generate the veins present at a depth.
 *
 * Seeded on (worldSeed, depth) so a stratum's veins are stable across saves —
 * the same shaft always has the same seams, however many times it is reloaded.
 */
export function generateVeins(worldSeed: number, depth: number, rng: Rng): ShaftVein[] {
  const stratum = strataFor(depth);
  const count = 2 + rng.int(0, 1);

  return Array.from({ length: count }, (_, index) => {
    const total = stratum.veins.reduce((sum, vein) => sum + vein.weight, 0);
    let roll = rng.next() * total;
    let chosen = stratum.veins[0]!;
    for (const vein of stratum.veins) {
      roll -= vein.weight;
      if (roll <= 0) {
        chosen = vein;
        break;
      }
    }

    const size = Math.max(2, Math.round(chosen.size * (0.75 + rng.next() * 0.5)));
    return {
      id: `${depth}-${index}-${worldSeed % 9973}`,
      ingredientId: chosen.ingredientId,
      depth,
      batch: chosen.batch,
      size,
      remaining: size,
      refillsAt: null,
      nextBatchAt: null,
    };
  });
}

export function veinById(world: World, veinId: string): ShaftVein | undefined {
  return world.shaft.veins.find((vein) => vein.id === veinId);
}

/** A vein is workable if it has ore left and is not still regrowing. */
export function isWorkable(vein: ShaftVein, now: number): boolean {
  if (vein.remaining > 0) return true;
  return vein.refillsAt !== null && now >= vein.refillsAt;
}

export function startWorking(world: World, veinId: string): boolean {
  const vein = veinById(world, veinId);
  if (!vein || !isWorkable(vein, world.now)) return false;

  // Picking up a refilled vein is what actually restores it.
  if (vein.remaining <= 0 && vein.refillsAt !== null && world.now >= vein.refillsAt) {
    vein.remaining = vein.size;
    vein.refillsAt = null;
  }

  world.shaft.workingVeinId = veinId;
  vein.nextBatchAt = world.now + shaftConfig.batchTickMs;
  return true;
}

export function stopWorking(world: World): void {
  const vein = world.shaft.workingVeinId ? veinById(world, world.shaft.workingVeinId) : undefined;
  if (vein) vein.nextBatchAt = null;
  world.shaft.workingVeinId = null;
}

export function canDeepen(world: World): boolean {
  return world.shaft.depth + shaftConfig.depthStep <= world.shaft.supportedDepth;
}

/** Dig one step down. New veins appear; the old ones stay, regrowing. */
export function deepen(world: World, rng: Rng): boolean {
  if (!canDeepen(world)) return false;
  world.shaft.depth += shaftConfig.depthStep;
  world.shaft.veins.push(...generateVeins(world.rngSeed, world.shaft.depth, rng));
  return true;
}

export interface ShaftBatch {
  ingredientId: string;
  count: number;
}

/**
 * Run extraction up to `world.now`.
 *
 * Ticks like the market and the cave, so offline catch-up is the same code as a
 * live tick. When a vein runs dry the shaft stops on its own and the vein starts
 * regrowing — a shallow seam is never permanently spent.
 */
export function runShaft(world: World, now: number): ShaftBatch[] {
  const batches: ShaftBatch[] = [];
  const veinId = world.shaft.workingVeinId;
  if (!veinId) return batches;

  const vein = veinById(world, veinId);
  if (!vein) {
    world.shaft.workingVeinId = null;
    return batches;
  }

  // A steel pick, and Deep Veins in the Codex, both put more in each batch —
  // then the town's rock decides how much of it there was to begin with.
  const batchBonus = derivedStats(world).oreBatchBonus + codexBonuses(world).oreBatchBonus;
  const richness = oreBatchMultiplier(world);

  let budget = 20_000;
  while (
    vein.nextBatchAt !== null &&
    vein.nextBatchAt <= now &&
    vein.remaining > 0 &&
    budget > 0
  ) {
    budget -= 1;
    // At least one, so a poor town slows the shaft rather than stopping it.
    const perBatch = Math.max(1, Math.round((vein.batch + batchBonus) * richness));
    const count = Math.min(perBatch, vein.remaining);
    vein.remaining -= count;

    // Minerals pass a null harvest stamp; stone does not age.
    addIngredient(world, vein.ingredientId, count, null);
    world.statistics.oreExtracted += count;
    batches.push({ ingredientId: vein.ingredientId, count });

    vein.nextBatchAt += shaftConfig.batchTickMs;
  }

  if (vein.remaining <= 0) {
    vein.nextBatchAt = null;
    vein.refillsAt = now + shaftConfig.veinRefillMs;
    world.shaft.workingVeinId = null;
  }

  return batches;
}

/** Veins grouped for display, newest depth first. */
export function veinsByDepth(world: World): Array<{ depth: number; veins: ShaftVein[] }> {
  const byDepth = new Map<number, ShaftVein[]>();
  for (const vein of world.shaft.veins) {
    const list = byDepth.get(vein.depth) ?? [];
    list.push(vein);
    byDepth.set(vein.depth, list);
  }
  return [...byDepth.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([depth, veins]) => ({ depth, veins }));
}
