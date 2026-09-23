/**
 * The debug time panel.
 *
 * A game where a crop takes eighteen hours and a contract runs eight in-game
 * days cannot be tested by waiting. This ships in M1 rather than as an
 * afterthought, and it is nearly free because `sim.advanceTo` is the only way
 * time ever moves — "skip four days" is the same call the resume path makes.
 *
 * Dev builds show the toggle; production tree-shakes this module out.
 */

import { button, el } from '@/ui/dom/components';
import { nextPhaseStart } from '@/sim/clock';
import { config, crops, ingredients } from '@/sim/config';
import { t } from '@/i18n';
import { bus, changed } from '@/ui/bus';
import type { Simulation } from '@/sim/sim';

export interface DebugDeps {
  sim: Simulation;
  getTimeScale: () => number;
  setTimeScale: (scale: number) => void;
  onNewGame: () => void;
}

const HOUR = 3_600_000;

export function renderDebugPanel(deps: DebugDeps): HTMLElement {
  const { sim } = deps;

  const scales = [0, 1, 10, 60, 600];
  const scaleOptions = el(
    'div',
    { class: 'options' },
    scales.map((scale) => {
      const node = el('button', { class: 'option', type: 'button' }, [
        el('span', { text: scale === 0 ? '⏸' : `×${scale}` }),
      ]);
      node.setAttribute('aria-pressed', String(deps.getTimeScale() === scale));
      node.addEventListener('click', () => {
        deps.setTimeScale(scale);
        changed();
      });
      return node;
    }),
  );

  const jump = el('div', { class: 'row-actions' }, [
    button(
      t('debug.jump.dawn'),
      () => {
        sim.advanceTo(nextPhaseStart(sim.now, 'dawn'));
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      t('debug.jump.dusk'),
      () => {
        sim.advanceTo(nextPhaseStart(sim.now, 'dusk'));
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      t('debug.jump.night'),
      () => {
        sim.advanceTo(nextPhaseStart(sim.now, 'night'));
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      t('debug.jump.day'),
      () => {
        sim.advanceBy(config.clock.dayLengthMs);
        changed();
      },
      { variant: 'quiet', small: true },
    ),
  ]);

  // "Away" runs the real resume path, so the While-You-Were-Away panel can be
  // tested without actually closing the app for eight hours.
  const away = el(
    'div',
    { class: 'row-actions' },
    [1, 8, 72].map((hours) =>
      button(
        t('debug.away.hours', { hours }),
        () => {
          // Runs the real resume path, so this exercises the same code an actual
          // absence would — including the While-You-Were-Away panel.
          sim.markSeen(Date.now() - hours * HOUR);
          bus.emit({ type: 'away', summary: sim.resume() });
          changed();
        },
        { variant: 'ghost', small: true },
      ),
    ),
  );

  const grants = el('div', { class: 'row-actions' }, [
    /*
     * Enough of everything to stop counting.
     *
     * The existing grants are nudges — 500 gold, 50 renown — which suit testing
     * one transaction. This is for testing the *game*: past the top rank (its
     * renown and every rank's potion), so branching out is unlocked, and 600
     * Mastery, which is more than the whole
     * Codex costs at six tiers apiece (504).
     */
    button(
      t('debug.grant.riches'),
      () => {
        sim.grant({ gold: 250_000, renown: 20_000, mastery: 600, rankPotions: true });
        changed();
      },
      { variant: 'gold', small: true },
    ),
    // The shop as it looks at the end, without playing to the end.
    button(
      t('debug.grant.outfit'),
      () => {
        sim.stockEverything();
        changed();
      },
      { variant: 'gold', small: true },
    ),
    button(
      t('debug.grant.gold'),
      () => {
        sim.grant({ gold: 500 });
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      t('debug.grant.renown'),
      () => {
        sim.grant({ renown: 50 });
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      t('debug.grant.ingredients'),
      () => {
        // Every single-essence ingredient: enough to brew any recipe at any strength.
        for (const def of ingredients) {
          if (Object.values(def.essence).filter((value) => value > 0).length !== 1) continue;
          sim.grant({ ingredient: { id: def.id, count: 10 } });
        }
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      t('debug.grant.seeds'),
      () => {
        for (const crop of crops) sim.grant({ seed: { id: crop.id, count: 10 } });
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    /*
     * Finished stock, which was the one thing there was no way to conjure.
     *
     * Everything the Shop and the Roster are about is a bottled potion, and
     * getting one meant brewing it a pot at a time. Twelve kinds at five each
     * is enough to fill a shelf, a supply rack and a search box.
     */
    button(
      t('debug.grant.bottles'),
      () => {
        sim.grant({ bottles: { kinds: 12, each: 5 } });
        changed();
      },
      { variant: 'quiet', small: true },
    ),
    button(
      t('debug.finishTimers'),
      () => {
        sim.finishAllTimers();
        changed();
      },
      { variant: 'quiet', small: true },
    ),
  ]);

  // Pinning the seed is what makes a bug report reproducible.
  /*
   * Styled by the same class every other text box uses.
   *
   * It carried its own `cssText`, naming `--sunken`, `--ink` and `--rule` —
   * three colour tokens that stopped existing when they were renamed for what
   * they mean, so the box had been drawing with no background, no text colour
   * and no border since. Its 2.25rem floor was also under the 44px the rest of
   * the project holds to.
   */
  const seedInput = el('input', {
    class: 'search-input',
    type: 'number',
    value: String(sim.world.rngSeed),
    'aria-label': t('debug.seed'),
  }) as HTMLInputElement;
  seedInput.addEventListener('change', () => {
    const value = Number.parseInt(seedInput.value, 10);
    if (Number.isFinite(value)) {
      sim.reseed(value >>> 0);
      changed();
    }
  });

  return el('div', { class: 'debug' }, [
    el('h3', { text: t('debug.title') }),
    group(t('debug.timeScale'), [scaleOptions]),
    group(t('debug.jump'), [jump]),
    group(t('debug.away'), [away]),
    group(t('debug.grant'), [grants]),
    group(t('debug.seed'), [seedInput]),
    group('', [button(t('debug.reset'), deps.onNewGame, { variant: 'warm', small: true })]),
  ]);
}

function group(label: string, children: HTMLElement[]): HTMLElement {
  const nodes: HTMLElement[] = [];
  if (label) nodes.push(el('span', { class: 'field-label', text: label }));
  nodes.push(...children);
  return el('div', { class: 'debug-group' }, nodes);
}
