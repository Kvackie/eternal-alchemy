/**
 * Ingredient inventory.
 *
 * Stacks are keyed by ingredient *and* harvest time, because freshness is derived
 * from the harvest moment. Two batches of the same herb picked a day apart are
 * genuinely different ingredients and must not merge.
 */

import { agingRateFor, freshnessOf } from './essences';
import type { Freshness, World } from './types';

/** Stacks harvested within this window of each other merge, to stop stack sprawl. */
const MERGE_WINDOW_MS = 60_000;

export function addIngredient(
  world: World,
  ingredientId: string,
  count: number,
  harvestedAt: number | null,
): void {
  if (count <= 0) return;
  // Anything that never ages — stone, and the exotics a party brings home —
  // is Fresh for ever with or without a stamp, so it carries none and every
  // batch of it stacks as the one ingredient it is.
  const stamp = agingRateFor(ingredientId) === 0 ? null : harvestedAt;

  const existing = world.inventory.find(
    (stack) =>
      stack.ingredientId === ingredientId &&
      (stack.harvestedAt === null || stamp === null
        ? stack.harvestedAt === stamp
        : Math.abs(stack.harvestedAt - stamp) <= MERGE_WINDOW_MS),
  );

  if (existing) existing.count += count;
  else world.inventory.push({ ingredientId, count, harvestedAt: stamp });
}

export function countOf(world: World, ingredientId: string, freshness?: Freshness): number {
  return world.inventory
    .filter(
      (stack) =>
        stack.ingredientId === ingredientId &&
        (freshness === undefined ||
          freshnessOf(stack.ingredientId, stack.harvestedAt, world.now) === freshness),
    )
    .reduce((sum, stack) => sum + stack.count, 0);
}

/**
 * Remove one unit, oldest stack first.
 *
 * `freshness` matters more than it looks. Stores are displayed as one tile per
 * ingredient *per freshness stage*, because a Dried herb is a genuinely
 * different ingredient — drying weakens every essence in it, and a weaker
 * blend can brew a lesser potion. Without this filter, tapping the
 * Dewfresh tile spent the Dried batch instead, and the tile was simply lying
 * about what it would do.
 *
 * Within a stage, oldest-first is still right: it spends the batch closest to
 * changing stage, and leaves the fresher one for a recipe that needs it.
 */
export function takeUnit(
  world: World,
  ingredientId: string,
  freshness?: Freshness,
): { ingredientId: string; harvestedAt: number | null } | null {
  const candidates = world.inventory
    .filter(
      (stack) =>
        stack.ingredientId === ingredientId &&
        stack.count > 0 &&
        (freshness === undefined ||
          freshnessOf(stack.ingredientId, stack.harvestedAt, world.now) === freshness),
    )
    .sort((a, b) => (a.harvestedAt ?? 0) - (b.harvestedAt ?? 0));

  const stack = candidates[0];
  if (!stack) return null;

  stack.count -= 1;
  const harvestedAt = stack.harvestedAt;
  pruneEmpty(world);
  return { ingredientId, harvestedAt };
}

/** Put a unit back — used when an ingredient is pulled out of the cauldron. */
export function returnUnit(
  world: World,
  unit: { ingredientId: string; harvestedAt: number | null },
): void {
  addIngredient(world, unit.ingredientId, 1, unit.harvestedAt);
}

export function pruneEmpty(world: World): void {
  world.inventory = world.inventory.filter((stack) => stack.count > 0);
}

export interface InventoryRow {
  ingredientId: string;
  count: number;
  harvestedAt: number | null;
  freshness: Freshness;
}

/**
 * Inventory grouped for display: one row per ingredient, per freshness stage.
 * Both are things that make two units genuinely different.
 */
export function inventoryRows(world: World, now: number): InventoryRow[] {
  const rows = new Map<string, InventoryRow>();

  for (const stack of world.inventory) {
    if (stack.count <= 0) continue;
    const freshness = freshnessOf(stack.ingredientId, stack.harvestedAt, now);
    const key = `${stack.ingredientId}:${freshness}`;
    const existing = rows.get(key);
    if (existing) {
      existing.count += stack.count;
      // Keep the oldest stamp so the row's countdown shows the next stage change.
      if (
        stack.harvestedAt !== null &&
        (existing.harvestedAt === null || stack.harvestedAt < existing.harvestedAt)
      ) {
        existing.harvestedAt = stack.harvestedAt;
      }
    } else {
      rows.set(key, {
        ingredientId: stack.ingredientId,
        count: stack.count,
        harvestedAt: stack.harvestedAt,
        freshness,
      });
    }
  }

  return [...rows.values()].sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));
}
