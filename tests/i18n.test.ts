/**
 * Plural selection, which is the one thing `t()` does that is not substitution.
 */

import { describe, expect, it } from 'vitest';
import { formatLongDuration, t } from '@/i18n';

describe('plural forms', () => {
  it('picks the singular for one and the plural for the rest', () => {
    expect(t('board.daysLeft', { count: 1 })).toBe('1 day');
    expect(t('board.daysLeft', { count: 4 })).toBe('4 days');
  });

  it('lets an exact count beat its category', () => {
    // No plural rule can express "today"; a key for the number can.
    expect(t('board.daysLeft', { count: 0 })).toBe('Today');
  });

  it('carries the other parameters into the chosen form', () => {
    expect(t('market.barter.cost', { count: 1, grade: 'D' })).toBe('Pay 1 potion, D+');
    expect(t('market.barter.cost', { count: 3, grade: 'C' })).toBe('Pay 3 potions, C+');
  });

  it('counts one sale and one seed in the singular', () => {
    expect(t('away.gold', { gold: '40g', count: 1 })).toBe('40g earned from 1 sale');
    expect(t('away.gold', { gold: '90g', count: 3 })).toBe('90g earned from 3 sales');
    // The seeds drive the plural; the harvest's own size rides along.
    expect(t('toast.harvestSeeds', { count: 1, total: 4, ingredient: 'Mint' })).toBe(
      '+4 Mint, 1 seed',
    );
    expect(t('toast.harvestSeeds', { count: 2, total: 4, ingredient: 'Mint' })).toBe(
      '+4 Mint, 2 seeds',
    );
  });

  it('leaves a key with no plural forms exactly as it was', () => {
    expect(t('shop.stacked', { count: 1 })).toBe('1 in the slot');
    expect(t('shop.stacked', { count: 7 })).toBe('7 in the slot');
  });

  it('still shows a missing key as itself', () => {
    expect(t('nothing.here.at.all', { count: 2 })).toBe('nothing.here.at.all');
  });

  it('counts the party out in words', () => {
    expect(t('log.missionSent', { count: 1, biome: 'Emberwaste' })).toBe(
      'Sent one hero to the Emberwaste.',
    );
    expect(t('log.missionSent', { count: 3, biome: 'Mirefen' })).toBe(
      'Sent 3 heroes to the Mirefen.',
    );
  });
});

describe('the away summary', () => {
  const HOUR = 3_600_000;

  it("says how long in words, not in the timers' letters", () => {
    expect(formatLongDuration(3 * 24 * HOUR + 4 * HOUR)).toBe('3 days, 4 hours');
    expect(formatLongDuration(1 * 24 * HOUR)).toBe('1 day');
    expect(formatLongDuration(HOUR + 5 * 60_000)).toBe('1 hour, 5 minutes');
  });

  it('never says nothing at all', () => {
    expect(formatLongDuration(0)).toBe('0 minutes');
  });
});
