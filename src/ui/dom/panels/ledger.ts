/**
 * The Ledger: what the shop has done, and what has happened in it.
 *
 * This is a full-width screen rather than a docked panel, because it is the one
 * place in the game that is genuinely a document — a column of statistics beside
 * a paginated log. Settings used to live here; they moved out, since "how big is
 * my text" has nothing to do with "what did I earn last week".
 */

import {
  VALUE_MARK,
  button,
  chip,
  el,
  gradeBadge,
  panelHeader,
  splitOnValue,
} from '../components';
import { formatGold, formatNumber, has, t } from '@/i18n';
import { dayStateAt } from '@/sim/clock';
import { logPage } from '@/sim/log';
import type { LogEntry, LogKind } from '@/sim/types';
import type { Simulation } from '@/sim/sim';
import { changed } from '@/ui/bus';

const PAGE_SIZE = 12;

type Filter = 'all' | 'trade' | 'craft' | 'garden' | 'expedition' | 'shop';

const FILTERS: Record<Filter, LogKind[] | undefined> = {
  all: undefined,
  trade: [
    'sold',
    'stocked',
    'bought',
    'bartered',
    'contractDelivered',
    'contractPosted',
    'contractFailed',
    'haggleWon',
    'haggleLost',
  ],
  craft: ['brewStarted', 'brewReady', 'brewRejected', 'bottled'],
  garden: ['planted', 'harvested', 'seedFound', 'caveHarvest', 'oreFound'],
  expedition: [
    'missionSent',
    'missionReturned',
    'heroInjured',
    'heroHealed',
    'heroRecruited',
    'heroDismissed',
  ],
  shop: ['installed', 'furnished', 'rankUp', 'strainBred', 'retired'],
};

let page = 1;
let filter: Filter = 'all';

export function renderLedger(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body ledger' });

  body.append(renderSummary(sim));
  body.append(renderLog(sim));

  return el('div', { class: 'panel panel-wide' }, [
    panelHeader(t('ledger.title'), t('ledger.subtitle')),
    body,
  ]);
}

function renderSummary(sim: Simulation): HTMLElement {
  const s = sim.world.statistics;
  const day = dayStateAt(sim.now);

  // Third field names a currency, so the figure is drawn in that currency's
  // colour — the same three colours these numbers carry in the HUD.
  /*
   * Every figure here is a number except one: the rank is a name.
   *
   * It is marked so, because a name wants none of what a figure wants — not the
   * monospace of `num`, which made "Arch-Alchemist" 169px wide in a 97px card
   * and had it broken after "Arch-Alchemis", and not a third of a row either.
   */
  const cards: Array<[string, string, string?, 'word'?]> = [
    [t('ledger.stats.gold'), formatGold(sim.world.gold), 'gold'],
    [t('ledger.stats.rank'), t(`rank.${sim.rankId}`), undefined, 'word'],
    [t('ledger.stats.renown'), formatNumber(Math.round(sim.world.renown)), 'renown'],
    [t('ledger.stats.sold'), formatNumber(s.itemsSold)],
    [t('ledger.stats.earned'), formatGold(s.goldEarned), 'gold'],
    [t('ledger.stats.brewed'), formatNumber(s.brewsFinished)],
    [t('ledger.stats.harvested'), formatNumber(s.cropsHarvested)],
    [t('ledger.stats.seeds'), formatNumber(s.seedsRecovered)],
    [t('ledger.stats.fungi'), formatNumber(s.fungiHarvested)],
    [t('ledger.stats.ore'), formatNumber(s.oreExtracted)],
    [t('ledger.stats.missions'), formatNumber(s.missionsCompleted)],
    [t('ledger.stats.contracts'), formatNumber(s.contractsDelivered)],
    [t('ledger.stats.haggles'), formatNumber(s.hagglesWon)],
    [t('ledger.stats.strains'), formatNumber(s.strainsBred)],
    [t('ledger.stats.mastery'), formatNumber(sim.world.mastery), 'mastery'],
    [t('ledger.stats.day'), `${day.dayNumber + 1}`],
  ];

  return el('section', { class: 'ledger-summary' }, [
    el('span', { class: 'field-label', text: t('ledger.overview') }),
    el(
      'div',
      { class: 'stat-grid' },
      cards.map(([label, value, tone, kind]) =>
        el('div', { class: `stat-card${kind === 'word' ? ' stat-card-word' : ''}` }, [
          el('span', { class: 'stat-card-label', text: label }),
          el('span', {
            class: `stat-card-value${kind === 'word' ? '' : ' num'}${tone ? ` ${tone}` : ''}`,
            text: value,
          }),
        ]),
      ),
    ),
  ]);
}

function renderLog(sim: Simulation): HTMLElement {
  const result = logPage(sim.world, page, PAGE_SIZE, FILTERS[filter]);
  page = result.page;

  const tabs = el(
    'div',
    { class: 'options' },
    (['all', 'trade', 'craft', 'garden', 'expedition', 'shop'] as Filter[]).map((id) => {
      const node = el('button', { class: 'option', type: 'button' }, [
        el('span', { text: t(`ledger.filter.${id}`) }),
      ]);
      node.setAttribute('aria-pressed', String(filter === id));
      node.addEventListener('click', () => {
        filter = id;
        page = 1;
        changed();
      });
      return node;
    }),
  );

  const rows =
    result.entries.length === 0
      ? [el('p', { class: 'grid-empty', text: t('ledger.log.empty') })]
      : result.entries.map(renderEntry);

  const pager = el('div', { class: 'pager' }, [
    button(
      t('ledger.page.prev'),
      () => {
        page = Math.max(1, page - 1);
        changed();
      },
      { variant: 'quiet', small: true, disabled: result.page <= 1 },
    ),
    el('span', {
      class: 'pager-label num',
      text: t('ledger.page.of', { page: result.page, count: result.pageCount }),
    }),
    button(
      t('ledger.page.next'),
      () => {
        page = Math.min(result.pageCount, page + 1);
        changed();
      },
      { variant: 'quiet', small: true, disabled: result.page >= result.pageCount },
    ),
  ]);

  return el('section', { class: 'ledger-log' }, [
    el('div', { class: 'log-head' }, [
      el('span', { class: 'field-label', text: t('ledger.log') }),
      el('span', { class: 'field-note', text: t('ledger.log.count', { count: result.total }) }),
    ]),
    tabs,
    el('div', { class: 'log-rows' }, rows),
    pager,
  ]);
}

/**
 * Render one log line.
 *
 * Entries store a kind and loose parameters, so the sentence is built here, in
 * the reader's language, rather than frozen at write time.
 */
function renderEntry(entry: LogEntry): HTMLElement {
  const day = dayStateAt(entry.at);
  const params: Record<string, string | number> = { ...entry.params };

  // Ids in the log become names here; the log itself stays language-free.
  if (typeof params.recipe === 'string') params.recipe = t(`recipe.${params.recipe}`);
  if (typeof params.ingredient === 'string') params.ingredient = t(`ingredient.${params.ingredient}`);
  if (typeof params.crop === 'string') params.crop = t(`crop.${params.crop}`);
  if (typeof params.vessel === 'string') params.vessel = t(`vessel.${params.vessel}`);
  if (typeof params.rank === 'string') params.rank = t(`rank.${params.rank}`);
  if (typeof params.hero === 'string') params.hero = t(`hero.${params.hero}`);
  if (typeof params.biome === 'string') params.biome = t(`biome.${params.biome}`);
  if (typeof params.quality === 'string') params.quality = t(`quality.${params.quality}`);
  if (typeof params.customer === 'string') params.customer = t(`customer.${params.customer}`);
  if (typeof params.town === 'string') params.town = t(`town.${params.town}`);
  // Substituted as a marker, then cut back out below so the coin is gold-coloured
  // without the sentence leaving `en.json`. See `splitOnValue`.
  const goldValue = typeof params.gold === 'number' ? formatGold(params.gold) : null;
  if (goldValue !== null) params.gold = VALUE_MARK;

  // A bought item could be any kind, so try each namespace and fall back to the id.
  if (typeof params.item === 'string') {
    const id = params.item;
    for (const namespace of ['equipment', 'decor', 'ingredient', 'vessel', 'seal', 'crop']) {
      const key = `${namespace}.${id}`;
      if (has(key)) {
        params.item = t(key);
        break;
      }
    }
  }

  const grade = entry.params.grade;
  const sentence = t(`log.${entry.kind}`, params);
  const parts: Array<Node | string> = [
    el('span', { class: 'log-day num', text: t('ledger.log.day', { day: day.dayNumber + 1 }) }),
    el('span', { class: 'log-text' }, goldValue === null
      ? [sentence]
      : splitOnValue(sentence, el('span', { class: 'gold', text: goldValue }))),
  ];
  if (typeof grade === 'string') {
    parts.push(gradeBadge(grade as Parameters<typeof gradeBadge>[0]));
  }

  const row = el('div', { class: 'log-row' }, parts);
  row.dataset.kind = entry.kind;
  return row;
}

export function resetLedgerPaging(): void {
  page = 1;
}
