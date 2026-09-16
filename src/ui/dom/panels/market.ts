/**
 * Market: whoever is in town, and what they have.
 *
 * The screen exists even when nobody is here — an empty market that tells you
 * who is due and when is far more use than a hidden one, and it is where the
 * day/night cycle finally has consequences a player can act on.
 */

import {
  button,
  chip,
  el,
  ingredientIcon,
  panelHeader,
  portrait,
  slot,
  slotGrid,
  stat,
} from '../components';
import { formatDuration, formatGold, t } from '@/i18n';
import { getCrop, getDecor, getEquipment, getIngredient, getMerchant } from '@/sim/config';
import { decorAvailability } from '@/sim/decor';
import { artUrlIf } from '@/ui/art';
import { showIngredientInfo } from '../ingredientInfo';
import type { MerchantVisit, StockEntry } from '@/sim/merchants';
import { equipmentAvailability, renownToNextRank } from '@/sim/progression';
import { essenceGlyphSvg } from '@/ui/theme';
import { dominantEssence } from '@/ui/phaser/placeholders';
import type { Simulation } from '@/sim/sim';
import { changed, toast } from '@/ui/bus';

export function renderMarket(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body' });
  const present = sim.merchants();

  body.append(renderStanding(sim));

  if (present.length === 0) {
    body.append(
      el('div', { class: 'grid-empty', text: t('market.closed') }),
    );
  }

  for (const visit of present) body.append(renderVisit(sim, visit));
  body.append(renderUpcoming(sim));

  return el('div', { class: 'panel' }, [
    panelHeader(t('market.title'), t('market.subtitle')),
    body,
  ]);
}

/** Rank sits here because rank is what opens a merchant's deeper stock. */
function renderStanding(sim: Simulation): HTMLElement {
  const next = renownToNextRank(sim.world.renown);
  return el('section', { class: 'standing' }, [
    stat(t('market.rank'), t(`rank.${sim.rankId}`)),
    next
      ? stat(
          t('market.nextRank', { rank: t(`rank.${next.nextId}`) }),
          t('market.renownNeeded', { count: Math.ceil(next.needed) }),
        )
      : stat(t('market.nextRank.none'), '—'),
  ]);
}

function entryIcon(entry: StockEntry): Node {
  if (entry.kind === 'equipment') {
    return el('span', { class: 'slot-glyph', text: '⚒' });
  }
  if (entry.kind === 'vessel') return el('span', { class: 'slot-glyph', text: '🧴' });
  if (entry.kind === 'seal') return el('span', { class: 'slot-glyph', text: '🕯' });
  if (entry.kind === 'decor') {
    const url = artUrlIf('decor', entry.id);
    return url
      ? el('img', { class: 'art-icon', src: url, alt: '', width: '24', height: '24' })
      : el('span', { class: 'slot-glyph', text: '🪟' });
  }
  if (entry.kind === 'board') {
    const url = artUrlIf('shelf', entry.id);
    return url
      ? el('img', { class: 'art-icon', src: url, alt: '', width: '30', height: '18' })
      : el('span', { class: 'slot-glyph', text: '🪵' });
  }

  // A seed is named for its crop; a spore cluster is named for the mushroom itself.
  const ingredientId = entry.kind === 'seed' ? getCrop(entry.id).yields : entry.id;
  return ingredientIcon(ingredientId);
}

function entryLabel(entry: StockEntry): string {
  switch (entry.kind) {
    case 'seed':
      return t('market.seedOf', { crop: t(`crop.${entry.id}`) });
    case 'spore':
      return t('market.sporeOf', { species: t(`ingredient.${entry.id}`) });
    case 'ingredient':
      return t(`ingredient.${entry.id}`);
    case 'vessel':
      return t(`vessel.${entry.id}`);
    case 'seal':
      return t(`seal.${entry.id}`);
    case 'equipment':
      return t(`equipment.${entry.id}`);
    case 'decor':
      return t(`decor.${entry.id}`);
    case 'board':
      return t(`board.${entry.id}`);
  }
}

function renderVisit(sim: Simulation, visit: MerchantVisit): HTMLElement {
  const def = getMerchant(visit.merchantId);
  const leaving = Math.max(0, visit.leavesAt - sim.now);

  const face = portrait('merchant', visit.merchantId);
  const header = el('div', { class: face ? 'merchant-head has-portrait' : 'merchant-head' }, [
    ...(face ? [face] : []),
    el('div', { class: 'merchant-title' }, [
      el('span', { class: 'merchant-name', text: t(`merchant.${visit.merchantId}`) }),
      chip(t(`merchant.${visit.merchantId}.tag`)),
    ]),
    el('div', { class: 'row-sub' }, [
      chip(t('market.leaves', { time: formatDuration(leaving) })),
      chip(t('market.tier', { tier: visit.tier + 1 })),
      ...(visit.discount > 0
        ? [chip(t('market.discount', { percent: Math.round(visit.discount * 100) }), 'good')]
        : []),
    ]),
    el('p', { class: 'merchant-blurb', text: t(`merchant.${visit.merchantId}.blurb`) }),
  ]);

  const tiles = visit.entries.map((entry, index) => buildEntry(sim, visit, entry, index));

  const section = el('section', { class: 'merchant' }, [
    header,
    slotGrid(tiles, t('market.stock.empty')),
  ]);

  if (sim.canSetStandingOrders) section.append(renderStandingOrder(sim, visit));
  return section;
}

/**
 * The standing order for one merchant.
 *
 * Repeatable stock only — equipment is a one-off decision and never belongs on
 * a recurring order. Deliberately no discount: this exists to stop you repeating
 * a purchase you have already decided on, not to make it cheaper.
 */
function renderStandingOrder(sim: Simulation, visit: MerchantVisit): HTMLElement {
  const order = sim.standingOrderFor(visit.merchantId);
  // One-off purchases never belong on a recurring order.
  const repeatable = visit.entries.filter(
    (entry) => entry.kind !== 'equipment' && entry.kind !== 'decor',
  );

  const rows = repeatable.map((entry) => {
    const line = order?.lines.find((l) => l.kind === entry.kind && l.id === entry.id);
    const count = line?.count ?? 0;

    const step = (delta: number) =>
      button(
        delta > 0 ? '+' : '−',
        () => {
          sim.setStandingOrderLine(
            visit.merchantId,
            entry.kind as 'seed' | 'ingredient' | 'vessel' | 'seal',
            entry.id,
            Math.max(0, count + delta),
          );
          changed();
        },
        { variant: 'quiet', small: true, disabled: delta < 0 && count === 0 },
      );

    return el('div', { class: 'order-line' }, [
      el('span', { class: 'order-name', text: entryLabel(entry) }),
      step(-1),
      el('span', { class: 'num order-count', text: String(count) }),
      step(1),
    ]);
  });

  const lines = order?.lines.length ?? 0;

  return el('div', { class: 'standing' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('market.standing') }),
      el('span', {
        class: 'field-note',
        text: lines > 0 ? t('market.standing.set', { count: lines }) : t('market.standing.hint'),
      }),
    ]),
    ...rows,
  ]);
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
  let blockedKey: string | undefined;
  let priceText: string;

  if (entry.barter) {
    priceText = t('market.barter', {
      count: entry.barter.potions,
      grade: entry.barter.minGrade,
    });
  } else {
    // Already carries the discount and the town's price level.
    priceText = formatGold(entry.price ?? 0);
  }

  if (entry.kind === 'equipment') {
    blockedKey = equipmentAvailability(sim.world, getEquipment(entry.id)).reasonKey;
  }

  if (entry.kind === 'decor') {
    blockedKey = decorAvailability(sim.world, getDecor(entry.id)).reasonKey;
  }

  if (entry.remaining <= 0) blockedKey = 'market.error.soldOut';

  const title = [
    entryLabel(entry),
    entry.kind === 'equipment' ? t(`equipment.${entry.id}.detail`) : '',
    entry.kind === 'decor' ? t(`decor.${entry.id}.detail`) : '',
    // Where a furnishing will stand, since that is what makes it a decision.
    entry.kind === 'decor' ? t('decor.spotNote', { spot: t(`decor.spot.${getDecor(entry.id).spot}`) }) : '',
    blockedKey ? t(blockedKey) : '',
  ]
    .filter(Boolean)
    .join('\n');

  return slot({
    id: `${visit.merchantId}:${index}`,
    icon: entryIcon(entry),
    label: entryLabel(entry),
    caption: blockedKey ? t(blockedKey) : priceText,
    count: entry.remaining > 1 ? entry.remaining : undefined,
    tone: blockedKey ? 'warn' : 'default',
    disabled: Boolean(blockedKey),
    title,
    /*
     * Only for things the pot will actually see.
     *
     * A seed is worth inspecting by what it grows into; an ingredient by
     * itself. Vessels, seals and equipment have their own descriptions and no
     * essence to report, so they get no dot rather than an empty panel.
     */
    onInspect:
      entry.kind === 'ingredient'
        ? () => showIngredientInfo(sim, entry.id)
        : entry.kind === 'seed'
          ? () => showIngredientInfo(sim, getCrop(entry.id).yields)
          : entry.kind === 'spore'
            ? () => showIngredientInfo(sim, entry.id)
            : undefined,
    onActivate: () => {
      const result = sim.buy(visit.merchantId, index);
      if (result.ok) {
        toast(t('market.bought', { item: entryLabel(entry) }));
        changed();
      } else if (result.reasonKey) {
        toast(t(result.reasonKey));
      }
    },
  });
}

function renderUpcoming(sim: Simulation): HTMLElement {
  const rows = sim.upcoming().map((entry) =>
    el('div', { class: 'upcoming-row' }, [
      el('span', { class: 'upcoming-name', text: t(`merchant.${entry.merchantId}`) }),
      el('span', {
        class: 'num upcoming-when',
        text: formatDuration(Math.max(0, entry.at - sim.now)),
      }),
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
