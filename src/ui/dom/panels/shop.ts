/**
 * Shop: the floor, and the store room behind it.
 *
 * Two views rather than one long page. Putting stock out and arranging the
 * floor are different jobs done at different times — one is "I have brewed
 * twelve things, get them on sale", the other is "which shelf should the good
 * ones be on" — and stacking both into a single scroll meant every act of
 * either began with a hunt for the right section.
 *
 * The floor is shelves. The store is what you own and have not put out:
 * bottles, and the boards you could fit.
 *
 * Furnishings and the counter are both out of the build for now — customers are
 * moving to a scene of their own, and the furnishing picker belongs with the
 * painted shop it decorates. Neither is deleted; the sim keeps running both, so
 * a piece bought from a merchant is still owned when the picker comes back.
 */

import {
  button,
  chip,
  clear,
  el,
  goldText,
  gradeBadge,
  matchesSearch,
  modal,
  panelHeader,
  potionIcon,
  searchField,
  slot,
  slotGrid,
  tabPanel,
  tabStrip,
} from '../components';
import { formatGold, formatPercent, t } from '@/i18n';
import { saleChance, sameGoods } from '@/sim/market';
import { getShelfTier, shelfTiers } from '@/sim/config';
import { artUrlIf } from '@/ui/art';
import { showPotionInfo } from '../potionInfo';

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

type StackSort = 'value' | 'count';

/**
 * How many stacks one page of the store room holds.
 *
 * Chosen to land the grid at roughly the node count the floor settles at, so
 * the two halves of the screen cost about the same to draw.
 */
const STACK_PAGE = 60;

let stackSort: StackSort = 'value';

let stackPage = 1;

/** What the store room is narrowed to. Module state, like the tab and the page. */
let stackQuery = '';

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

  body.append(
    tabStrip({
      name: 'shop',
      current: tab,
      tabs: (['floor', 'store'] as Tab[]).map((id) => ({ id, label: t(`shop.tab.${id}`) })),
      onSelect: (id) => {
        tab = id as Tab;
        changed();
      },
    }),
  );

  body.append(
    tabPanel(
      'shop',
      tab,
      tab === 'floor' ? [renderShelves(sim)] : [renderInventory(sim), renderBoards(sim)],
    ),
  );

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

/** A shelf and the number it is known by, which sorting must not change. */
interface ShelfRef {
  slot: ShelfSlot;
  number: number;
}

/**
 * A shelf on the floor, with what the grid sorts and reads it by.
 *
 * `rate` and `ask` are worked out once per render and carried, rather than
 * recomputed inside the comparator. `saleChance` sweeps every equipment
 * definition twice — once itself and once through `footfallAt` — and a sort
 * asks its comparator a few hundred questions for a hundred shelves, each
 * costing two of those. The tile needs the same two numbers anyway, so
 * carrying them turns several hundred sweeps into one per shelf.
 */
interface NumberedShelf extends ShelfRef {
  /** How briskly it sells. Empty shelves sell nothing, which is not slowly. */
  rate: number;
  /** What it is asking, or -1 for an empty shelf. */
  ask: number;
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
    /*
     * Sorted ascending, so an empty shelf's sentinel has to be larger than any
     * real chance rather than smaller — as a negative it put every empty shelf
     * at the head of the list, which is the opposite of what the sort is for.
     */
    rate: slot.item ? saleChance(sim.world, slot, sim.now, true) : Number.POSITIVE_INFINITY,
    ask: slot.item ? slot.item.fairValue * slot.priceRatio : -1,
  }));
  const full = numbered.filter((entry) => entry.slot.item).length;

  const sorted = [...numbered].sort(comparators[shelfSort]);

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
const comparators: Record<ShelfSort, (a: NumberedShelf, b: NumberedShelf) => number> = {
  selling: (a, b) => a.rate - b.rate || a.number - b.number,
  price: (a, b) => b.ask - a.ask || a.number - b.number,
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
      // "Empty shelf" was the tooltip, which is the one thing this tile had to
      // say and the one place it could not be read.
      caption: [
        el('span', { text: t('shop.slot.empty') }),
        el('span', { class: 'field-note', text: t(`board.${shelfSlot.quality}`) }),
      ],
      dimmed: true,
      onActivate: () => openShelfDetails(sim, entry),
    });
  }

  const asking = Math.round(entry.ask);
  const chance = entry.rate;

  return slot({
    id: shelfSlot.id,
    icon: potionIcon(item.recipeId),
    label: t(`recipe.${item.recipeId}`),
    count: shelfSlot.quantity > 1 ? shelfSlot.quantity : undefined,
    caption: [gradeBadge(item.grade), goldText(asking)],
    // A shelf nobody is buying from is the one thing on this screen worth
    // colouring: it is the shelf you came here to do something about.
    tone: chance > 0.05 ? 'default' : 'warn',
    // No tooltip: the shelf number, the board, the pace and the appeal are all
    // in the dialog this tile opens, and a tooltip is a thing a touchscreen
    // never shows. Saying it twice for a mouse is not worth saying it nowhere
    // for a finger.
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
          }, { variant: 'good' }),
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
        /*
         * Two answers, and they read as opposites.
         *
         * The slider applies as it moves, so the button that closes this is not
         * deciding anything — but "Close" left no sign that the new price had
         * taken, which is the one thing a player wants told. "Confirm" in green
         * says it has. Taking the goods back down is the other direction and
         * wears the other colour.
         */
        el('div', { class: 'dialog-actions' }, [
          button(
            t('shop.slot.remove'),
            () => {
              dismiss();
              sim.unstock(shelfSlot.id);
              changed();
            },
            { variant: 'danger' },
          ),
          button(t('common.confirm'), dismiss, { variant: 'good' }),
        ]),
      ];
    },
  });
}

/**
 * Fill this one shelf, from whatever is in the store room.
 *
 * Paged, for the same reason the store room itself is: a finished Codex is
 * very nearly two hundred kinds of potion, and building all of them into a
 * dialog is the cost that grid was paged to avoid — inside a click handler,
 * where it is felt most. Ordered by the same chip the store room is set to, so
 * the page you are shown is the one you were just looking at.
 *
 * The grid is redrawn in place rather than the dialog reopened, so paging does
 * not blink the whole thing away and back.
 */
function openStackPicker(sim: Simulation, shelfSlot: ShelfSlot): void {
  const stacks = stacksOf(sim.world.bottled)
    .map(({ item, count }) => ({ item, count, room: 0 }))
    .sort(stackSorts[stackSort]);

  const pageCount = Math.max(1, Math.ceil(stacks.length / STACK_PAGE));
  let page = 1;

  modal({
    content: (dismiss) => {
      const body = el('div');

      const draw = (): void => {
        clear(body);
        const shown = stacks.slice((page - 1) * STACK_PAGE, page * STACK_PAGE);
        body.append(
          slotGrid(
            shown.map(({ item, count }) =>
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
            t('shop.inventory.empty'),
          ),
        );

        if (pageCount > 1) {
          body.append(
            el('div', { class: 'pager' }, [
              button(
                t('shop.inventory.prev'),
                () => {
                  page = Math.max(1, page - 1);
                  draw();
                },
                { variant: 'quiet', small: true, disabled: page <= 1 },
              ),
              el('span', {
                class: 'pager-label num',
                text: t('ledger.page.of', { page, count: pageCount }),
              }),
              button(
                t('shop.inventory.next'),
                () => {
                  page = Math.min(pageCount, page + 1);
                  draw();
                },
                { variant: 'quiet', small: true, disabled: page >= pageCount },
              ),
            ]),
          );
        }
      };

      draw();

      return [
        el('h2', { text: t('shop.slot.stockThis') }),
        body,
        el('div', { class: 'dialog-actions' }, [
          button(t('common.close'), dismiss, { variant: 'quiet' }),
        ]),
      ];
    },
  });
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

/** A stack, with the two numbers the grid sorts and reads it by. */
interface Stack {
  item: BottledItem;
  /** How many interchangeable bottles are in the store room. */
  count: number;
  /** How many of them could go out right now — see `placeableCount`. */
  room: number;
}

/**
 * Two ways to read the store room.
 *
 * What is worth putting out, and what there is most of — the same two
 * questions the floor raises, asked of the other side of the shop. The recipe
 * name breaks ties so the order is stable between renders rather than left to
 * whatever the sort happened to do with equal keys.
 *
 * Deliberately no "can it go out" term, unlike the floor's empty shelves. Room
 * is the free shelf count shared by every stack, so either all of them can go
 * out or none can — sinking the ones that cannot would never move anything.
 * The tiles still dim when the shop is full, which is the part that says so.
 */
const stackSorts: Record<StackSort, (a: Stack, b: Stack) => number> = {
  value: (a, b) =>
    b.item.fairValue - a.item.fairValue || a.item.recipeId.localeCompare(b.item.recipeId),
  count: (a, b) => b.count - a.count || a.item.recipeId.localeCompare(b.item.recipeId),
};

function stackSortRow(): HTMLElement {
  const row = el('div', { class: 'sort-row' });
  for (const id of ['value', 'count'] as StackSort[]) {
    const node = el('button', { class: 'sort-chip', type: 'button', text: t(`shop.stackSort.${id}`) });
    node.setAttribute('aria-pressed', String(stackSort === id));
    node.addEventListener('click', () => {
      stackSort = id;
      stackPage = 1;
      changed();
    });
    row.append(node);
  }
  return row;
}

/**
 * The store room, given the treatment the floor got.
 *
 * A count at the head, a way to order it, and only a screenful drawn at a
 * time. The tiles were already tiles — what made this the slowest thing left
 * in the game was simply how many of them there are: a finished Codex is very
 * nearly two hundred kinds of potion, and two hundred tiles is sixteen hundred
 * elements for the browser to lay out on every single press.
 *
 * Paged, not truncated. Sorting decides what reaches the first page, so the
 * page you land on is the one worth looking at, and the rest is two presses
 * away rather than gone.
 */
function renderInventory(sim: Simulation): HTMLElement {
  /*
   * Narrowed before it is sorted and paged, which is the whole point.
   *
   * The store room is drawn sixty stacks at a time, so a filter that hid tiles
   * already on screen would only ever search the page you were looking at —
   * useless for the question it exists to answer, which is "do I have any of
   * these anywhere". The shell puts the caret back afterwards; see
   * `captureFocus`.
   */
  const stacks: Stack[] = stacksOf(sim.world.bottled)
    .filter(({ item }) =>
      matchesSearch(
        stackQuery,
        t(`recipe.${item.recipeId}`),
        item.grade,
        t(`form.${item.formId}`),
        t(`vessel.${item.vesselId}`),
        t(`seal.${item.sealId}`),
      ),
    )
    .map(({ item, count }) => ({
      item,
      count,
      // The stack already counted them; see `placeableCount`.
      room: sim.placeable(item, count),
    }));
  stacks.sort(stackSorts[stackSort]);

  const bottles = stacks.reduce((total, stack) => total + stack.count, 0);
  const pageCount = Math.max(1, Math.ceil(stacks.length / STACK_PAGE));
  stackPage = Math.min(Math.max(1, stackPage), pageCount);
  const shown = stacks.slice((stackPage - 1) * STACK_PAGE, stackPage * STACK_PAGE);

  const section = el('section', { class: 'inventory' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('shop.inventory') }),
      el('span', {
        class: 'field-note',
        text: t('shop.inventory.count', { kinds: stacks.length, bottles }),
      }),
    ]),
  ]);

  section.append(
    searchField({
      name: 'shop-inventory',
      value: stackQuery,
      placeholder: t('shop.inventory.search'),
      onInput: (query) => {
        stackQuery = query;
        // A narrower list has fewer pages, and page four of one result is a
        // blank grid. Every keystroke lands you back at the top.
        stackPage = 1;
        changed();
      },
    }),
  );

  // Only worth offering once there is enough to lose track of.
  if (stacks.length > 4) section.append(stackSortRow());

  section.append(
    slotGrid(
      shown.map((stack) => stackTile(sim, stack)),
      stackQuery.trim() ? t('common.search.none') : t('shop.inventory.empty'),
    ),
  );

  if (pageCount > 1) {
    section.append(
      el('div', { class: 'pager' }, [
        button(
          t('shop.inventory.prev'),
          () => {
            stackPage = Math.max(1, stackPage - 1);
            changed();
          },
          { variant: 'quiet', small: true, disabled: stackPage <= 1 },
        ),
        el('span', {
          class: 'pager-label num',
          text: t('ledger.page.of', { page: stackPage, count: pageCount }),
        }),
        button(
          t('shop.inventory.next'),
          () => {
            stackPage = Math.min(pageCount, stackPage + 1);
            changed();
          },
          { variant: 'quiet', small: true, disabled: stackPage >= pageCount },
        ),
      ]),
    );
  }

  return section;
}

function stackTile(sim: Simulation, { item, count, room }: Stack): HTMLElement {
  return slot({
    id: item.uid,
    icon: itemIcon(item),
    label: t(`recipe.${item.recipeId}`),
    count,
    caption: [gradeBadge(item.grade), goldText(item.fairValue)],
    dimmed: room === 0,
    // Form, vessel and seal are three of the lines in the card this opens.
    /*
     * How many, in one press.
     *
     * Putting eight bottles out was eight presses, each of which began by
     * finding a free shelf. The count is the only part of that worth deciding,
     * so it is the only part asked for — the shelves fill in order, and the
     * ceiling is however many the shop has room for.
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
          toast(t('shop.putOut', { count: placed, recipe: t(`recipe.${item.recipeId}`) }));
          changed();
        },
      }),
  });
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
function openBoardPicker(sim: Simulation, tierId: string, fits: ShelfRef[]): void {
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
