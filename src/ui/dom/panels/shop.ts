/**
 * Shop: shelves and inventory.
 *
 * Bottled stock is an icon grid you can drag onto a shelf, the way any game with
 * an inventory works. Every tile is also a button, so the whole screen still
 * works with taps alone — drag is the accelerator, not the requirement.
 */

import { button, chip, el, goldText, gradeBadge, makeDropTarget, modal, panelHeader, potionIcon, slot, slotGrid } from '../components';
import { formatGold, formatPercent, t } from '@/i18n';
import { saleChance, sameGoods } from '@/sim/market';
import { getShelfTier, shelfTiers } from '@/sim/config';
import { artUrlIf } from '@/ui/art';
import { goodsNotes } from '../goods';
import { showPotionInfo } from '../potionInfo';

import { renderHaggle } from './haggle';
import type { BottledItem, ShelfSlot } from '@/sim/types';
import type { Simulation } from '@/sim/sim';
import { changed, toast } from '@/ui/bus';

export const ITEM_DRAG = 'application/x-eternal-item';

export function renderShop(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body' });

  // A customer standing at the counter comes before the shelves — they leave,
  // the shelves don't.
  body.append(renderHaggle(sim));
  body.append(renderShelves(sim));
  body.append(renderInventory(sim));
  body.append(renderDecor(sim));

  return el('div', { class: 'panel' }, [
    panelHeader(t('shop.title'), t('shop.subtitle')),
    body,
  ]);
}

/** Turn a per-tick probability into words. Thresholds are feel, not maths. */
function paceLabel(chance: number): string {
  if (chance > 0.35) return t('shop.pace.brisk');
  if (chance > 0.15) return t('shop.pace.steady');
  if (chance > 0.05) return t('shop.pace.slow');
  return t('shop.pace.stalled');
}

/** Painted potion art once it exists; until then the recipe's essence glyph. */
function itemIcon(item: BottledItem): Node {
  return potionIcon(item.recipeId);
}

function renderShelves(sim: Simulation): HTMLElement {
  const section = el('section', { class: 'shelves' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('shop.shelves') }),
      el('span', { class: 'field-note', text: t('shop.shelves.hint') }),
    ]),
  ]);

  for (const shelfSlot of sim.world.shelf) {
    section.append(renderSlot(sim, shelfSlot));
  }

  return section;
}

/**
 * The board this shelf is made of, and any better one you could fit.
 *
 * Offered on the shelf itself rather than in a separate list, because fitting a
 * board is a decision about *this* shelf — which of your shelves deserves the
 * good wood is the whole mechanic.
 */
function boardRow(sim: Simulation, shelfSlot: ShelfSlot): HTMLElement {
  const current = getShelfTier(shelfSlot.quality);
  const art = artUrlIf('shelf', shelfSlot.quality);

  const better = shelfTiers.filter(
    (tier) =>
      tier.appealBonus > current.appealBonus && (sim.world.boards[tier.id] ?? 0) > 0,
  );

  const fits = better.map((tier) =>
    button(
      t('shop.board.fit', { board: t(`board.${tier.id}`) }),
      () => {
        if (sim.fitShelfBoard(shelfSlot.id, tier.id)) {
          toast(t('shop.board.fitted', { board: t(`board.${tier.id}`) }));
          changed();
        }
      },
      { variant: 'quiet', small: true },
    ),
  );

  return el('div', { class: 'board-row' }, [
    ...(art ? [el('img', { class: 'board-thumb', src: art, alt: '', width: '46', height: '12' })] : []),
    el('span', { class: 'field-note', text: t(`board.${shelfSlot.quality}`) }),
    /*
     * What the board does, said rather than badged.
     *
     * "Appeal +8%" in green reads as a rosette the shelf has been awarded. The
     * number is the same; the sentence is about the goods standing on it, which
     * is the thing the player is actually deciding about.
     */
    ...(current.appealBonus > 0
      ? [
          el('span', {
            class: 'field-note',
            text: t('shop.board.appealNote', { percent: Math.round(current.appealBonus * 100) }),
          }),
        ]
      : []),
    ...fits,
  ]);
}

function renderSlot(sim: Simulation, shelfSlot: ShelfSlot): HTMLElement {
  const node = el('div', { class: 'shelf' });

  // Every shelf accepts a dragged bottle, empty or not — dropping onto a full
  // shelf is a no-op rather than an error, which is what a player expects.
  makeDropTarget(node, ITEM_DRAG, (uid) => {
    if (sim.stock(shelfSlot.id, uid)) changed();
    else toast(t('shop.shelf.occupied'));
  });

  if (!shelfSlot.item) {
    node.classList.add('shelf-empty');
    node.append(
      boardRow(sim, shelfSlot),
      el('span', { class: 'shelf-empty-label', text: t('shop.slot.empty') }),
      el('span', { class: 'field-note', text: t('shop.slot.emptyHint') }),
      button(t('shop.slot.stock'), () => openShelfPicker(sim, shelfSlot), { small: true }),
    );
    return node;
  }

  const item = shelfSlot.item;
  const asking = Math.round(item.fairValue * shelfSlot.priceRatio);
  const chance = saleChance(sim.world, shelfSlot, sim.now, true);

  const slider = el('input', {
    type: 'range',
    min: '40',
    max: '200',
    step: '5',
    value: String(Math.round(shelfSlot.priceRatio * 100)),
    'aria-label': t('shop.price', { percent: formatPercent(shelfSlot.priceRatio) }),
  }) as HTMLInputElement;

  slider.addEventListener('input', () => {
    sim.setPrice(shelfSlot.id, Number(slider.value) / 100);
    changed();
  });

  node.append(
    boardRow(sim, shelfSlot),
    el('div', { class: 'shelf-head' }, [
      gradeBadge(item.grade),
      el('span', { class: 'shelf-name', text: t(`recipe.${item.recipeId}`) }),
      chip(t(`form.${item.formId}`)),
      button(
        t('shop.slot.remove'),
        () => {
          sim.unstock(shelfSlot.id);
          changed();
        },
        { variant: 'quiet', small: true },
      ),
    ]),
    el('div', { class: 'shelf-price' }, [
      el('span', { class: 'price-gold num', text: formatGold(asking) }),
      chip(formatPercent(shelfSlot.priceRatio)),
      chip(paceLabel(chance), chance > 0.15 ? 'plain' : 'warn'),
      // A stacked slot has to say so, or it looks like one bottle that will not sell out.
      ...(shelfSlot.quantity > 1
        ? [chip(t('shop.stacked', { count: shelfSlot.quantity }), 'good')]
        : []),
    ]),
    slider,
  );

  return node;
}

/**
 * The shop floor.
 *
 * One row per spot, with every piece that could stand there — owned or not.
 * Showing what you *cannot* place yet is the point: the empty window advertises
 * that a window is worth furnishing, which a hidden row never would.
 */
function renderDecor(sim: Simulation): HTMLElement {
  const rows = sim.decorSpots().map((view) => {
    const options = view.options.map((option) => {
      const placed = view.placed?.id === option.def.id;

      return button(
        t(`decor.${option.def.id}`),
        () => {
          // Tapping what is already out takes it down — the only way to empty a
          // spot, and it reads as a toggle rather than needing a second control.
          if (placed) sim.clearSpot(view.spot);
          else sim.place(option.def.id);
          changed();
        },
        {
          // The filled default marks what is out; everything else stays quiet.
          variant: placed ? undefined : 'quiet',
          small: true,
          disabled: !option.owned,
          /*
           * The flavour and the figures, which is what a choice needs.
           *
           * The numbers used to be in the detail string and were taken out when
           * they moved into generated prose — which left this picker, the one
           * screen where you decide between a banner worth +10% footfall and one
           * worth +44%, with nothing to decide on. Same source as the Market's
           * panel, so the two can never drift apart.
           */
          title: option.owned
            ? [t(`decor.${option.def.id}.detail`), ...goodsNotes('decor', option.def.id)].join('\n')
            : t('decor.notOwned', { cost: formatGold(option.def.cost) }),
        },
      );
    });

    // A thumbnail of what is actually out, so the row shows the shop rather than
    // just naming it.
    const placedArt = view.placed ? artUrlIf('decor', view.placed.id) : null;

    return el('div', { class: 'decor-row' }, [
      el('div', { class: 'decor-spot' }, [
        ...(placedArt
          ? [el('img', { class: 'decor-thumb', src: placedArt, alt: '', width: '34', height: '34' })]
          : []),
        el('span', { class: 'field-label', text: t(`decor.spot.${view.spot}`) }),
        el('span', {
          class: 'field-note',
          text: view.placed ? t(`decor.${view.placed.id}`) : t('decor.spot.empty'),
        }),
      ]),
      el('div', { class: 'decor-options' }, options),
    ]);
  });

  return el('section', { class: 'decor' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('shop.decor') }),
      el('span', { class: 'field-note', text: t('shop.decor.hint') }),
    ]),
    ...rows,
  ]);
}

/**
 * Bottles gathered into stacks, by the same rule the shelf stacks them.
 *
 * Twelve identical Ember Draughts used to be twelve tiles — a wall of the same
 * picture, and a grid whose length said how much you had brewed rather than
 * what you had. `sameGoods` is the sim's own test for whether two bottles are
 * interchangeable, so the grid groups by exactly what a shelf slot would merge.
 */
function stacksOf(items: BottledItem[]): Array<{ item: BottledItem; count: number }> {
  const stacks: Array<{ item: BottledItem; count: number }> = [];
  for (const item of items) {
    const found = stacks.find((stack) => sameGoods(stack.item, item));
    if (found) found.count += 1;
    else stacks.push({ item, count: 1 });
  }
  return stacks;
}

/** Put one of these on the first shelf with room, and say so. */
function stockOne(sim: Simulation, item: BottledItem): void {
  const free = sim.world.shelf.find((entry) => !entry.item);
  if (!free) {
    toast(t('shop.noShelf'));
    return;
  }
  if (sim.stock(free.id, item.uid)) changed();
}

function renderInventory(sim: Simulation): HTMLElement {
  const tiles = stacksOf(sim.world.bottled).map(({ item, count }) =>
    slot({
      id: item.uid,
      icon: itemIcon(item),
      label: t(`recipe.${item.recipeId}`),
      count,
      caption: [gradeBadge(item.grade), goldText(item.fairValue)],
      dragType: ITEM_DRAG,
      title:
        `${t(`recipe.${item.recipeId}`)} · ${t(`form.${item.formId}`)}\n` +
        `${t(`vessel.${item.vesselId}`)} · ${t(`seal.${item.sealId}`)}`,
      // A tap tells you what it is, and the panel puts it out — the same two
      // steps as a seed in the garden or a jar in the market.
      onActivate: () =>
        showPotionInfo(sim, item, count, {
          label: t('shop.slot.stock'),
          max: 1,
          run: () => stockOne(sim, item),
        }),
    }),
  );

  return el('section', { class: 'inventory' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('shop.inventory') }),
      el('span', { class: 'field-note', text: t('shop.inventory.hint') }),
    ]),
    slotGrid(tiles, t('shop.inventory.empty')),
  ]);
}

/**
 * Fill this shelf, chosen from the shelf itself.
 *
 * Stocking used to start in the inventory and end wherever the first free shelf
 * happened to be — fine when one shelf is empty, no use at all when you mean
 * *that* one. Dragging could always say which; this is the same answer without
 * a drag.
 */
function openShelfPicker(sim: Simulation, shelfSlot: ShelfSlot): void {
  const stacks = stacksOf(sim.world.bottled);
  modal({
    content: (dismiss) => [
      el('h2', { text: t('shop.slot.stock') }),
      stacks.length === 0
        ? el('p', { class: 'grid-empty', text: t('shop.inventory.empty') })
        : slotGrid(
            stacks.map(({ item, count }) =>
              slot({
                id: item.uid,
                icon: itemIcon(item),
                label: t(`recipe.${item.recipeId}`),
                count,
                caption: [gradeBadge(item.grade), goldText(item.fairValue)],
                onActivate: () => {
                  dismiss();
                  if (sim.stock(shelfSlot.id, item.uid)) changed();
                },
              }),
            ),
          ),
      el('div', { class: 'dialog-actions' }, [
        button(t('common.close'), dismiss, { variant: 'quiet' }),
      ]),
    ],
  });
}
