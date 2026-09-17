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

/**
 * A stocked shelf being dragged to another one.
 *
 * The payload is the shelf's id, not the bottle's: what is being moved is the
 * whole slot — its goods, however many of them, and the price you set — and the
 * shelf it lands on is the other half of a swap.
 */
const SHELF_DRAG = 'application/x-eternal-shelf';

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

  return el('div', { class: 'panel' }, [
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

/** What a shelf is called when it has to be named — "Shelf 3". */
function shelfName(sim: Simulation, shelfSlot: ShelfSlot): string {
  const index = sim.world.shelf.indexOf(shelfSlot);
  return t('shop.shelf.numbered', { number: index + 1 });
}

// -- The floor ---------------------------------------------------------------

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
 * The board this shelf is made of, said rather than badged.
 *
 * Fitting is done from the store room now — which of your shelves gets the good
 * wood is a decision about the board you own, not about the shelf you happen to
 * be looking at — so this row only reports.
 */
function boardRow(shelfSlot: ShelfSlot): HTMLElement {
  const current = getShelfTier(shelfSlot.quality);
  const art = artUrlIf('shelf', shelfSlot.quality);

  return el('div', { class: 'board-row' }, [
    ...(art ? [el('img', { class: 'board-thumb', src: art, alt: '', width: '46', height: '12' })] : []),
    el('span', { class: 'field-note', text: t(`board.${shelfSlot.quality}`) }),
    /*
     * What the board does, in a sentence.
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
  ]);
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
function priceSlider(sim: Simulation, shelfSlot: ShelfSlot, readouts: {
  asking: HTMLElement;
  percent: HTMLElement;
  pace: HTMLElement;
}): HTMLElement {
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

  // Once the thumb is let go — the rest of the shop (the ledger's takings, the
  // scene) can catch up now that there is nothing being held.
  slider.addEventListener('change', () => changed());

  return slider;
}

function renderSlot(sim: Simulation, shelfSlot: ShelfSlot): HTMLElement {
  const node = el('div', { class: 'shelf' });

  /*
   * Every shelf takes a dragged shelf, empty or not.
   *
   * Dropping onto a full one swaps the two, which is what "organise them
   * visually" means in practice — the good bottles at eye level and the cheap
   * ones at the back is a rearrangement, not an unstock and a restock.
   */
  makeDropTarget(node, SHELF_DRAG, (fromId) => {
    if (sim.moveStock(fromId, shelfSlot.id)) changed();
  });

  if (!shelfSlot.item) {
    node.classList.add('shelf-empty');
    node.append(
      boardRow(shelfSlot),
      el('span', { class: 'shelf-empty-label', text: t('shop.slot.empty') }),
      el('span', { class: 'field-note', text: t('shop.slot.emptyHint') }),
    );
    return node;
  }

  const item = shelfSlot.item;
  const chance = saleChance(sim.world, shelfSlot, sim.now, true);

  const asking = el('span', {
    class: 'price-gold num',
    text: formatGold(Math.round(item.fairValue * shelfSlot.priceRatio)),
  });
  const percent = chip(formatPercent(shelfSlot.priceRatio));
  const pace = chip(paceLabel(chance), chance > 0.15 ? 'plain' : 'warn');

  /*
   * A grip rather than the whole card.
   *
   * The card holds a range input, and a draggable ancestor and a slider inside
   * it fight over the same gesture. The grip is also the only honest place to
   * hang the affordance: it says this row can be picked up, where a whole
   * draggable card says nothing at all until you try.
   */
  const grip = el('span', {
    class: 'shelf-grip',
    text: '⠿',
    title: t('shop.shelf.dragHint'),
    'aria-hidden': 'true',
  });
  grip.draggable = true;
  grip.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData(SHELF_DRAG, shelfSlot.id);
    // A plain-text fallback keeps the drag valid in browsers that ignore custom
    // types until drop, which is most of them during dragover.
    event.dataTransfer?.setData('text/plain', shelfSlot.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    node.dataset.dragging = 'true';
  });
  grip.addEventListener('dragend', () => delete node.dataset.dragging);

  node.append(
    boardRow(shelfSlot),
    el('div', { class: 'shelf-head' }, [
      grip,
      gradeBadge(item.grade),
      el('span', { class: 'shelf-name', text: t(`recipe.${item.recipeId}`) }),
      chip(t(`form.${item.formId}`)),
      // The tap route to the same rearrangement. Drag does not exist on a
      // phone, and this screen is used on one.
      button(t('shop.shelf.move'), () => openMovePicker(sim, shelfSlot), {
        variant: 'quiet',
        small: true,
        disabled: sim.world.shelf.length < 2,
      }),
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
      asking,
      percent,
      pace,
      // A stacked slot has to say so, or it looks like one bottle that will not sell out.
      ...(shelfSlot.quantity > 1
        ? [chip(t('shop.stacked', { count: shelfSlot.quantity }), 'good')]
        : []),
    ]),
    priceSlider(sim, shelfSlot, { asking, percent, pace }),
  );

  return node;
}

/** Where should this go? The same swap a drag does, for a thumb. */
function openMovePicker(sim: Simulation, from: ShelfSlot): void {
  const others = sim.world.shelf.filter((entry) => entry.id !== from.id);

  modal({
    content: (dismiss) => [
      el('h2', { text: t('shop.shelf.moveTitle') }),
      el('p', { text: t('shop.shelf.moveHint') }),
      el(
        'div',
        { class: 'shelf-picker' },
        others.map((target) =>
          button(
            target.item
              ? t('shop.shelf.swapWith', {
                  shelf: shelfName(sim, target),
                  recipe: t(`recipe.${target.item.recipeId}`),
                })
              : t('shop.shelf.moveTo', { shelf: shelfName(sim, target) }),
            () => {
              dismiss();
              if (sim.moveStock(from.id, target.id)) changed();
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
    const room = sim.placeable(item);

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
    const fits = sim.world.shelf.filter(
      (shelfSlot) => getShelfTier(shelfSlot.quality).appealBonus < tier.appealBonus,
    );

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
function openBoardPicker(sim: Simulation, tierId: string, fits: ShelfSlot[]): void {
  modal({
    content: (dismiss) => [
      el('h2', { text: t('shop.board.fitTo', { board: t(`board.${tierId}`) }) }),
      fits.length === 0
        ? el('p', { class: 'grid-empty', text: t('shop.board.noShelf') })
        : el(
            'div',
            { class: 'shelf-picker' },
            fits.map((shelfSlot) =>
              button(
                t('shop.board.onShelf', {
                  shelf: shelfName(sim, shelfSlot),
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
