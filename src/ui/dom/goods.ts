import { t } from '@/i18n';
import { getDecor, getShelfTier } from '@/sim/config';

/**
 * What a thing does, in sentences.
 *
 * These were chips — "Appeal +8%" in green — which reads as a badge the thing
 * has won rather than something it does. The first rewrite went too far the
 * other way, into flavour: "catches the eye more readily" is a sentence that
 * does not say what the number changes. Each line states the effect and its
 * size, plainly; a field at its default says nothing rather than saying zero.
 *
 * Keyed on kind and id rather than on a market entry, because the Market is not
 * the only place that has to say this. The Shop's furnishing picker is where a
 * player actually chooses between a banner worth +10% footfall and one worth
 * +44%, and for a while it was the one screen with the numbers taken out of it:
 * they had been stripped from the flavour strings and re-derived here, where
 * nothing outside this file could reach them.
 */
export function goodsNotes(kind: string, id: string): string[] {
  const notes: string[] = [];
  const pct = (n: number) => Math.round(Math.abs(n) * 100);

  if (kind === 'board') {
    const def = getShelfTier(id);
    if (def.appealBonus > 0) {
      notes.push(t('shop.board.appealNote', { percent: pct(def.appealBonus) }));
    }
    notes.push(t('goods.boardFitting'));
  }

  if (kind === 'decor') {
    const { effect } = getDecor(id);
    if (effect.appealBonus) notes.push(t('goods.appeal', { percent: pct(effect.appealBonus) }));
    if (effect.footfallBonus) notes.push(t('goods.footfall', { percent: pct(effect.footfallBonus) }));
    if (effect.nightFootfallBonus) {
      notes.push(t('goods.nightFootfall', { percent: pct(effect.nightFootfallBonus) }));
    }
    if (effect.haggleCeilingBonus) {
      notes.push(t('goods.haggleCeiling', { percent: pct(effect.haggleCeilingBonus) }));
    }
  }

  return notes;
}
