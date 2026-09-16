/**
 * The contract board.
 *
 * Each row says plainly what it wants and how much of it you already have, so
 * planning a supply chain is arithmetic rather than guesswork. Deliver is
 * enabled the moment you hold one qualifying bottle, because partial delivery
 * pays pro rata and costs nothing.
 */

import { button, chip, el, meter, panelHeader, stat } from '../components';
import { formatGold, t } from '@/i18n';
import { config } from '@/sim/config';
import { contractSummary } from '@/sim/contracts';
import type { Simulation } from '@/sim/sim';
import { changed, confirm, toast } from '@/ui/bus';

export function renderBoard(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body' });

  if (sim.world.contracts.length === 0) {
    body.append(el('p', { class: 'grid-empty', text: t('board.empty') }));
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
  return el('div', { class: 'panel panel-roomy panel-cards' }, [
    panelHeader(t('board.title'), t('board.subtitle')),
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

  const requirements: HTMLElement[] = [
    chip(t('board.grade', { grade: template.minGrade })),
  ];
  if (summary.seal) requirements.push(chip(t(`seal.${summary.seal.id}`), 'warn'));
  if (summary.vessel) requirements.push(chip(t(`vessel.${summary.vessel.id}`), 'warn'));

  const node = el('div', { class: 'contract' });
  if (daysLeft < 1) node.dataset.urgent = 'true';

  node.append(
    el('div', { class: 'contract-head' }, [
      el('span', { class: 'contract-faction', text: t(`faction.${template.faction}`) }),
      chip(t('board.payout', { gold: formatGold(contract.payout) }), 'good'),
    ]),
    el('span', {
      class: 'contract-want',
      text: t('board.wants', {
        count: contract.quantity,
        recipe: t(`recipe.${template.recipeId}`),
      }),
    }),
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
    stat(
      t('board.deadline'),
      t('board.daysLeft', { days: Math.max(0, Math.ceil(daysLeft)) }),
      daysLeft < 1 ? 'warn' : undefined,
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
