/**
 * What a party brought home.
 *
 * The haul used to land in stores while nobody was looking — the only trace was
 * a ledger line and an ingredient count that had quietly gone up. An expedition
 * is the longest thing a player waits for in this game, and it resolved with
 * less ceremony than harvesting a plot.
 *
 * So the rolls happen when the party is due and are then held. This screen is
 * where they are handed over: the claim is what moves the goods, once.
 */

import { button, el, ingredientIcon, modal } from './components';
import { formatNumber, t } from '@/i18n';
import type { Simulation } from '@/sim/sim';
import type { MissionOutcome } from '@/sim/types';
import { changed } from '@/ui/bus';

export function showMissionReward(sim: Simulation, missionId: string): void {
  /*
   * Claim first, then show what was claimed.
   *
   * The sim returns null if this party has already been greeted, which is the
   * guard against a double tap paying twice — and against a stale card left on
   * screen by a panel that has not redrawn yet.
   */
  const outcome = sim.claimMission(missionId);
  if (!outcome) return;

  modal({
    className: 'reward',
    // Claiming a haul changes the world; the board behind this redraws once the
    // card is out of the way rather than underneath it.
    onClose: changed,
    content: (dismiss) => [
      el('h2', { text: t(`biome.${outcome.biomeId}`) }),
      // Its own keys rather than `quality.*`: those are lower-case because they
      // sit mid-sentence in the ledger, and this is a heading.
      el('p', {
        class: `reward-quality is-${outcome.quality}`,
        text: t(`reward.${outcome.quality}`),
      }),
      renderHaul(outcome),
      ...renderInjuries(outcome),
      el('div', { class: 'dialog-actions' }, [
        button(t('common.close'), dismiss, { variant: 'gold' }),
      ]),
    ],
  });
}

/** The find list, or a line saying there wasn't one. */
function renderHaul(outcome: MissionOutcome): HTMLElement {
  if (outcome.found.length === 0) {
    return el('p', { class: 'field-note', text: t('reward.nothing') });
  }

  return el(
    'div',
    { class: 'reward-haul' },
    outcome.found.map((entry) =>
      el('div', { class: 'reward-find' }, [
        ingredientIcon(entry.ingredientId, 28),
        el('span', { class: 'reward-find-name', text: t(`ingredient.${entry.ingredientId}`) }),
        el('span', { class: 'reward-find-count num', text: `×${formatNumber(entry.count)}` }),
      ]),
    ),
  );
}

/**
 * Who came back hurt.
 *
 * Named rather than counted: the injury costs that particular hero their next
 * expedition, and "one of them is hurt" is not something a player can plan the
 * next party around.
 */
function renderInjuries(outcome: MissionOutcome): HTMLElement[] {
  if (outcome.injured.length === 0) return [];
  return [
    el('p', {
      class: 'reward-injured',
      text: t('reward.injured', {
        heroes: outcome.injured.map((id) => t(`hero.${id}`)).join(', '),
      }),
    }),
  ];
}
