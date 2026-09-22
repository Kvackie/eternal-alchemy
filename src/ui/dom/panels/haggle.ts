/**
 * The haggle.
 *
 * The customer's stance is the whole read, so it gets the top of the panel and
 * says plainly what it is. Each pitch button shows how it would land against
 * that stance *before* it is pressed — the system is meant to be reasoned
 * through, not memorised, and hiding the matrix would only make it a guess.
 *
 * Five buttons and a price stepper. Touch and mouse identical.
 */

import {
  button,
  chip,
  el,
  goldText,
  gradeBadge,
  meter,
  potionIcon,
  sectionHead,
  slot,
  slotGrid,
  stat,
} from '../components';
import { formatGold, t } from '@/i18n';
import { customersConfig, getCustomer, getRecipe } from '@/sim/config';

import { dominantEssence } from '@/ui/art';
import type { Simulation } from '@/sim/sim';
import { changed, toast } from '@/ui/bus';

let chosenCustomer: string | null = null;
let ask = 0;

export function resetHaggle(): void {
  chosenCustomer = null;
  ask = 0;
}

/** The walk-in section of the Shop screen, and the negotiation when one is open. */
export function renderHaggle(sim: Simulation): HTMLElement {
  if (sim.haggle) return renderSession(sim);

  const walkIns = sim.walkIns();
  if (walkIns.length === 0) return el('span');

  const section = el('section', { class: 'walkins' }, [
    sectionHead(t('haggle.walkIns'), t('haggle.walkIns.hint')),
  ]);

  for (const walkIn of walkIns) {
    const def = getCustomer(walkIn.customerId);
    const open = chosenCustomer === walkIn.customerId;

    const row = el('div', { class: 'walkin' }, [
      el('div', { class: 'plot-main' }, [
        el('span', { class: 'plot-title', text: t(`customer.${walkIn.customerId}`) }),
        el('div', { class: 'row-sub' }, [
          chip(t(`archetype.${def.archetype}`)),
          chip(t('haggle.wants', { count: walkIn.wantedUids.length })),
        ]),
      ]),
      button(
        open ? t('haggle.closeList') : t('haggle.show'),
        () => {
          chosenCustomer = open ? null : walkIn.customerId;
          changed();
        },
        { small: true, variant: open ? 'quiet' : 'ghost' },
      ),
    ]);
    section.append(row);

    if (!open) continue;

    const tiles = walkIn.wantedUids.map((uid) => {
      const item = sim.world.bottled.find((entry) => entry.uid === uid)!;
      const essence = dominantEssence(getRecipe(item.recipeId).target);
      return slot({
        id: uid,
        icon: potionIcon(item.recipeId),
        label: t(`recipe.${item.recipeId}`),
        caption: [gradeBadge(item.grade), goldText(item.fairValue)],
        onActivate: () => {
          if (sim.beginHaggle(walkIn.customerId, uid)) {
            ask = sim.suggestedAsk();
            chosenCustomer = null;
            changed();
          }
        },
      });
    });
    section.append(slotGrid(tiles, t('haggle.nothingWanted')));
  }

  return section;
}

function renderSession(sim: Simulation): HTMLElement {
  const session = sim.haggle!;
  const def = getCustomer(session.customerId);
  const item = sim.world.bottled.find((entry) => entry.uid === session.itemUid);
  if (ask <= 0) ask = sim.suggestedAsk();

  const section = el('section', { class: 'haggle' });

  section.append(
    el('div', { class: 'haggle-head' }, [
      el('span', { class: 'haggle-name', text: t(`customer.${session.customerId}`) }),
      chip(t(`archetype.${def.archetype}`)),
    ]),
    // The stance is the read. It gets its own line and says what it means.
    el('div', { class: 'stance', 'data-stance': session.stance }, [
      el('span', { class: 'stance-label', text: t(`stance.${session.stance}`) }),
      el('span', { class: 'stance-line', text: t(`stance.${session.stance}.line`) }),
    ]),
  );

  if (item) {
    section.append(
      stat(
        t('haggle.item'),
        el('span', { class: 'inline-pair' }, [
          el('span', { text: t(`recipe.${item.recipeId}`) }),
          gradeBadge(item.grade),
        ]),
      ),
      stat(t('haggle.fair'), goldText(item.fairValue)),
    );
  }

  section.append(
    stat(t('haggle.rounds'), String(session.roundsLeft)),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: t('haggle.patience') }),
      meter(Math.max(0, session.patience) / customersConfig.startingPatience),
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: t('haggle.interest') }),
      meter(Math.min(1, session.interest / 100)),
    ]),
  );

  if (session.lastResult) {
    section.append(
      el('p', { class: 'haggle-log', text: t(`haggle.result.${session.lastResult}`) }),
    );
  }

  if (!session.finished) {
    const actions = [...customersConfig.actions.map((a) => a.id), 'holdFirm'];
    section.append(
      el(
        'div',
        { class: 'pitch-grid' },
        actions.map((actionId) => {
          const result = sim.previewPitch(actionId) ?? 'neutral';
          const node = el('button', { class: 'pitch', type: 'button' }, [
            el('span', { class: 'pitch-name', text: t(`pitch.${actionId}`) }),
            el('span', { class: 'pitch-effect', text: t(`haggle.effect.${result}`) }),
          ]);
          node.dataset.result = result;
          node.addEventListener('click', () => {
            sim.pitch(actionId);
            changed();
          });
          return node;
        }),
      ),
    );
  }

  // The price stepper. Coarse and fine steps, no typing, no dragging.
  const stepper = el('div', { class: 'stepper' }, [
    button('−25', () => {
      ask = Math.max(1, ask - 25);
      changed();
    }, { variant: 'quiet', small: true }),
    button('−5', () => {
      ask = Math.max(1, ask - 5);
      changed();
    }, { variant: 'quiet', small: true }),
    el('span', { class: 'stepper-value num', text: formatGold(ask) }),
    button('+5', () => {
      ask += 5;
      changed();
    }, { variant: 'quiet', small: true }),
    button('+25', () => {
      ask += 25;
      changed();
    }, { variant: 'quiet', small: true }),
  ]);

  section.append(
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: t('haggle.ask') }),
      stepper,
    ]),
    el('div', { class: 'row-actions' }, [
      button(
        t('haggle.walkAway'),
        () => {
          sim.abandonHaggle();
          resetHaggle();
          changed();
        },
        { variant: 'quiet', small: true },
      ),
      button(t('haggle.offer'), () => {
        const result = sim.closeHaggle(ask);
        if (!result) return;
        toast(
          result.sold
            ? t('haggle.sold', { gold: formatGold(result.gold) })
            : t('haggle.refused'),
        );
        resetHaggle();
        changed();
      }),
    ]),
  );

  return section;
}
