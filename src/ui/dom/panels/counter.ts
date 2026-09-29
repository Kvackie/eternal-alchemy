/**
 * The Counter: who has walked in, and the haggle with whoever you are serving.
 *
 * A screen of its own rather than a section of the Shop. The Shop is stock and
 * prices — the passive trade, which runs whether you are watching or not — and
 * a customer standing at the counter is the opposite of that: someone waiting
 * on you, for a minute or two of your attention. Giving them a tab gives that
 * wait a badge, so a visit is not missed under a list of shelves.
 */

import { el, emptyState, panelHeader } from '../components';
import { t } from '@/i18n';
import type { Simulation } from '@/sim/sim';
import { renderHaggle } from './haggle';

export function renderCounter(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body counter' });
  body.append(renderHaggle(sim) ?? emptyState(t('counter.empty'), t('counter.empty.hint')));

  return el('div', { class: 'panel panel-roomy' }, [
    panelHeader(t('counter.title'), t('counter.subtitle')),
    body,
  ]);
}
