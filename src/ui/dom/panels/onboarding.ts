/**
 * The opening checklist.
 *
 * Not a tutorial: it never takes the controls, never blocks a screen, and never
 * forces an order. It is a list of seven things that add up to one complete
 * loop, each ticking itself off when the world says it happened.
 *
 * On the screen it is two things. A pill in the corner, which is the whole of
 * what it costs you — a title, a count and the one line you are meant to do
 * next — and a popup behind it holding the full list. The list used to be the
 * pill: a card of eight rows parked over the bottom corner of every screen,
 * which on a phone covered two rows of cave beds and swallowed the taps meant
 * for them. A popup is over the screen only while you have asked for it, and a
 * tap outside, Escape or Close all take it away again.
 */

import { button, el, modal } from '../components';
import { t } from '@/i18n';
import type { Simulation } from '@/sim/sim';
import { bus, changed, toast, type ScreenId } from '@/ui/bus';

/** Open, so a rebuild of the panels does not raise a second one. */
let openPopup: (() => void) | null = null;

/**
 * Whether the list was finished the last time it was drawn.
 *
 * The toast marks the moment the seventh step ticks, which is a change between
 * two draws rather than a state of the world — a save loaded with the loop
 * already closed shows the finished pill, and should not be congratulated on
 * it again. Unknown until the first draw, so that draw sets it and says nothing.
 */
let drawnComplete: boolean | null = null;

export function renderOnboarding(sim: Simulation): HTMLElement | null {
  const { visible, complete, steps, current } = sim.onboarding;
  if (!visible) {
    // Dismissing while the list is up must close it, or the popup outlives the
    // thing it was describing.
    openPopup?.();
    drawnComplete = null;
    return null;
  }

  if (drawnComplete === false && complete) toast(t('onboarding.finished'));
  drawnComplete = complete;

  const done = steps.filter((step) => step.done).length;
  if (complete) return renderFinished(sim, done);

  const pill = el('button', { class: 'checklist-pill', type: 'button' }, [
    el('span', { class: 'checklist-head' }, [
      el('span', { class: 'checklist-title', text: t('onboarding.title') }),
      el('span', {
        class: 'checklist-count num',
        text: t('onboarding.progress', { done, total: steps.length }),
      }),
    ]),
    ...(current
      ? [el('span', { class: 'checklist-next', text: t(`onboarding.step.${current.id}`) })]
      : []),
  ]);
  pill.setAttribute('aria-haspopup', 'dialog');
  pill.setAttribute('aria-label', t('onboarding.open', { done, total: steps.length }));
  pill.addEventListener('click', () => openOnboarding(sim));
  return pill;
}

/**
 * The closing beat: the loop is closed, and the pill says so until it is closed.
 *
 * Not a button any more — there is nothing left to point at — but the one
 * control it holds is the same dismissal the popup's "Don't show this again"
 * performs, so it is gone from this save for good and not just from this
 * screen.
 */
function renderFinished(sim: Simulation, done: number): HTMLElement {
  const pill = el('div', { class: 'checklist-pill checklist-done', role: 'status' }, [
    el('span', { class: 'checklist-head' }, [
      el('span', { class: 'checklist-title', text: t('onboarding.done') }),
      el('span', {
        class: 'checklist-count num',
        text: t('onboarding.progress', { done, total: done }),
      }),
    ]),
    button(t('onboarding.close'), () => {
      openPopup?.();
      sim.dismissOnboarding();
      changed();
    }),
  ]);
  return pill;
}

/**
 * The list itself, over whatever you were looking at.
 *
 * It redraws on a world change rather than being built once: the last step is
 * "wait for someone to buy it", which ticks off while you are standing here
 * reading, and a list that cannot show that is a list you have to close to
 * find out.
 */
export function openOnboarding(sim: Simulation): void {
  if (openPopup) return;

  const rows = el('div', { class: 'checklist-rows' });
  const count = el('span', { class: 'checklist-count num' });

  const draw = (dismiss: () => void) => {
    const { steps, current } = sim.onboarding;
    count.textContent = t('onboarding.progress', {
      done: steps.filter((step) => step.done).length,
      total: steps.length,
    });

    rows.replaceChildren();
    for (const step of steps) {
      const row = el('div', { class: 'checklist-row' }, [
        el('span', { class: 'checklist-mark', 'aria-hidden': 'true', text: step.done ? '✓' : '○' }),
        el('span', { class: 'checklist-text', text: t(`onboarding.step.${step.id}`) }),
      ]);
      row.dataset.done = String(step.done);
      if (current && step.id === current.id) {
        row.dataset.current = 'true';
        // One tap to the screen the step happens on, so the list is navigable
        // rather than a set of instructions to follow by hand. It closes on the
        // way: the point of going there is to do the thing.
        row.append(
          button(
            t(`nav.${step.screen}`),
            () => {
              dismiss();
              bus.emit({ type: 'screen:changed', screen: step.screen as ScreenId });
            },
            { variant: 'ghost', small: true },
          ),
        );
      }
      rows.append(row);
    }
  };

  let unsubscribe = () => {};

  openPopup = modal({
    className: 'checklist-dialog',
    content: (dismiss) => {
      draw(dismiss);
      unsubscribe = bus.on((event) => {
        if (event.type === 'world:changed') draw(dismiss);
      });
      return [
        el('div', { class: 'checklist-head' }, [el('h2', { text: t('onboarding.title') }), count]),
        el('p', { text: t('onboarding.hint') }),
        rows,
        el('div', { class: 'dialog-actions' }, [
          button(
            t('onboarding.dismiss'),
            () => {
              dismiss();
              sim.dismissOnboarding();
              changed();
            },
            { variant: 'quiet' },
          ),
          button(t('onboarding.close'), () => dismiss()),
        ]),
      ];
    },
    onClose: () => {
      unsubscribe();
      openPopup = null;
    },
  });
}
