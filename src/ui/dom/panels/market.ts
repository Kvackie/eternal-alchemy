/**
 * Market: whoever is in town, and what they have.
 *
 * The screen exists even when nobody is here — an empty market that tells you
 * who is due and when is far more use than a hidden one, and it is where the
 * day/night cycle finally has consequences a player can act on.
 */

import {
  chip,
  el,
  infoActions,
  infoHead,
  infoNote,
  emptyNote,
  goldText,
  ingredientIcon,
  modal,
  panelHeader,
  portrait,
  slot,
  slotGrid,
} from '../components';
import type { QuantityActionSpec } from '../components';
import { countdown, formatDuration, has, t } from '@/i18n';
import { getBooster, getCrop, getDecor, getEquipment } from '@/sim/config';
import { decorAvailability } from '@/sim/decor';
import { artUrlIf } from '@/ui/art';
import { showIngredientInfo } from '../ingredientInfo';
import { goodsNotes } from '../goods';
import type { MerchantVisit, StockEntry } from '@/sim/merchants';
import { equipmentAvailability } from '@/sim/progression';

import type { Simulation } from '@/sim/sim';
import { changed, toast } from '@/ui/bus';

export function renderMarket(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body' });
  const present = sim.merchants();

  if (present.length === 0) {
    body.append(emptyNote(t('market.closed')));
  }

  for (const visit of present) body.append(renderVisit(sim, visit));
  body.append(renderUpcoming(sim));

  /*
   * No rank readout here.
   *
   * It used to open this screen — your rank, and the renown to the next one —
   * on the reasoning that rank is what unlocks a merchant's deeper stock. But
   * this is the screen for who is in town and what they brought, and an
   * unreachable item already says why it is unreachable, on the item. Rank
   * lives in the Ledger, where the rest of your standing is.
   *
   * `panel-roomy`, like the Board and Settings: no scene behind it, so it is a
   * full-stage page on a phone and a centred card given room, rather than a
   * sheet docked to one side of a picture that is no longer drawn.
   */
  return el('div', { class: 'panel panel-roomy panel-market' }, [
    panelHeader(t('market.title'), t('market.subtitle')),
    body,
  ]);
}

/**
 * The picture on a merchant's tile, at the size a merchant's tile needs.
 *
 * Half again as big as the one on a tile you own something on. Everywhere else
 * the icon is a reminder of a thing already known — you brewed it, you planted
 * it — and the label carries the identification. Here it is the identification:
 * a pack is eleven unfamiliar names, and telling a seed from a spore from a
 * shelf board at a glance is the whole job of the grid.
 */
const MARKET_ICON = 34;

function entryIcon(entry: StockEntry): Node {
  if (entry.kind === 'equipment') {
    return el('span', { class: 'slot-glyph', text: '⚒' });
  }
  if (entry.kind === 'booster') return el('span', { class: 'slot-glyph', text: '✦' });
  if (entry.kind === 'decor') {
    const url = artUrlIf('decor', entry.id);
    return url
      ? el('img', { class: 'art-icon', src: url, alt: '', width: '40', height: '40' })
      : el('span', { class: 'slot-glyph', text: '🪟' });
  }
  if (entry.kind === 'board') {
    const url = artUrlIf('shelf', entry.id);
    return url
      ? el('img', { class: 'art-icon', src: url, alt: '', width: '48', height: '29' })
      : el('span', { class: 'slot-glyph', text: '🪵' });
  }

  // A seed is named for its crop; a spore cluster is named for the mushroom itself.
  const ingredientId = entry.kind === 'seed' ? getCrop(entry.id).yields : entry.id;
  return ingredientIcon(ingredientId, MARKET_ICON);
}

/**
 * What a barter costs, in one line and in a colour of its own.
 *
 * Every other price on this screen is a number of coins in gold, so the one
 * thing that is not paid in coins should not look like one. It reads as a
 * sentence rather than as fragments — how many, of what, at what grade — and
 * it stays on a single line, because "1 × potion" wrapping above "D or
 * better" was three pieces of one fact arranged as two.
 */
function barterCaption(count: number, grade: string): Array<Node | string> {
  return [
    el('span', {
      class: 'barter-cost',
      text: t('market.barter.cost', { count, grade }),
    }),
  ];
}

function entryLabel(entry: StockEntry): string {
  switch (entry.kind) {
    case 'seed':
      return t('market.seedOf', { crop: t(`crop.${entry.id}`) });
    case 'spore':
      return t('market.sporeOf', { species: t(`ingredient.${entry.id}`) });
    case 'ingredient':
      return t(`ingredient.${entry.id}`);
    case 'equipment':
      return t(`equipment.${entry.id}`);
    case 'decor':
      return t(`decor.${entry.id}`);
    case 'board':
      return t(`board.${entry.id}`);
    case 'booster':
      return t(`booster.${entry.id}`);
  }
}

/**
 * How long this merchant is still here, ticking in place.
 *
 * The shell retextes anything carrying `data-countdown-at` every frame, which
 * is what lets the Market stop rebuilding itself sixty times a second to move
 * one number. See `needsLiveRedraw` in the shell for what that was costing.
 */
function leavingChip(leavesAt: number, leaving: number): HTMLElement {
  const node = chip(t('market.leaves', { time: formatDuration(leaving) }));
  node.dataset.countdownAt = String(leavesAt);
  node.dataset.countdownKey = 'market.leaves';
  return node;
}

function renderVisit(sim: Simulation, visit: MerchantVisit): HTMLElement {
  const leaving = Math.max(0, visit.leavesAt - sim.now);

  const face = portrait('merchant', visit.merchantId);
  const header = el('div', { class: face ? 'merchant-head has-portrait' : 'merchant-head' }, [
    ...(face ? [face] : []),
    el('div', { class: 'merchant-title' }, [
      el('span', { class: 'merchant-name', text: t(`merchant.${visit.merchantId}`) }),
      chip(t(`merchant.${visit.merchantId}.tag`)),
    ]),
    el('div', { class: 'row-sub' }, [
      leavingChip(visit.leavesAt, leaving),
      chip(t('market.tier', { tier: visit.tier + 1 })),
      ...(visit.discount > 0
        ? [chip(t('market.discount', { percent: Math.round(visit.discount * 100) }), 'good')]
        : []),
    ]),
  ]);

  return el('section', { class: 'merchant' }, [header, ...renderStock(sim, visit)]);
}

/**
 * The order a merchant's stock is laid out in.
 *
 * A trader's pack came out in whatever order the generator happened to fill it,
 * so eleven tiles alternated seed, spore, seed, board, seed — and on a phone,
 * where a name gets about eleven characters, telling what someone sells meant
 * reading every tile. Grouped, the shape of the stock is legible without
 * reading anything: this trader is three ingredients and a shelf.
 *
 * Things the pot will see come first, then the things you keep a potion on,
 * then the shop itself. Kinds absent from a pack are
 * simply not drawn.
 */
const KIND_ORDER: Array<StockEntry['kind']> = [
  'ingredient',
  'seed',
  'spore',
  'board',
  'decor',
  'equipment',
  'booster',
];

function renderStock(sim: Simulation, visit: MerchantVisit): HTMLElement[] {
  if (visit.entries.length === 0) return [slotGrid([], t('market.stock.empty'))];

  /*
   * The index is carried, not recomputed.
   *
   * Everything downstream — buying, and the tile's own id — addresses
   * an entry by its position in the merchant's pack, so grouping must
   * not renumber them.
   */
  const byKind = new Map<StockEntry['kind'], HTMLElement[]>();
  visit.entries.forEach((entry, index) => {
    const tiles = byKind.get(entry.kind) ?? [];
    tiles.push(buildEntry(sim, visit, entry, index));
    byKind.set(entry.kind, tiles);
  });

  const out: HTMLElement[] = [];
  for (const kind of KIND_ORDER) {
    const tiles = byKind.get(kind);
    if (!tiles || tiles.length === 0) continue;
    const grid = slotGrid(tiles);
    grid.classList.add('roomy');
    out.push(
      el('div', { class: 'stock-group' }, [
        el('span', { class: 'field-label', text: t(`market.group.${kind}`) }),
        grid,
      ]),
    );
  }
  return out;
}

/**
 * One purchasable entry.
 *
 * A blocked entry stays visible with its reason attached — seeing the cauldron
 * you cannot afford yet is how a player learns what the next rank is *for*.
 */
function buildEntry(
  sim: Simulation,
  visit: MerchantVisit,
  entry: StockEntry,
  index: number,
): HTMLElement {
  const blockedKey = blockedReason(sim, entry);
  const title = [
    entryLabel(entry),
    entry.kind === 'equipment' ? t(`equipment.${entry.id}.detail`) : '',
    entry.kind === 'decor' ? t(`decor.${entry.id}.detail`) : '',
    // Where a furnishing will stand, since that is what makes it a decision.
    entry.kind === 'decor'
      ? t('decor.spotNote', { spot: t(`decor.spot.${getDecor(entry.id).spot}`) })
      : '',
    blockedKey ? t(blockedKey) : '',
  ]
    .filter(Boolean)
    .join('\n');

  return slot({
    id: `${visit.merchantId}:${index}`,
    icon: entryIcon(entry),
    label: entryLabel(entry),
    caption: blockedKey
      ? // A reason in a chip, the way a blocked thing is marked everywhere else —
        // it was loose amber text sitting where the price goes, which reads as a
        // strangely coloured price rather than as "you cannot have this yet".
        [chip(t(blockedKey), 'warn')]
      : entry.barter
        ? barterCaption(entry.barter.potions, entry.barter.minGrade)
        : // Gold is gold on every other screen; it was plain grey only here.
          [goldText(entry.price ?? 0)],
    count: entry.remaining > 1 ? entry.remaining : undefined,
    tone: blockedKey ? 'warn' : 'default',
    dimmed: Boolean(blockedKey),
    title,
    /*
     * The tile opens the thing; the panel sells it.
     *
     * A tap used to spend money — one unit, immediately, with no way to see
     * what you were buying first and a stack of twelve costing twelve taps.
     * Now it explains, and the buying is a deliberate press with a count beside
     * it. What "explains" means depends on the goods: anything the pot will see
     * gets the full ingredient panel, and the rest get their own description.
     */
    onActivate: () => openEntry(sim, visit, entry, index),
  });
}

/** Why this cannot be bought right now, or nothing. */
function blockedReason(sim: Simulation, entry: StockEntry): string | undefined {
  if (entry.remaining <= 0) return 'market.error.soldOut';
  if (entry.kind === 'equipment') {
    return equipmentAvailability(sim.world, getEquipment(entry.id)).reasonKey;
  }
  if (entry.kind === 'decor') {
    return decorAvailability(sim.world, getDecor(entry.id)).reasonKey;
  }
  if (entry.kind === 'booster' && sim.rankIndex < getBooster(entry.id).requiresRank) {
    return 'market.reason.rank';
  }
  return undefined;
}

/**
 * The panel for goods with no essence to report.
 *
 * A tool, a board or a furnishing has a description and a price and
 * nothing a pot would recognise, so the ingredient panel would be mostly empty
 * headings. This is the same shape with only the parts that apply.
 */
function showGoodsInfo(entry: StockEntry, label: string, action: QuantityActionSpec): void {
  /*
   * Only what the data actually holds.
   *
   * Equipment and furnishings are written up; boards are not, and `t()`
   * renders a missing key as the key itself — "board.roughPine.detail" on
   * screen. So the prose is asked for rather than assumed, and what
   * a thing does is read off its own numbers instead.
   */
  const lines: HTMLElement[] = [];
  const detailKey = `${entry.kind}.${entry.id}.detail`;
  if (has(detailKey)) lines.push(infoNote(t(detailKey)));
  for (const note of goodsNotes(entry.kind, entry.id)) {
    lines.push(infoNote(note));
  }
  if (entry.kind === 'decor') {
    lines.push(infoNote(t('decor.spotNote', { spot: t(`decor.spot.${getDecor(entry.id).spot}`) })));
  }

  modal({
    content: (dismiss) => [
      el('div', { class: 'ingredient-info' }, [
        infoHead({
          art: entryIcon(entry),
          title: label,
          chips: [chip(t(`market.kind.${entry.kind}`))],
        }),
        ...lines,
        infoActions({ dismiss, action }),
      ]),
    ],
  });
}

/** Buy this entry `quantity` times, in one pass through the simulation. */
function buyMany(
  sim: Simulation,
  merchantId: string,
  index: number,
  quantity: number,
  label: string,
): void {
  const { bought, reasonKey } = sim.buyQuantity(merchantId, index, quantity);
  if (bought === 0) {
    if (reasonKey) toast(t(reasonKey));
    return;
  }
  toast(
    bought === 1
      ? t('market.bought', { item: label })
      : t('market.boughtMany', { count: bought, item: label }),
  );
  changed();
}

/**
 * How many of this the player could take away right now.
 *
 * Bounded by the stock and by the purse, so the stepper cannot offer a number
 * the press behind it would refuse — including zero, which is the answer when
 * the purse cannot cover even one. A floor of 1 here used to hand the player an
 * enabled Buy button and a refusal toast. Bartered goods are priced in potions
 * rather than gold, so what the purse will bear is the barter rule's business
 * and they are offered one at a time; a tool or a furnishing is a single thing
 * the world holds once.
 */
function affordable(sim: Simulation, entry: StockEntry): number {
  // Priced in potions, so what the purse will bear is the barter rule's
  // business; the panel says the terms and offers one at a time.
  if (entry.barter) return Math.min(1, entry.remaining);

  const price = entry.price ?? 0;
  const byPurse = price <= 0 ? entry.remaining : Math.floor(sim.world.gold / price);

  // A tool is installed and a furnishing stands in one spot, so the world holds
  // one of either — but one is still one more than you can pay for.
  const ceiling = entry.kind === 'equipment' || entry.kind === 'decor' ? 1 : entry.remaining;

  return Math.min(ceiling, entry.remaining, byPurse);
}

function openEntry(sim: Simulation, visit: MerchantVisit, entry: StockEntry, index: number): void {
  const label = entryLabel(entry);
  // Sold out and rank-locked come first; an empty purse is the next reason, and
  // it is a reason rather than a disabled button with a price on it.
  const blockedKey = blockedReason(sim, entry);
  const affordableNow = affordable(sim, entry);
  const blocked = blockedKey ?? (affordableNow < 1 ? 'market.error.gold' : undefined);

  const action = {
    label: t('market.buy'),
    max: Math.max(1, affordableNow),
    unitPrice: entry.barter ? undefined : (entry.price ?? 0),
    blocked: blocked ? t(blocked) : undefined,
    /*
     * What it costs, when the cost is not a number of coins.
     *
     * The Ashwalker is paid in potions, so `unitPrice` has nothing to
     * say and the footer would show a Buy button over no price at all — the
     * terms were on the tile, and the tile is now only the way in. Thirteen of
     * his entries are bartered.
     */
    note: entry.barter
      ? t('market.barter.cost', { count: entry.barter.potions, grade: entry.barter.minGrade })
      : undefined,
    run: (quantity: number) => buyMany(sim, visit.merchantId, index, quantity, label),
  };

  // Anything the pot will eventually see has an essence vector worth reading,
  // so it gets the full panel with the till attached to the bottom of it.
  if (entry.kind === 'ingredient' || entry.kind === 'spore') {
    showIngredientInfo(sim, entry.id, { action });
    return;
  }
  if (entry.kind === 'seed') {
    showIngredientInfo(sim, getCrop(entry.id).yields, { action });
    return;
  }
  showGoodsInfo(entry, label, action);
}

/** When a merchant who is not here yet is due, ticking in place. */
function whenDue(at: number, now: number): HTMLElement {
  const node = el('span', {
    class: 'num upcoming-when',
    text: countdown(at, now),
  });
  node.dataset.countdownAt = String(at);
  return node;
}

function renderUpcoming(sim: Simulation): HTMLElement {
  const rows = sim
    .upcoming()
    .map((entry) =>
      el('div', { class: 'upcoming-row' }, [
        el('span', { class: 'upcoming-name', text: t(`merchant.${entry.merchantId}`) }),
        whenDue(entry.at, sim.now),
      ]),
    );

  return el('section', { class: 'upcoming' }, [
    el('span', { class: 'field-label', text: t('market.upcoming') }),
    ...rows,
  ]);
}

/** Used by the shop panel's banner, so a visit is noticeable from elsewhere. */
export function presentMerchantNames(sim: Simulation): string[] {
  return sim.merchants().map((visit) => t(`merchant.${visit.merchantId}`));
}
