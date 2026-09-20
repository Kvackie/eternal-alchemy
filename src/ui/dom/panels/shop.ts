/**
 * Shop: the floor, and the store room behind it.
 *
 * Two views rather than one long page. Putting stock out and arranging the
 * floor are different jobs done at different times — one is "I have brewed
 * twelve things, get them on sale", the other is "which shelf should the good
 * ones be on" — and stacking both into a single scroll meant every act of
 * either began with a hunt for the right section.
 *
 * The floor is shelves, furnishings and whoever is at the counter. The store is
 * what you own and have not put out: bottles, and the boards you could fit. A
 * customer is drawn on both, because a customer leaves and the shelves do not.
 */

import { button, chip, el, goldText, gradeBadge, modal, panelHeader, potionIcon, slot, slotGrid } from '../components';
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

/*
 * There is no dragging here.
 *
 * Rearranging by dragging one row of a list onto another was a poor fit for
 * what the gesture is for: you drag a thing to a place you can see. That place
 * is the painted shop, which is out of the build for now, so the tap route —
 * pick the shelf, pick where it goes — is the only route until the picture is
 * back to drag onto.
 */

type Tab = 'floor' | 'store';

/**
 * Which half is showing.
 *
 * Module state, like the Grounds' tabs: it must survive the panel being rebuilt
 * — which happens on every press — and it is not worth saving between sessions,
 * because the floor is the right thing to arrive at.
 */
let tab: Tab = 'floor';

export function renderShop(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body' });

  // A customer standing at the counter comes before everything, on both views
  // — they leave, and neither the shelves nor the store room do.
  body.append(renderHaggle(sim));

  body.append(
    el(
      'div',
      { class: 'options tabs' },
      (['floor', 'store'] as Tab[]).map((id) => {
        const node = el('button', { class: 'option', type: 'button' }, [
          el('span', { text: t(`shop.tab.${id}`) }),
        ]);
        node.setAttribute('aria-pressed', String(tab === id));
        node.addEventListener('click', () => {
          tab = id;
          changed();
        });
        return node;
      }),
    ),
  );

  if (tab === 'floor') {
    body.append(renderShelves(sim), renderDecor(sim));
  } else {
    body.append(renderInventory(sim), renderBoards(sim));
  }

  /*
   * `panel-roomy`, like the Board and the Market: there is no scene behind this
   * screen any more, so it is a full-stage page on a phone and a centred card
   * given room above the breakpoint, rather than a sheet docked to one side of
   * a picture that is no longer drawn.
   */
  return el('div', { class: 'panel panel-roomy' }, [
    panelHeader(t('shop.title'), t(`shop.${tab}.subtitle`)),
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

// -- The floor ---------------------------------------------------------------

type ShelfSort = 'selling' | 'price';

let shelfSort: ShelfSort = 'selling';

/** A shelf with the number it is known by, which sorting must not change. */
interface NumberedShelf {
  slot: ShelfSlot;
  number: number;
}

/**
 * The shelves, as a grid of tiles rather than a column of cards.
 *
 * A card per shelf gave each one a board line, a name, two buttons, three
 * chips and a slider — about fifteen elements and a couple of inches of page.
 * That is a fine way to show four shelves and an unusable way to show fifty:
 * seven hundred nodes to lay out on every press, and a floor you could only
 * read by scrolling past it.
 *
 * A tile says what a shopkeeper glances at — what it is, what grade, what it is
 * asking, whether it is moving — and the rest is one tap away. Same shape as
 * every other grid in the game, and it fits a whole shop on a screen.
 */
function renderShelves(sim: Simulation): HTMLElement {
  const numbered: NumberedShelf[] = sim.world.shelf.map((slot, index) => ({
    slot,
    number: index + 1,
  }));
  const full = numbered.filter((entry) => entry.slot.item).length;

  const sorted = [...numbered].sort(comparators[shelfSort](sim));

  const section = el('section', { class: 'shelves' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('shop.shelves') }),
      el('span', {
        class: 'field-note',
        text: t('shop.shelves.count', { full, total: numbered.length }),
      }),
    ]),
  ]);

  // Only worth offering once there is enough to lose track of.
  if (numbered.length > 4) section.append(sortRow());

  section.append(
    slotGrid(
      sorted.map((entry) => shelfTile(sim, entry)),
      t('shop.shelves.none'),
    ),
  );
  return section;
}

/**
 * Two ways to read the floor.
 *
 * What needs attention, which is the question a hundred shelves actually
 * raise, and what is worth most. Shelf order was a third, and was dropped: it
 * is the order the list happens to be stored in, which answers nothing you
 * would come to this screen to ask. The number is still on every shelf, in its
 * details and its tooltip, for finding one you have in mind.
 *
 * Empty shelves sink to the bottom of both, because an empty shelf is not a
 * problem with a shelf.
 */
const comparators: Record<ShelfSort, (sim: Simulation) => (a: NumberedShelf, b: NumberedShelf) => number> = {
  selling: (sim) => (a, b) => {
    /*
     * An empty shelf sells nothing, which is not the same as selling slowly.
     *
     * Sorted ascending, so the sentinel has to be larger than any real chance
     * rather than smaller — as a negative it put every empty shelf at the head
     * of the list, which is the opposite of what this sort is for.
     */
    const rate = (entry: NumberedShelf) =>
      entry.slot.item
        ? saleChance(sim.world, entry.slot, sim.now, true)
        : Number.POSITIVE_INFINITY;
    return rate(a) - rate(b) || a.number - b.number;
  },
  price: (sim) => (a, b) => {
    const ask = (entry: NumberedShelf) =>
      entry.slot.item ? entry.slot.item.fairValue * entry.slot.priceRatio : -1;
    return ask(b) - ask(a) || a.number - b.number;
  },
};

function sortRow(): HTMLElement {
  const row = el('div', { class: 'sort-row' });
  for (const id of ['selling', 'price'] as ShelfSort[]) {
    const node = el('button', { class: 'sort-chip', type: 'button', text: t(`shop.sort.${id}`) });
    node.setAttribute('aria-pressed', String(shelfSort === id));
    node.addEventListener('click', () => {
      shelfSort = id;
      changed();
    });
    row.append(node);
  }
  return row;
}

function shelfTile(sim: Simulation, entry: NumberedShelf): HTMLElement {
  const { slot: shelfSlot, number } = entry;
  const board = getShelfTier(shelfSlot.quality);
  const item = shelfSlot.item;

  if (!item) {
    return slot({
      id: shelfSlot.id,
      icon: el('span', { class: 'slot-glyph', text: '🪵' }),
      label: t('shop.shelf.numbered', { number }),
      caption: t(`board.${shelfSlot.quality}`),
      dimmed: true,
      title: t('shop.slot.empty'),
      onActivate: () => openShelfDetails(sim, entry),
    });
  }

  const asking = Math.round(item.fairValue * shelfSlot.priceRatio);
  const chance = saleChance(sim.world, shelfSlot, sim.now, true);

  return slot({
    id: shelfSlot.id,
    icon: potionIcon(item.recipeId),
    label: t(`recipe.${item.recipeId}`),
    count: shelfSlot.quantity > 1 ? shelfSlot.quantity : undefined,
    caption: [gradeBadge(item.grade), goldText(asking)],
    // A shelf nobody is buying from is the one thing on this screen worth
    // colouring: it is the shelf you came here to do something about.
    tone: chance > 0.05 ? 'default' : 'warn',
    title: [
      t('shop.shelf.numbered', { number }),
      t(`board.${shelfSlot.quality}`),
      paceLabel(chance),
      board.appealBonus > 0
        ? t('shop.board.appealNote', { percent: Math.round(board.appealBonus * 100) })
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    onActivate: () => openShelfDetails(sim, entry),
  });
}

/**
 * The asking price, without rebuilding the shop under the thumb.
 *
 * This used to call `changed()` on every `input` event, which tore the panel
 * down and built it again — including the slider being dragged. The drag died
 * with the element, so the price moved one notch and stopped, every time. The
 * readouts it feeds are three short strings, so they are written where they
 * stand; the rebuild waits for the drag to end.
 */
function priceSlider(
  sim: Simulation,
  shelfSlot: ShelfSlot,
  readouts: { asking: HTMLElement; percent: HTMLElement; pace: HTMLElement },
): HTMLElement {
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

    const item = shelfSlot.item;
    if (!item) return;
    const chance = saleChance(sim.world, shelfSlot, sim.now, true);
    readouts.asking.textContent = formatGold(Math.round(item.fairValue * shelfSlot.priceRatio));
    readouts.percent.textContent = formatPercent(shelfSlot.priceRatio);
    readouts.pace.textContent = paceLabel(chance);
    readouts.pace.className = `chip ${chance > 0.15 ? 'plain' : 'warn'}`;
    slider.setAttribute('aria-label', t('shop.price', { percent: formatPercent(shelfSlot.priceRatio) }));
  });

  // Once the thumb is let go — the rest of the shop can catch up now that there
  // is nothing being held.
  slider.addEventListener('change', () => changed());

  return slider;
}

/**
 * One shelf, in full.
 *
 * Everything the card used to carry, on the one shelf being looked at instead
 * of on all fifty at once: what is standing on it, what board it is, what it is
 * asking, and the three things you can do about any of that.
 */
function openShelfDetails(sim: Simulation, entry: NumberedShelf): void {
  const { slot: shelfSlot, number } = entry;
  const board = getShelfTier(shelfSlot.quality);
  const art = artUrlIf('shelf', shelfSlot.quality);

  const boardLine = el('div', { class: 'board-row' }, [
    ...(art ? [el('img', { class: 'board-thumb', src: art, alt: '', width: '46', height: '12' })] : []),
    el('span', { class: 'field-note', text: t(`board.${shelfSlot.quality}`) }),
    /*
     * What the board does, in a sentence.
     *
     * "Appeal +8%" in green reads as a rosette the shelf has been awarded. The
     * number is the same; the sentence is about the goods standing on it, which
     * is the thing the player is actually deciding about.
     */
    ...(board.appealBonus > 0
      ? [
          el('span', {
            class: 'field-note',
            text: t('shop.board.appealNote', { percent: Math.round(board.appealBonus * 100) }),
          }),
        ]
      : []),
  ]);

  const item = shelfSlot.item;

  if (!item) {
    modal({
      content: (dismiss) => [
        el('h2', { text: t('shop.shelf.numbered', { number }) }),
        boardLine,
        el('p', { class: 'grid-empty', text: t('shop.slot.empty') }),
        el('div', { class: 'dialog-actions' }, [
          button(t('common.close'), dismiss, { variant: 'quiet' }),
          button(t('shop.slot.stockThis'), () => {
            dismiss();
            openStackPicker(sim, shelfSlot);
          }),
        ]),
      ],
    });
    return;
  }

  modal({
    content: (dismiss) => {
      const chance = saleChance(sim.world, shelfSlot, sim.now, true);
      const asking = el('span', {
        class: 'price-gold num',
        text: formatGold(Math.round(item.fairValue * shelfSlot.priceRatio)),
      });
      const percent = chip(formatPercent(shelfSlot.priceRatio));
      const pace = chip(paceLabel(chance), chance > 0.15 ? 'plain' : 'warn');

      return [
        el('h2', { text: t('shop.shelf.numbered', { number }) }),
        boardLine,
        el('div', { class: 'shelf-head' }, [
          gradeBadge(item.grade),
          el('span', { class: 'shelf-name', text: t(`recipe.${item.recipeId}`) }),
          chip(t(`form.${item.formId}`)),
          // A stacked slot has to say so, or it looks like one bottle that will
          // not sell out.
          ...(shelfSlot.quantity > 1
            ? [chip(t('shop.stacked', { count: shelfSlot.quantity }), 'good')]
            : []),
        ]),
        el('div', { class: 'shelf-price' }, [asking, percent, pace]),
        priceSlider(sim, shelfSlot, { asking, percent, pace }),
        el('div', { class: 'dialog-actions' }, [
          button(t('common.close'), dismiss, { variant: 'quiet' }),
          button(
            t('shop.slot.remove'),
            () => {
              dismiss();
              sim.unstock(shelfSlot.id);
              changed();
            },
            { variant: 'quiet' },
          ),
          button(
            t('shop.shelf.move'),
            () => {
              dismiss();
              openMovePicker(sim, entry);
            },
            { disabled: sim.world.shelf.length < 2 },
          ),
        ]),
      ];
    },
  });
}

/** Where should this go? Pick a shelf; a full one swaps with this one. */
function openMovePicker(sim: Simulation, from: NumberedShelf): void {
  const others = sim.world.shelf
    .map((slot, index) => ({ slot, number: index + 1 }))
    .filter((entry) => entry.slot.id !== from.slot.id);

  modal({
    content: (dismiss) => [
      el('h2', { text: t('shop.shelf.moveTitle') }),
      el('p', { text: t('shop.shelf.moveHint') }),
      el(
        'div',
        { class: 'shelf-picker' },
        others.map((target) =>
          button(
            target.slot.item
              ? t('shop.shelf.swapWith', {
                  shelf: t('shop.shelf.numbered', { number: target.number }),
                  recipe: t(`recipe.${target.slot.item.recipeId}`),
                })
              : t('shop.shelf.moveTo', {
                  shelf: t('shop.shelf.numbered', { number: target.number }),
                }),
            () => {
              dismiss();
              if (sim.moveStock(from.slot.id, target.slot.id)) changed();
            },
            { variant: 'quiet' },
          ),
        ),
      ),
      el('div', { class: 'dialog-actions' }, [
        button(t('common.close'), dismiss, { variant: 'quiet' }),
      ]),
    ],
  });
}

/** Fill this one shelf, from whatever is in the store room. */
function openStackPicker(sim: Simulation, shelfSlot: ShelfSlot): void {
  const stacks = stacksOf(sim.world.bottled);

  modal({
    content: (dismiss) => [
      el('h2', { text: t('shop.slot.stockThis') }),
      stacks.length === 0
        ? el('p', { class: 'grid-empty', text: t('shop.inventory.empty') })
        : slotGrid(
            stacks.map(({ item, count }) =>
              slot({
                id: item.uid,
                icon: potionIcon(item.recipeId),
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

// -- The store room ----------------------------------------------------------

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

function renderInventory(sim: Simulation): HTMLElement {
  const tiles = stacksOf(sim.world.bottled).map(({ item, count }) => {
    // The stack already counted them; see `placeableCount`.
    const room = sim.placeable(item, count);

    return slot({
      id: item.uid,
      icon: itemIcon(item),
      label: t(`recipe.${item.recipeId}`),
      count,
      caption: [gradeBadge(item.grade), goldText(item.fairValue)],
      dimmed: room === 0,
      title:
        `${t(`recipe.${item.recipeId}`)} · ${t(`form.${item.formId}`)}\n` +
        `${t(`vessel.${item.vesselId}`)} · ${t(`seal.${item.sealId}`)}`,
      /*
       * How many, in one press.
       *
       * Putting eight bottles out was eight presses, each of which began by
       * finding a free shelf. The count is the only part of that worth
       * deciding, so it is the only part asked for — the shelves fill in
       * order, and the ceiling is however many the shop has room for.
       */
      onActivate: () =>
        showPotionInfo(sim, item, count, {
          label: t('shop.slot.putOut'),
          max: Math.max(1, room),
          blocked: room === 0 ? t('shop.noShelf') : undefined,
          run: (quantity) => {
            const placed = sim.stockMany(item.uid, quantity);
            if (placed === 0) {
              toast(t('shop.noShelf'));
              return;
            }
            toast(
              t('shop.putOut', {
                count: placed,
                recipe: t(`recipe.${item.recipeId}`),
              }),
            );
            changed();
          },
        }),
    });
  });

  return el('section', { class: 'inventory' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('shop.inventory') }),
      el('span', { class: 'field-note', text: t('shop.inventory.hint') }),
    ]),
    slotGrid(tiles, t('shop.inventory.empty')),
  ]);
}

/**
 * Boards you own but have not fitted.
 *
 * A board used to be offered on each shelf that could take it, which put the
 * same board in front of you four times and never once said how many you had.
 * It belongs here with the bottles: both are things in the store room waiting
 * to go out, and both are put out by picking the thing and then the shelf.
 */
function renderBoards(sim: Simulation): HTMLElement {
  const owned = shelfTiers.filter((tier) => (sim.world.boards[tier.id] ?? 0) > 0);

  const tiles = owned.map((tier) => {
    const art = artUrlIf('shelf', tier.id);
    const fits = sim.world.shelf
      .map((shelfSlot, index) => ({ slot: shelfSlot, number: index + 1 }))
      .filter((entry) => getShelfTier(entry.slot.quality).appealBonus < tier.appealBonus);

    return slot({
      id: tier.id,
      icon: art
        ? el('img', { class: 'art-icon', src: art, alt: '', width: '34', height: '12' })
        : el('span', { class: 'slot-glyph', text: '🪵' }),
      label: t(`board.${tier.id}`),
      count: sim.world.boards[tier.id] ?? 0,
      caption:
        tier.appealBonus > 0
          ? t('shop.board.appealNote', { percent: Math.round(tier.appealBonus * 100) })
          : t('shop.board.plain'),
      dimmed: fits.length === 0,
      onActivate: () => openBoardPicker(sim, tier.id, fits),
    });
  });

  return el('section', { class: 'boards' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('shop.boards') }),
      el('span', { class: 'field-note', text: t('shop.boards.hint') }),
    ]),
    slotGrid(tiles, t('shop.boards.empty')),
  ]);
}

/** Which shelf should this board go on? */
function openBoardPicker(sim: Simulation, tierId: string, fits: NumberedShelf[]): void {
  modal({
    content: (dismiss) => [
      el('h2', { text: t('shop.board.fitTo', { board: t(`board.${tierId}`) }) }),
      fits.length === 0
        ? el('p', { class: 'grid-empty', text: t('shop.board.noShelf') })
        : el(
            'div',
            { class: 'shelf-picker' },
            fits.map(({ slot: shelfSlot, number }) =>
              button(
                t('shop.board.onShelf', {
                  shelf: t('shop.shelf.numbered', { number }),
                  board: t(`board.${shelfSlot.quality}`),
                }),
                () => {
                  dismiss();
                  if (sim.fitShelfBoard(shelfSlot.id, tierId)) {
                    toast(t('shop.board.fitted', { board: t(`board.${tierId}`) }));
                    changed();
                  }
                },
                { variant: 'quiet' },
              ),
            ),
          ),
      el('div', { class: 'dialog-actions' }, [
        button(t('common.close'), dismiss, { variant: 'quiet' }),
      ]),
    ],
  });
}
