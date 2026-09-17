import { t } from '@/i18n';
import { getDecor, getSeal, getShelfTier, getVessel } from '@/sim/config';

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

  const value = (multiplier: number) => {
    if (multiplier > 1) notes.push(t('goods.valueMore', { percent: pct(multiplier - 1) }));
    if (multiplier < 1) notes.push(t('goods.valueLess', { percent: pct(1 - multiplier) }));
  };

  if (kind === 'vessel') {
    const def = getVessel(id);
    notes.push(t('goods.potencyCap', { potency: t(`potency.${def.potencyCap}`) }));
    if (def.onlyForms?.length) {
      notes.push(t('goods.onlyForms', { forms: def.onlyForms.map((f) => t(`form.${f}`)).join(', ') }));
    }
    if (def.appealBonus > 0) notes.push(t('goods.appeal', { percent: pct(def.appealBonus) }));
    value(def.valueMultiplier);
    if (def.supplyGradeBonus) notes.push(t('goods.supplyGrade'));
    if (def.shelfStack && def.shelfStack > 1) notes.push(t('goods.shelfStack', { count: def.shelfStack }));
  }

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

  if (kind === 'seal') {
    const def = getSeal(id);
    if (def.umbraOnly) notes.push(t('goods.umbraOnly'));
    // An override replaces appeal rather than adjusting it, so it is the only
    // thing worth saying about how this one sells.
    if (def.shelfAppealOverride !== undefined) {
      notes.push(t('goods.appealOverride', { percent: pct(def.shelfAppealOverride) }));
    } else if (def.appealBonus > 0) {
      notes.push(t('goods.appeal', { percent: pct(def.appealBonus) }));
    }
    value(def.valueMultiplier);
    if (def.renownPerSale) notes.push(t('goods.renownPerSale', { count: def.renownPerSale }));
    if (def.contractPayoutBonus) {
      notes.push(t('goods.contractPayout', { percent: pct(def.contractPayoutBonus) }));
    }
    if (def.supplyGradeBonus) notes.push(t('goods.supplyGrade'));
    if (def.haggleCeilingBonus) {
      notes.push(t('goods.haggleCeiling', { percent: pct(def.haggleCeilingBonus) }));
    }
    if (def.barterMultiplier && def.barterMultiplier !== 1) {
      notes.push(t('goods.barter', { times: def.barterMultiplier }));
    }
  }

  return notes;
}
