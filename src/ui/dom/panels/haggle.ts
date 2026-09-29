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
  portrait,
  potionIcon,
  sectionHead,
  row,
  slot,
  slotGrid,
  stat,
  TILE_ICON,
} from '../components';
import { formatGold, t } from '@/i18n';
import { customersConfig, getCustomer } from '@/sim/config';
import { findOwnedBottle } from '@/sim/haggle';
import type { HaggleClose } from '@/sim/haggle';

import type { Simulation } from '@/sim/sim';
import { changed, toast } from '@/ui/bus';

let chosenCustomer: string | null = null;
let ask = 0;

/**
 * How the last haggle ended, when it ended without the player closing it.
 *
 * A customer whose patience runs out buys and leaves in the same pitch, and
 * the session view goes with them — so what they paid would be gone from the
 * screen before it was read. It stays up on the counter until dismissed or
 * until the next haggle begins.
 */
let lastOutcome: { customerId: string; result: HaggleClose } | null = null;

export function resetHaggle(): void {
  chosenCustomer = null;
  ask = 0;
}

/** The walk-in list, or the negotiation when one is open; null when the counter is empty. */
export function renderHaggle(sim: Simulation): HTMLElement | null {
  if (sim.haggle) return renderSession(sim);

  const walkIns = sim.walkIns();
  if (walkIns.length === 0 && !lastOutcome) return null;

  const section = el('section', { class: 'walkins' });
  if (lastOutcome) section.append(renderOutcome(lastOutcome));
  if (walkIns.length === 0) return section;

  section.append(sectionHead(t('haggle.walkIns'), t('haggle.walkIns.hint')));

  // Where each shelved bottle stands, so a tile can say so. Twelve shelves at
  // most, read once per render rather than once per tile.
  const shelfNumber = new Map<string, number>();
  sim.world.shelf.forEach((shelfSlot, index) => {
    if (shelfSlot.item) shelfNumber.set(shelfSlot.item.uid, index + 1);
  });

  for (const walkIn of walkIns) {
    const def = getCustomer(walkIn.customerId);
    const open = chosenCustomer === walkIn.customerId;

    // The card is the control: a tap opens what they came for under it, and a
    // second tap closes it. A button beside a face and two chips had no room
    // on a phone for the sentence it needed.
    section.append(
      row({
        variant: 'walkin',
        key: walkIn.customerId,
        icon: portrait('customer', walkIn.customerId) ?? undefined,
        title: t(`customer.${walkIn.customerId}`),
        sub: [
          chip(t(`archetype.${def.archetype}`)),
          chip(t('haggle.wants', { count: walkIn.wantedUids.length })),
        ],
        selected: open,
        onClick: () => {
          chosenCustomer = open ? null : walkIn.customerId;
          changed();
        },
      }),
    );

    if (!open) continue;

    const tiles = walkIn.wantedUids.map((uid) => {
      const item = findOwnedBottle(sim.world, uid)!.item;
      const onShelf = shelfNumber.get(uid);
      return slot({
        id: uid,
        icon: potionIcon(item.recipeId, TILE_ICON),
        label: t(`recipe.${item.recipeId}`),
        caption: [
          gradeBadge(item.grade),
          goldText(item.fairValue),
          ...(onShelf ? [chip(t('counter.onShelf', { number: onShelf }))] : []),
        ],
        onActivate: () => {
          if (sim.beginHaggle(walkIn.customerId, uid)) {
            ask = sim.suggestedAsk();
            chosenCustomer = null;
            lastOutcome = null;
            changed();
          }
        },
      });
    });
    section.append(slotGrid(tiles, t('haggle.nothingWanted')));
  }

  return section;
}

/** What the customer did when their patience ran out, and what it paid. */
function renderOutcome(outcome: { customerId: string; result: HaggleClose }): HTMLElement {
  const { customerId, result } = outcome;
  const face = portrait('customer', customerId);
  return el('div', { class: 'haggle-outcome', 'data-sold': String(result.sold) }, [
    el('div', { class: 'haggle-outcome-head' }, [
      ...(face ? [face] : []),
      el('div', { class: 'haggle-who' }, [
        el('span', { class: 'haggle-name', text: t(`customer.${customerId}`) }),
        el('p', {
          class: 'haggle-outcome-line',
          text: result.sold
            ? t('haggle.patienceOut', { gold: formatGold(result.gold) })
            : t('haggle.patienceOut.gone'),
        }),
      ]),
    ]),
    el('div', { class: 'row-actions' }, [
      button(
        t('haggle.outcome.dismiss'),
        () => {
          lastOutcome = null;
          changed();
        },
        { variant: 'quiet', small: true },
      ),
    ]),
  ]);
}

function renderSession(sim: Simulation): HTMLElement {
  const session = sim.haggle!;
  const def = getCustomer(session.customerId);
  const item = findOwnedBottle(sim.world, session.itemUid)?.item;
  if (ask <= 0) ask = sim.suggestedAsk();

  const section = el('section', { class: 'haggle' });
  const face = portrait('customer', session.customerId);

  section.append(
    el('div', { class: 'haggle-head' }, [
      ...(face ? [face] : []),
      el('div', { class: 'haggle-who' }, [
        el('span', { class: 'haggle-name', text: t(`customer.${session.customerId}`) }),
        chip(t(`archetype.${def.archetype}`)),
      ]),
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
            const customerId = session.customerId;
            const step = sim.pitch(actionId);
            // Out of patience, they bought at their last offer and left; the
            // outcome stays on the counter to be read.
            if (step?.settled) {
              lastOutcome = { customerId, result: step.settled };
              toast(
                step.settled.sold
                  ? t('haggle.patienceOut', { gold: formatGold(step.settled.gold) })
                  : t('haggle.patienceOut.gone'),
              );
              resetHaggle();
            }
            changed();
          });
          return node;
        }),
      ),
    );
  }

  // The price stepper. Coarse and fine steps, no typing, no dragging.
  const stepper = el('div', { class: 'stepper' }, [
    button(
      '−25',
      () => {
        ask = Math.max(1, ask - 25);
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      '−5',
      () => {
        ask = Math.max(1, ask - 5);
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    el('span', { class: 'stepper-value num', text: formatGold(ask) }),
    button(
      '+5',
      () => {
        ask += 5;
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      '+25',
      () => {
        ask += 25;
        changed();
      },
      { variant: 'quiet', small: true },
    ),
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
          result.sold ? t('haggle.sold', { gold: formatGold(result.gold) }) : t('haggle.refused'),
        );
        resetHaggle();
        changed();
      }),
    ]),
  );

  return section;
}
