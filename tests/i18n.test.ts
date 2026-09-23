/**
 * Plural selection, which is the one thing `t()` does that is not substitution.
 */

import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';

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
});
