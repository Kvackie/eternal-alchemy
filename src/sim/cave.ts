/**
 * The mushroom cave.
 *
 * The garden's verb is *cultivate* — you choose exactly what grows where. The
 * cave's is *tend*: you seed a tile and the mycelium spreads on its own, and
 * species compete for the grid. Leave it a week and you get a full harvest of
 * *something*, just not necessarily what you wanted. That is a good failure —
 * a cave full of the wrong mushroom is still a cave full of mushrooms.
 *
 * Light is the steering wheel. Lanterns favour Chalkgill and suppress
 * Gravecrown; darkness does the reverse. Placing light is how you decide which
 * species wins, without ever touching a tile directly.
 */

import { caveConfig, getCaveSpecies } from './config';
import { addIngredient } from './inventory';
import { derivedStats } from './progression';
import { caveSpreadMultiplier } from './town';
import { Rng } from './rng';
import type { CaveTile, World } from './types';

export function makeCaveTiles(count: number): CaveTile[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    speciesId: null,
    seededAt: 0,
    lit: false,
    locked: false,
  }));
}

export function tileAt(world: World, index: number): CaveTile | undefined {
  return world.cave.tiles.find((tile) => tile.index === index);
}

/** 0..1. A tile is harvestable once this reaches 1. */
export function maturityOf(tile: CaveTile, now: number): number {
  if (!tile.speciesId) return 0;
  const species = getCaveSpecies(tile.speciesId);
  const elapsed = Math.max(0, now - tile.seededAt);
  return Math.min(1, elapsed / species.growMs);
}

export function isMature(tile: CaveTile, now: number): boolean {
  return tile.speciesId !== null && maturityOf(tile, now) >= 1;
}

/** Grid neighbours, four-way. The cave is a grid, not a graph. */
export function neighboursOf(index: number, unlockedTiles: number): number[] {
  const { width } = caveConfig;
  const x = index % width;
  const y = Math.floor(index / width);
  const out: number[] = [];

  if (x > 0) out.push(index - 1);
  if (x < width - 1) out.push(index + 1);
  if (y > 0) out.push(index - width);
  out.push(index + width);

  return out.filter((i) => i >= 0 && i < unlockedTiles);
}

/**
 * How readily a species takes hold on a tile, given the light there.
 *
 * Out of its preferred light a species still spreads, just far more slowly —
 * nothing is forbidden, and nothing dies. The cave drifts.
 */
export function spreadChanceFor(
  speciesId: string,
  lit: boolean,
  bonus = 0,
  townMultiplier = 1,
): number {
  const species = getCaveSpecies(speciesId);
  const suits =
    species.light === 'any' || (species.light === 'lit' ? lit : !lit);
  // A humidity ward adds flat encouragement on top of the species' own rate,
  // and the town decides how willing the ground was in the first place —
  // Hollowreach is caves for miles.
  return (
    (species.spreadChance + bonus) *
    (suits ? 1 : caveConfig.wrongLightSpreadMultiplier) *
    townMultiplier
  );
}

/** Place a spore cluster on an empty tile. Costs a cluster from stores. */
export function seedTile(world: World, index: number, speciesId: string): boolean {
  const tile = tileAt(world, index);
  if (!tile || tile.speciesId) return false;
  if ((world.spores[speciesId] ?? 0) <= 0) return false;

  getCaveSpecies(speciesId);
  world.spores[speciesId] = (world.spores[speciesId] ?? 0) - 1;
  tile.speciesId = speciesId;
  tile.seededAt = world.now;
  return true;
}

export function toggleLantern(world: World, index: number): boolean {
  const tile = tileAt(world, index);
  if (!tile) return false;
  tile.lit = !tile.lit;
  return true;
}

/** A tray pins a tile's species so spreading neighbours cannot take it. */
export function toggleTray(world: World, index: number): boolean {
  const tile = tileAt(world, index);
  if (!tile) return false;
  tile.locked = !tile.locked;
  return true;
}

export interface CaveHarvest {
  ingredientId: string;
  count: number;
}

export function harvestTile(world: World, index: number): CaveHarvest | null {
  const tile = tileAt(world, index);
  if (!tile?.speciesId || !isMature(tile, world.now)) return null;

  const speciesId = tile.speciesId;
  const count = caveConfig.yieldPerTile;
  addIngredient(world, speciesId, count, world.now);

  // A tray keeps its species; an untrayed tile clears and is open to spread.
  if (tile.locked) tile.seededAt = world.now;
  else tile.speciesId = null;

  world.statistics.fungiHarvested += count;
  return { ingredientId: speciesId, count };
}

export function harvestAllMature(world: World): CaveHarvest[] {
  const results: CaveHarvest[] = [];
  for (const tile of world.cave.tiles) {
    if (!isMature(tile, world.now)) continue;
    const result = harvestTile(world, tile.index);
    if (result) results.push(result);
  }
  return results;
}

/**
 * Run the cave's spread ticks up to `world.now`.
 *
 * Same shape as the market: discrete ticks with a budget, so a live tick and a
 * three-week catch-up run identical code. The budget stops a corrupted clock
 * from locking the main thread.
 *
 * Each tick draws from its own stream, keyed to the tick's moment, rather than
 * from the world's shared one. The market and the board spend the shared
 * stream differently live and offline, so drawing from it made the same night
 * grow a different cave depending on whether anyone watched.
 */
export function runCave(world: World): void {
  const tickMs = caveConfig.spreadTickMs;
  if (tickMs <= 0) return;

  const spreadBonus = derivedStats(world).caveSpreadBonus;
  const townSpread = caveSpreadMultiplier(world);
  let tick = world.cave.lastTick + tickMs;
  let budget = 20_000;

  while (tick <= world.now && budget > 0) {
    budget -= 1;
    const rng = new Rng(Math.imul(Math.floor(tick / tickMs), 0x9e3779b1) >>> 0);

    // Snapshot which tiles are empty first: a tile colonised during this tick
    // should not immediately spread onward in the same tick.
    const unlocked = world.cave.tiles.length;
    const claimed = new Set<number>();

    for (const tile of world.cave.tiles) {
      if (!tile.speciesId) continue;
      // Only a mature colony spreads, judged at the tick's own moment.
      const species = getCaveSpecies(tile.speciesId);
      if (tick - tile.seededAt < species.growMs) continue;

      const targets = neighboursOf(tile.index, unlocked).filter((i) => {
        if (claimed.has(i)) return false;
        const target = world.cave.tiles.find((t) => t.index === i);
        return target !== undefined && target.speciesId === null && !target.locked;
      });
      if (targets.length === 0) continue;

      const target = targets[rng.int(0, targets.length - 1)];
      if (target === undefined) continue;

      const destination = world.cave.tiles.find((t) => t.index === target);
      if (!destination) continue;

      if (!rng.chance(spreadChanceFor(tile.speciesId, destination.lit, spreadBonus, townSpread))) {
        continue;
      }

      destination.speciesId = tile.speciesId;
      destination.seededAt = tick;
      claimed.add(target);
    }

    tick += tickMs;
  }

  world.cave.lastTick = tick - tickMs;
}

export function matureCount(world: World): number {
  return world.cave.tiles.filter((tile) => isMature(tile, world.now)).length;
}
