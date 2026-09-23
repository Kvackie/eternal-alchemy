/**
 * Bottling: a finished brew becomes a potion you can sell.
 *
 * There is nothing to choose. Vessels and seals were a second set of questions
 * asked of every brew, and a supply of glass the whole economy ended up waiting
 * on; they are gone, and bottling is one press. Once bottled an item never
 * degrades — freshness lives on raw ingredients only, so a stockpile built for
 * a big order stays worth building.
 */

import { fairValue } from './market';
import { recordBottled } from './progression';
import type { BottledItem, EssenceVector, Grade, PotencyTierId, World } from './types';

/** The subset of a finished brew that bottling actually reads. */
export interface PendingBrew {
  recipeId: string;
  total: EssenceVector;
  grade: Grade;
  purity: number;
  totalEssence: number;
  potencyTier: PotencyTierId;
}

let uidCounter = 0;

/** Deterministic enough for a save file, unique enough for a session. */
export function nextUid(now: number): string {
  uidCounter += 1;
  return `item-${now.toString(36)}-${uidCounter.toString(36)}`;
}

export function bottle(world: World, brew: PendingBrew): BottledItem {
  const item: BottledItem = {
    uid: nextUid(world.now),
    recipeId: brew.recipeId,
    grade: brew.grade,
    purity: Math.floor(brew.purity),
    potencyTier: brew.potencyTier,
    totalEssence: Math.floor(brew.totalEssence),
    fairValue: 0,
    bottledAt: world.now,
  };

  item.fairValue = fairValue(item);
  world.bottled.push(item);
  recordBottled(world, item);
  return item;
}
