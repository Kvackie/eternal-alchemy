/**
 * Shared fixtures for the sim tests.
 */

import { config } from '@/sim/config';
import { fairValue } from '@/sim/market';
import type { BottledItem } from '@/sim/types';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
/** One in-game day, which is not twenty-four real hours. */
export const DAY = config.clock.dayLengthMs;

/**
 * A bottled potion: a common B-grade Aqua-Terra unless told otherwise. Its
 * fair value is the market's own price for the recipe, grade and potency it
 * ends up with, unless `fairValue` is given outright.
 */
export function bottle(overrides: Partial<BottledItem> = {}): BottledItem {
  const item: Omit<BottledItem, 'fairValue'> = {
    uid: 'bottle',
    recipeId: 'aquaTerra',
    grade: 'B',
    purity: 80,
    potencyTier: 'common',
    totalEssence: 57,
    bottledAt: 0,
    ...overrides,
  };
  return { ...item, fairValue: overrides.fairValue ?? fairValue(item) };
}
