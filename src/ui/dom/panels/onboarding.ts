/**
 * The opening checklist.
 *
 * Not a tutorial: it never takes the controls, never blocks a screen, and never
 * forces an order. It is a list of eight things that add up to one complete
 * loop, each ticking itself off when the world says it happened.
 *
 * It sits above the panel on whatever screen the next step belongs to, and
 * disappears the moment the loop closes.
 */

import { button, el } from '../components';
import { t } from '@/i18n';
import type { Simulation } from '@/sim/sim';
import { bus, changed, type ScreenId } from '@/ui/bus';

let collapsed = false;

export function renderOnboarding(sim: Simulation): HTMLElement {
  const { visible, steps, current } = sim.onboarding;
  if (!visible) return el('span');

  const done = steps.filter((step) => step.done).length;

  const header = el('div', { class: 'checklist-head' }, [
    el('span', { class: 'checklist-title', text: t('onboarding.title') }),
    el('span', {
      class: 'checklist-count num',
      text: t('onboarding.progress', { done, total: steps.length }),
    }),
    button(
      collapsed ? t('onboarding.expand') : t('onboarding.collapse'),
      () => {
        collapsed = !collapsed;
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      t('onboarding.dismiss'),
      () => {
        sim.dismissOnboarding();
        changed();
      },
      { variant: 'quiet', small: true },
    ),
  ]);

  const section = el('section', { class: 'checklist' }, [header]);

  if (collapsed) {
    // Collapsed still shows the one thing to do next — a checklist that hides
    // the next step is just a banner.
    if (current) {
      section.append(
        el('p', { class: 'checklist-next', text: t(`onboarding.step.${current.id}`) }),
      );
    }
    return section;
  }

  for (const step of steps) {
    const row = el('div', { class: 'checklist-row' }, [
      el('span', { class: 'checklist-mark', text: step.done ? '✓' : '○' }),
      el('span', { class: 'checklist-text', text: t(`onboarding.step.${step.id}`) }),
    ]);
    row.dataset.done = String(step.done);
    if (current && step.id === current.id) {
      row.dataset.current = 'true';
      // One tap to the screen the step happens on, so the list is navigable
      // rather than a set of instructions to follow by hand.
      row.append(
        button(
          t(`nav.${step.screen}`),
          () => bus.emit({ type: 'screen:changed', screen: step.screen as ScreenId }),
          { variant: 'ghost', small: true },
        ),
      );
    }
    section.append(row);
  }

  return section;
}

export function resetOnboardingCollapse(): void {
  collapsed = false;
}
