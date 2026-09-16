/**
 * What a bottled potion actually is.
 *
 * A finished bottle carries more than its name and grade — the purity it was
 * poured at, how much essence is in it, what it is stoppered with, and whether
 * that stopper makes it worth more to a hero than to a customer. All of that was
 * decided at the workbench and then never shown again, so a shelf of forty
 * bottles was forty names and a letter.
 *
 * Opened from anywhere a bottle is drawn; the caller decides what tapping means
 * elsewhere on the tile.
 */

import { button, chip, el, gradeBadge, potionIcon, stat } from './components';
import { formatGold, formatNumber, t } from '@/i18n';
import { getForm, getHeroDef, getSeal, getVessel } from '@/sim/config';
import type { Simulation } from '@/sim/sim';
import type { BottledItem } from '@/sim/types';

/**
 * Anything about this bottle that is true of *this* bottle.
 *
 * Recipes carry no effect: a Night Glass and an Ember Draught differ in blend
 * and price and in nothing else, so listing "sells from a shelf" and "packs as
 * supplies" against each one said the same two things on every potion in the
 * game. What is left is the pair of facts that actually vary — somebody on the
 * roster is fond of it, or something on the board is waiting for it.
 *
 * Empty most of the time, and that is correct: no line means no reason beyond
 * its grade and its price.
 */
function notesOn(sim: Simulation, item: BottledItem): string[] {
  const notes: string[] = [];

  const admirers = sim.world.heroes.filter(
    (hero) => getHeroDef(hero.id).favourite === item.recipeId,
  );
  if (admirers.length > 0) {
    notes.push(
      t('potionInfo.use.favourite', {
        heroes: admirers.map((hero) => t(`hero.${hero.id}`)).join(', '),
      }),
    );
  }

  if (sim.world.contracts.some((contract) => contract.terms?.recipeId === item.recipeId)) {
    notes.push(t('potionInfo.use.contract'));
  }

  return notes;
}

export function showPotionInfo(sim: Simulation, item: BottledItem, count = 1): void {
  const vessel = getVessel(item.vesselId);
  const seal = getSeal(item.sealId);

  const overlay = el('div', { class: 'overlay' });
  const dismiss = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') dismiss();
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dismiss();
  });

  /*
   * The two bonuses a bottle can carry into an expedition.
   *
   * A horn phial and a warding sigil each read as one grade better when packed
   * as supplies, and they stack. It is the one number on this screen that is
   * about the Roster rather than the shelf, and without it a player has no way
   * to know why one B-grade bottle helps a party more than another.
   */
  const supplyBonus = (vessel.supplyGradeBonus ?? 0) + (seal.supplyGradeBonus ?? 0);

  const facts: HTMLElement[] = [
    stat(t('potionInfo.purity'), `${Math.round(item.purity)} / 100`),
    stat(t('potionInfo.essence'), formatNumber(Math.round(item.totalEssence))),
    stat(t('potionInfo.vessel'), t(`vessel.${item.vesselId}`)),
    stat(t('potionInfo.seal'), t(`seal.${item.sealId}`)),
    stat(t('potionInfo.form'), t(`form.${item.formId}`)),
  ];

  if (getForm(item.formId).doses > 1) {
    facts.push(stat(t('potionInfo.doses'), formatNumber(item.dosesLeft)));
  }
  facts.push(stat(t('potionInfo.value'), formatGold(item.fairValue), 'good'));
  if (supplyBonus > 0) {
    facts.push(stat(t('potionInfo.supplyBonus'), `+${supplyBonus}`, 'good'));
  }

  overlay.append(
    el('div', { class: 'dialog potion-info', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'ingredient-info-head' }, [
        el('span', { class: 'ingredient-info-art' }, [potionIcon(item.recipeId, 44)]),
        el('div', {}, [
          el('h2', { text: t(`recipe.${item.recipeId}`) }),
          el('div', { class: 'row-sub' }, [
            gradeBadge(item.grade),
            chip(t(`potency.${item.potencyTier}`)),
            // Only where there is a stack behind the tile that was tapped.
            ...(count > 1 ? [chip(t('potionInfo.held', { count }))] : []),
          ]),
        ]),
      ]),
      el('div', { class: 'potion-facts' }, facts),
      // Unheaded, under the figures: a remark about the bottle rather than
      // another field of it.
      ...notesOn(sim, item).map((note) =>
        el('p', { class: 'ingredient-info-note', text: note }),
      ),
      el('div', { class: 'dialog-actions' }, [
        button(t('common.close'), dismiss, { variant: 'quiet' }),
      ]),
    ]),
  );

  document.getElementById('panels')?.append(overlay);
}
