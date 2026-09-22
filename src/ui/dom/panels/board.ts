/**
 * The contract board.
 *
 * Each row says plainly what it wants and how much of it you already have, so
 * planning a supply chain is arithmetic rather than guesswork. Deliver is
 * enabled the moment you hold one qualifying bottle, because partial delivery
 * pays pro rata and costs nothing.
 */

import {
  button,
  chip,
  el,
  emptyNote,
  goldText,
  gradeFloor,
  meter,
  panelHeader,
  stat,
} from '../components';
import { formatGold, t } from '@/i18n';
import { config } from '@/sim/config';
import { contractSummary } from '@/sim/contracts';
import type { Simulation } from '@/sim/sim';
import { changed, confirm, toast } from '@/ui/bus';

export function renderBoard(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body' });

  if (sim.world.contracts.length === 0) {
    body.append(emptyNote(t('board.empty')));
  }

  for (const contract of sim.world.contracts) {
    body.append(renderContract(sim, contract.id));
  }

  // Only when there is any. An empty node would still take a cell of the grid
  // the board lays its contracts out on.
  if (Object.keys(sim.world.factionReputation).length > 0) {
    body.append(renderReputation(sim));
  }

  /*
   * Roomy, because the board draws no scene.
   *
   * Docked right like the scene screens, it left the whole left half of the
   * stage empty and squeezed three contracts into a 28rem column.
   */
  /*
   * The title is the whole heading.
   *
   * "Standing orders. Bigger money than the shelf, if you can meet the terms."
   * sat under the word Board and said the same thing twice — the screen is a
   * list of standing orders, which the list makes obvious, and the rest was a
   * sales pitch for a screen the player had already chosen to open.
   */
  return el('div', { class: 'panel panel-roomy panel-cards' }, [
    panelHeader(t('board.title')),
    body,
  ]);
}

function renderContract(sim: Simulation, contractId: string): HTMLElement {
  const contract = sim.world.contracts.find((entry) => entry.id === contractId);
  if (!contract) return el('span');

  const summary = contractSummary(sim.world, contract);
  const { template } = summary;
  const canDeliver = summary.ready > 0 && summary.wanted > 0;

  // Deadlines are quoted in in-game days, and only run down while you're here.
  const daysLeft = contract.msRemaining / config.clock.dayLengthMs;

  /*
   * A colour per kind of term, because three terms used to share one.
   *
   * The grade, the seal and the vessel are three different demands, and two of
   * them were drawn in the same amber as the deadline warning and the selected
   * sort chip — so the row read as "some amber things" rather than as a grade,
   * a stopper and a bottle. The grade now wears the colour of the grade itself,
   * which is the scale the rest of the game already reads, and the other two
   * get a hue each.
   */
  const requirements: HTMLElement[] = [gradeFloor(template.minGrade)];
  if (summary.vessel) requirements.push(chip(t(`vessel.${summary.vessel.id}`), 'term-vessel'));
  if (summary.seal) requirements.push(chip(t(`seal.${summary.seal.id}`), 'term-seal'));

  const node = el('div', { class: 'contract' });
  if (daysLeft < 1) node.dataset.urgent = 'true';

  node.append(
    el('div', { class: 'contract-head' }, [
      el('span', { class: 'contract-faction', text: t(`faction.${template.faction}`) }),
      /*
       * The payout, told as a payout.
       *
       * It was a bare green number in the corner, which on a card that also
       * carries a fair value, a delivered count and a deadline is one figure
       * among four. Labelled and in gold it is the only gold thing here, which
       * is how money is drawn everywhere else in the game.
       */
      el('div', { class: 'contract-reward' }, [
        el('span', { class: 'field-label', text: t('board.reward') }),
        goldText(contract.payout),
      ]),
    ]),
    el('div', { class: 'contract-want' }, [
      el('span', { class: 'field-label', text: t('board.wantsLabel') }),
      el('span', {
        class: 'contract-goods',
        text: t('board.wants', {
          count: contract.quantity,
          recipe: t(`recipe.${template.recipeId}`),
        }),
      }),
    ]),
    el('div', { class: 'row-sub' }, requirements),
    stat(
      t('board.progress'),
      t('board.progressValue', {
        delivered: contract.delivered,
        total: contract.quantity,
        ready: summary.ready,
      }),
      summary.ready >= summary.wanted ? 'good' : undefined,
    ),
    // Red rather than amber: it is the one thing on the card that runs out.
    stat(
      t('board.deadline'),
      t('board.daysLeft', { count: Math.max(0, Math.ceil(daysLeft)) }),
      daysLeft < 1 ? 'bad' : undefined,
    ),
    meter(contract.delivered / contract.quantity),
    el('div', { class: 'row-actions' }, [
      button(
        t('board.abandon'),
        () => {
          /*
           * Asked first, because there is no way back.
           *
           * Abandoning forfeits the contract and whatever has already been
           * delivered against it, and the button sits next to Deliver on a row
           * that is thumb-sized on a phone. A mis-tap used to cost the whole
           * standing order and report it with a toast.
           */
          confirm({
            title: t('board.abandon.title'),
            // Nothing delivered yet is the common case, and "and the 0 already
            // delivered are not returned" is a sentence about nothing.
            body: t(
              contract.delivered > 0 ? 'board.abandon.bodyDelivered' : 'board.abandon.body',
              {
                count: contract.quantity,
                recipe: t(`recipe.${template.recipeId}`),
                delivered: contract.delivered,
              },
            ),
            confirm: t('board.abandon'),
            onConfirm: () => {
              sim.abandonContract(contract.id);
              toast(t('board.abandoned'));
              changed();
            },
          });
        },
        { variant: 'quiet', small: true },
      ),
      button(
        t('board.deliver'),
        () => {
          const result = sim.deliverContract(contract.id);
          if (!result) return;
          toast(
            result.complete
              ? t('board.completed', { gold: formatGold(result.gold) })
              : t('board.partial', { count: result.delivered, gold: formatGold(result.gold) }),
          );
          changed();
        },
        { disabled: !canDeliver, small: true },
      ),
    ]),
  );

  return node;
}

function renderReputation(sim: Simulation): HTMLElement {
  const entries = Object.entries(sim.world.factionReputation);
  if (entries.length === 0) return el('span');

  return el('section', { class: 'reputation' }, [
    el('span', { class: 'field-label', text: t('board.reputation') }),
    ...entries.map(([faction, value]) =>
      stat(t(`faction.${faction}`), String(Math.round(value)), value < 0 ? 'warn' : 'good'),
    ),
  ]);
}
