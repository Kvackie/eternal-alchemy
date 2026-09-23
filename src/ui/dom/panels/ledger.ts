/**
 * The Ledger: what the shop has done, and what has happened in it.
 *
 * This is a full-width screen rather than a docked panel, because it is the one
 * place in the game that is genuinely a document — a column of statistics beside
 * a paginated log. Settings used to live here; they moved out, since "how big is
 * my text" has nothing to do with "what did I earn last week".
 */

import {
  el,
  emptyNote,
  gradeBadge,
  pager,
  panelHeader,
  splitOnValue,
  tabPanel,
  tabStrip,
  VALUE_MARK,
} from '../components';
import { formatGold, formatNumber, has, t } from '@/i18n';
import { dayStateAt } from '@/sim/clock';
import { caveConfig, crops } from '@/sim/config';
import { logPage } from '@/sim/log';
import { nextRankProgress } from '@/sim/progression';
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
  craft: ['brewStarted', 'brewReady', 'brewRejected', 'bottled', 'recipeFound'],
  garden: [
    'planted',
    'cropDestroyed',
    'harvested',
    'seedFound',
    'caveHarvest',
    'oreFound',
    'boosterUsed',
  ],
  expedition: [
    'missionSent',
    'missionReturned',
    'heroInjured',
    'heroHealed',
    'heroRecruited',
    'heroDismissed',
  ],
  shop: ['installed', 'furnished', 'cauldronBought', 'rankUp'],
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
    renderNextRank(sim),
  ]);
}

/**
 * What the next rank still asks for: the renown, and the potion.
 *
 * A rank waits on both, so a shop with the renown and not the potion would
 * otherwise sit at a rank it cannot see a reason for. Each half says whether
 * it is done.
 */
function renderNextRank(sim: Simulation): HTMLElement {
  const next = nextRankProgress(sim.world);
  if (!next) return el('p', { class: 'next-rank', text: t('ledger.nextRank.top') });

  const line = (done: boolean, text: string) =>
    el('li', { class: done ? 'done' : '' }, [
      el('span', { class: 'next-rank-mark', text: done ? '✓' : '○' }),
      el('span', { text }),
    ]);

  const items = [
    line(
      next.renownNeeded <= 0,
      next.renownNeeded <= 0
        ? t('ledger.nextRank.renownDone')
        : t('ledger.nextRank.renown', {
            count: next.renownNeeded,
            amount: formatNumber(next.renownNeeded),
          }),
    ),
  ];
  if (next.requires) {
    items.push(
      line(
        next.requirementMet,
        t('ledger.nextRank.potion', {
          count: next.requires.essences,
          grade: next.requires.grade,
          potency: t(`potency.${next.requires.potency}`),
        }),
      ),
    );
  }

  return el('section', { class: 'next-rank' }, [
    el('span', {
      class: 'field-label',
      text: t('ledger.nextRank', { rank: t(`rank.${next.nextId}`) }),
    }),
    el('ul', {}, items),
  ]);
}

function renderLog(sim: Simulation): HTMLElement {
  const result = logPage(sim.world, page, PAGE_SIZE, FILTERS[filter]);
  page = result.page;

  // Views of one log, so a strip of tabs rather than of toggles.
  const tabs = tabStrip({
    name: 'ledger-log',
    current: filter,
    tabs: (Object.keys(FILTERS) as Filter[]).map((id) => ({
      id,
      label: t(`ledger.filter.${id}`),
    })),
    onSelect: (id) => {
      filter = id as Filter;
      page = 1;
      changed();
    },
  });

  const rows =
    result.entries.length === 0
      ? [emptyNote(t('ledger.log.empty'))]
      : result.entries.map(renderEntry);

  // Newer and Older rather than Back and More: these pages run through time.
  const pages = pager({
    page: result.page,
    pageCount: result.pageCount,
    prev: t('ledger.page.prev'),
    next: t('ledger.page.next'),
    onChange: (next) => {
      page = next;
      changed();
    },
  });

  return el('section', { class: 'ledger-log' }, [
    el('div', { class: 'log-head' }, [
      el('span', { class: 'field-label', text: t('ledger.log') }),
      el('span', { class: 'field-note', text: t('ledger.log.count', { count: result.total }) }),
    ]),
    tabs,
    tabPanel('ledger-log', filter, [el('div', { class: 'log-rows' }, rows)]),
    pages,
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
  if (typeof params.ingredient === 'string')
    params.ingredient = t(`ingredient.${params.ingredient}`);
  if (typeof params.crop === 'string') params.crop = t(`crop.${params.crop}`);
  if (typeof params.rank === 'string') params.rank = t(`rank.${params.rank}`);
  if (typeof params.hero === 'string') params.hero = t(`hero.${params.hero}`);
  if (typeof params.biome === 'string') params.biome = t(`biome.${params.biome}`);
  if (typeof params.quality === 'string') params.quality = t(`quality.${params.quality}`);
  if (typeof params.customer === 'string') params.customer = t(`customer.${params.customer}`);
  if (typeof params.town === 'string') params.town = t(`town.${params.town}`);
  if (typeof params.tier === 'string') params.tier = t(`cauldronTier.${params.tier}`);
  // Substituted as a marker, then cut back out below so the coin is gold-coloured
  // without the sentence leaving `en.json`. See `splitOnValue`.
  const goldValue = typeof params.gold === 'number' ? formatGold(params.gold) : null;
  if (goldValue !== null) params.gold = VALUE_MARK;

  // A bought item could be any kind, so try each namespace and fall back to the id.
  const packet = entry.kind === 'bought' ? boughtPacket(entry) : null;
  if (packet) {
    params.item = packet;
  } else if (typeof params.item === 'string') {
    const id = params.item;
    for (const namespace of ['equipment', 'decor', 'booster', 'board', 'ingredient', 'crop']) {
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
    el(
      'span',
      { class: 'log-text' },
      goldValue === null
        ? [sentence]
        : splitOnValue(sentence, el('span', { class: 'gold', text: goldValue })),
    ),
  ];
  if (typeof grade === 'string') {
    parts.push(gradeBadge(grade as Parameters<typeof gradeBadge>[0]));
  }

  const row = el('div', { class: 'log-row' }, parts);
  row.dataset.kind = entry.kind;
  return row;
}

/**
 * A seed or spore purchase, named as one.
 *
 * The log records what was bought by id, and a packet of seeds shares its id
 * with the herb it grows into — so "Bought Sunleaf for 12g" was a line about a
 * herb nobody sold. Nobody sells herbs or fungi loose, so a crop's id in a
 * purchase is its seed and a cave species' is its spores. A `kind` in the
 * entry says so outright where the simulation records one.
 */
function boughtPacket(entry: LogEntry): string | null {
  const id = entry.params.item;
  if (typeof id !== 'string') return null;
  const kind = entry.params.kind;
  const seed = kind === 'seed' || (kind === undefined && crops.some((crop) => crop.id === id));
  if (seed) return t('market.seedOf', { crop: t(`crop.${id}`) });
  const spore =
    kind === 'spore' ||
    (kind === undefined && caveConfig.species.some((species) => species.id === id));
  if (spore) return t('market.sporeOf', { species: t(`ingredient.${id}`) });
  return null;
}

export function resetLedgerPaging(): void {
  page = 1;
}
