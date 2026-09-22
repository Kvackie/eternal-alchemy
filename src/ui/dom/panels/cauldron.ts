/**
 * The bench: every pot you own, and a way to buy another.
 *
 * Brewing itself is not here. It used to be — ingredients, heat, method, the
 * outcome and the recipe book all stacked in a docked panel beside a painted
 * bench — which meant the two halves of one act, choosing an ingredient and
 * watching what it did to the blend, were a scroll apart from each other.
 *
 * So this page answers one question, "which pot?", and hands the whole screen to
 * the station once you have picked one. See `station.ts`.
 */

import {
  button,
  chip,
  collapsible,
  el,
  emptyNote,
  meter,
  panelHeader,
} from '../components';
import { formatDuration, formatGold, t } from '@/i18n';
import { artUrlIf } from '@/ui/art';
import { atCauldronLimit, activityOf, buyableTiers } from '@/sim/cauldrons';
import type { CauldronActivity } from '@/sim/cauldrons';
import { findCauldronTier } from '@/sim/config';
import type { BrewInProgress, Cauldron } from '@/sim/types';
import type { Simulation } from '@/sim/sim';
import { changed, confirm, toast } from '@/ui/bus';
import { isStationOpen, openBottling, openStation, renderStation } from './station';

export { INGREDIENT_DRAG } from './station';

/** Which sections are folded shut. Shut is the exception, so this starts empty. */
const folded = new Set<string>();

function foldable(id: string, section: HTMLElement): HTMLElement {
  const [head, ...rest] = [...section.children] as HTMLElement[];
  if (!head) return section;

  return collapsible({
    className: section.className,
    head: [head],
    body: rest,
    open: !folded.has(id),
    onToggle: () => {
      if (folded.has(id)) folded.delete(id);
      else folded.add(id);
      changed();
    },
  });
}

export function renderCauldron(sim: Simulation): HTMLElement {
  // One pot at a time has the screen; the workshop is what you come back to.
  if (isStationOpen()) return renderStation(sim);

  const body = el('div', { class: 'panel-body' }, [
    renderWorkshop(sim),
    foldable('storage', renderStorage(sim)),
  ]);

  // Full rather than docked: there is no scene behind this screen any more, so
  // nothing to leave room for — and a docked panel is capped at 68% of a stage
  // that is already short on a small window.
  const panel = el('div', { class: 'panel panel-full' }, [panelHeader(t('cauldron.title')), body]);

  /*
   * The page is the scroller here, and the page is rebuilt on every click.
   *
   * The shell's other restore path keys on `.panel-body`, which on this screen
   * scrolls nothing — so without a key of its own, putting a pot away threw the
   * page back to the top and you lost your place among seven of them.
   */
  panel.dataset.keepScroll = 'cauldron-page';
  return panel;
}

/**
 * The pot's state, as a chip — with the clock still running where there is one.
 *
 * The countdown is patched in place by the shell rather than by redrawing the
 * bench, because redrawing the bench sixty times a second is what made it
 * impossible to scroll. See `needsLiveRedraw`.
 */
function stateChip(sim: Simulation, pot: Cauldron, activity: CauldronActivity): HTMLElement {
  if (activity !== 'brewing' || !pot.brewing) {
    return chip(t(`cauldron.state.${activity}`), activity === 'ready' ? 'good' : 'plain');
  }

  const node = chip(
    t('cauldron.state.brewingIn', {
      time: formatDuration(Math.max(0, pot.brewing.readyAt - sim.now)),
    }),
    'warm',
  );
  node.dataset.countdownAt = String(pot.brewing.readyAt);
  node.dataset.countdownKey = 'cauldron.state.brewingIn';
  return node;
}

/** How far along the brew is, filling on its own between two fixed moments. */
function brewProgress(sim: Simulation, brewing: BrewInProgress): HTMLElement {
  const total = brewing.readyAt - brewing.startedAt;
  const bar = meter(total > 0 ? (sim.now - brewing.startedAt) / total : 1);
  bar.classList.add('bench-progress');

  const fill = bar.querySelector<HTMLElement>('.meter-fill');
  if (fill && total > 0) {
    fill.dataset.progressFrom = String(brewing.startedAt);
    fill.dataset.progressTo = String(brewing.readyAt);
  }
  return bar;
}

/**
 * One pot card: a face that opens it, and a control that puts it away.
 *
 * The card cannot hold the button — a button may not contain a button — so the
 * pair sits in a wrapper, the same shape the supply tiles use.
 */
function potCard(sim: Simulation, pot: Cauldron, stored: boolean): HTMLElement {
  const activity = activityOf(pot);
  const art = artUrlIf('scene', pot.tierId);
  const tier = findCauldronTier(pot.tierId);

  const face = el('button', { class: 'bench-card', type: 'button' }, [
    art
      ? el('img', { class: 'bench-art', src: art, alt: '', loading: 'lazy', decoding: 'async' })
      : el('span', { class: 'slot-glyph', text: '⚗️' }),
    el('span', { class: 'bench-name', text: t(`cauldronTier.${pot.tierId}`) }),
    stored
      ? chip(t('cauldron.buy.capacity', { capacity: tier?.capacity ?? 0 }))
      : stateChip(sim, pot, activity),
  ]);

  // A pot at work says how much longer, and shows it filling. The word
  // "Brewing" on its own was the only sign anything was happening, and a grey
  // label that never changes reads the same as a grey label that means nothing.
  if (!stored && pot.brewing) face.append(brewProgress(sim, pot.brewing));
  face.dataset.activity = activity;
  face.dataset.stored = String(stored);

  if (stored) {
    // A stored pot has nothing to open — its only move is back onto the bench.
    face.disabled = true;
  } else if (activity === 'ready') {
    /*
     * A finished pot asks one question, and the card answers it here.
     *
     * The card already says Ready; pressing it used to open the station and
     * leave the player to find the bottling controls in a column. Opening the
     * window directly is the same route the drawn pot takes inside the station,
     * so "it is done" and "here is what to do about it" are one press apart
     * wherever you are standing.
     */
    face.addEventListener('click', () => {
      sim.setActiveCauldron(pot.id);
      openBottling(sim);
    });
  } else {
    face.addEventListener('click', () => openStation(sim, pot.id));
  }

  /*
   * Busy pots stay where they are.
   *
   * A pot mid-brew holds a timer and a result, so storing it would either lose
   * them or leave a brew finishing in a cupboard — and the last pot out cannot
   * go away either, or the workshop becomes a screen with nothing on it.
   */
  const canStore = !stored && activity === 'idle' && sim.cauldrons.length > 1;

  /*
   * Asked before the pot leaves the bench.
   *
   * Putting one away is reversible — it comes back from this same section — but
   * it is the one control on a card whose face you press to start working, and
   * it sits directly under that face at thumb size. Bringing a pot back out
   * needs no question: there is nothing to undo.
   */
  const move = button(
    stored ? t('cauldron.storage.place') : t('cauldron.storage.store'),
    () => {
      if (stored) {
        if (sim.setCauldronStored(pot.id, false)) changed();
        return;
      }
      confirm({
        title: t('cauldron.storage.store.title'),
        body: t('cauldron.storage.store.body', { tier: t(`cauldronTier.${pot.tierId}`) }),
        confirm: t('cauldron.storage.store'),
        danger: true,
        onConfirm: () => {
          if (sim.setCauldronStored(pot.id, true)) changed();
        },
      });
    },
    { small: true, variant: stored ? 'good' : 'danger', disabled: !stored && !canStore },
  );

  return el('div', { class: 'bench-tile' }, [face, move]);
}

/**
 * The pots you are working with.
 *
 * A card each rather than a strip of tabs: the reason to look at this page is to
 * notice that the second cauldron has finished and is waiting, and a tab strip
 * says that in the same small grey text it says everything else in.
 */
function renderWorkshop(sim: Simulation): HTMLElement {
  return el('section', { class: 'bench' }, [
    el('span', { class: 'field-label', text: t('cauldron.workshop') }),
    el(
      'div',
      { class: 'bench-grid' },
      sim.cauldrons.map((pot) => potCard(sim, pot, false)),
    ),
  ]);
}

/**
 * Pots put away, and the pots you could still buy.
 *
 * One section, because both answer the same question — what else could be on
 * the bench? A bought pot lands here rather than in the workshop, so acquiring
 * one and deciding to use it stay two separate acts a moment apart.
 */
function renderStorage(sim: Simulation): HTMLElement {
  const section = el('section', { class: 'storage' }, [
    el('span', { class: 'field-label', text: t('cauldron.storage') }),
  ]);

  const stored = sim.storedCauldrons;
  section.append(
    stored.length > 0
      ? el(
          'div',
          { class: 'bench-grid' },
          stored.map((pot) => potCard(sim, pot, true)),
        )
      : emptyNote(t('cauldron.storage.empty')),
  );

  /*
   * Nothing said when there is nothing left to buy.
   *
   * "The bench is full. There is nowhere to put another." was drawn at the
   * ownership cap, which has nothing to do with the bench — a shop at the cap
   * with five pots in storage has a bench with room on it, and the sentence
   * read as a lie about the screen it was on. The absent Buy section is the
   * whole of what there is to say.
   */
  if (atCauldronLimit(sim.world)) return section;

  const offers = buyableTiers(sim.world);
  if (offers.length === 0) {
    section.append(emptyNote(t('cauldron.buy.locked')));
    return section;
  }

  section.append(el('span', { class: 'field-label', text: t('cauldron.buy.title') }));
  for (const tier of offers) {
    /*
     * A pot you could own looks like a pot.
     *
     * The bench and the storage shelf both draw the pot; the list of what you
     * could buy was four names and two numbers each, which is the one place a
     * player is choosing between them and the one place they could not see what
     * they were choosing. Same art the card uses, at a size that suits a row.
     */
    const art = artUrlIf('scene', tier.id);
    section.append(
      el('div', { class: 'plot-row' }, [
        el('span', { class: 'buy-art' }, [
          art
            ? el('img', {
                src: art,
                alt: '',
                width: '44',
                height: '44',
                loading: 'lazy',
                decoding: 'async',
              })
            : el('span', { class: 'slot-glyph', text: '⚗️' }),
        ]),
        el('div', { class: 'plot-main' }, [
          el('span', { class: 'plot-title', text: t(`cauldronTier.${tier.id}`) }),
          el('div', { class: 'row-sub' }, [
            chip(t('cauldron.buy.capacity', { capacity: tier.capacity })),
            chip(t('cauldron.buy.slots', { count: tier.maxIngredients })),
          ]),
        ]),
        button(
          t('cauldron.buy.action', { gold: formatGold(tier.cost) }),
          () => {
            if (sim.buyCauldron(tier.id)) {
              toast(t('toast.cauldronBought', { tier: t(`cauldronTier.${tier.id}`) }));
              changed();
            }
          },
          { small: true, disabled: sim.world.gold < tier.cost },
        ),
      ]),
    );
  }

  return section;
}
