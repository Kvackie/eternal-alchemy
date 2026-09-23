/**
 * The brewing station: one pot, full screen, three columns.
 *
 *   left   — what goes in
 *   middle — the pot itself, with what is in it actually in it
 *   right  — the recipe book, showing how close the blend is to each recipe
 *
 * The old design put all of this in a docked panel beside a painted bench, which
 * meant the two halves of one act — choosing an ingredient and watching what it
 * did to the blend — were a scroll apart. Brewing is the game's one deliberate
 * act; it gets the whole screen while you are doing it, and the bench
 * outside is just pots.
 *
 * The pot here is drawn in the DOM rather than by Phaser. It has to hold
 * ingredient icons *inside* it and sit between two scrolling columns, and laying
 * that out against a canvas the panel is floating over is a coordinate problem
 * with nothing to show for solving it.
 */

import {
  button,
  chip,
  clear,
  collapsible,
  el,
  emptyNote,
  emptyState,
  essenceChip,
  gradeBadge,
  ingredientIcon,
  makeDropTarget,
  matchesSearch,
  meter,
  modal,
  optionGroup,
  outcomeCard,
  pager,
  searchField,
  sectionHead,
  stat,
  tabStrip,
} from '../components';
import { countdown, formatDuration, formatGold, t } from '@/i18n';
import { config, getIngredient, getSeal } from '@/sim/config';
import { inventoryRows } from '@/sim/inventory';
import { availableForms, availableSeals, availableVessels } from '@/sim/bottling';
import { outcomeProblems } from '@/sim/brewing';
import { totalEssence } from '@/sim/essences';
import { fairValue } from '@/sim/market';
import { showIngredientInfo } from '../ingredientInfo';
import { ESSENCES } from '@/sim/types';
import type {
  Essence,
  EssenceVector,
  Freshness,
  IngredientCategory,
} from '@/sim/types';
import type { RecipeDef } from '@/sim/config';
import type { Simulation } from '@/sim/sim';
import { changed, toast } from '@/ui/bus';

export const INGREDIENT_DRAG = 'application/x-eternal-ingredient';

/**
 * A scrolling box that keeps its place when the panel is rebuilt.
 *
 * Every click here rebuilds the whole station, and without this each one threw
 * all three columns back to the top — so adding a second ingredient meant
 * scrolling the stores down again to find it. The shell restores by this key,
 * so a list that is not on screen this time simply has nothing to restore.
 */
function scroller(key: string, className: string, children: HTMLElement[]): HTMLElement {
  const node = el('div', { class: className }, children);
  node.dataset.keepScroll = key;
  return node;
}

const CATEGORIES: IngredientCategory[] = ['herb', 'fungus', 'mineral', 'exotic', 'reagent'];

/**
 * How many ingredient tiles one page of the stores holds.
 *
 * A finished larder is nearly four hundred kinds, and a tile carries a picture,
 * a name, a freshness and up to five essence readings — around fifteen elements
 * each. Drawn whole that is 5,800 of the station's 6,800 elements, rebuilt on
 * every press, which is where the hundred-odd milliseconds a redraw costs
 * actually goes. The recipe book, long suspected, is 992: its rows build their
 * bodies only when opened, and always did.
 *
 * Same figure the store room uses, for the same reason.
 */
const STORE_PAGE = 60;

/** Freshest first, which is also the order it decays in. */
const FRESHNESSES: Freshness[] = ['dewfresh', 'fresh', 'dried'];

/** An essence counts as present in the pot once it is worth a bar. */
const PRESENT = 0.5;

// -- state -------------------------------------------------------------------

let open = false;

let formId = 'potion';
let vesselId = 'clayVial';
let sealId = 'cork';

/** Filters, held here so they survive the panel being rebuilt. */
let ingredientCategories = new Set<IngredientCategory>();
let ingredientEssences = new Set<Essence>();
let ingredientFreshness = new Set<Freshness>();

/** What the stores are narrowed to, and which page of the result is showing. */
let storeQuery = '';
let storePage = 1;

/**
 * Whether the filter rows are showing.
 *
 * `null` until the player touches it, which resolves to open where there is
 * room and shut where there is not — three rows of chips is about a third of a
 * phone's brew half, spent on controls rather than on the ingredients they
 * filter.
 */
let filtersOpen: boolean | null = null;

function filtersShown(): boolean {
  return filtersOpen ?? !isSplit();
}
let recipeEssences = new Set<Essence>();

/** What the book is narrowed to. */
let recipeQuery = '';
/** The auto-filter: hide recipes the pot has already ruled out. */
let matchPot = true;
/** Whether the hinted, not-yet-made recipes are unfolded. */
let unknownOpen = false;

/**
 * Below this width the station cannot show three columns at once.
 *
 * Stacked, it was one scroll five screens long — stores, burners, method, pot,
 * book — so choosing a herb and seeing what it did to the blend were a screen
 * apart, which is the exact problem the station was built to solve.
 */
const SPLIT = '(max-width: 900px)';

type StationView = 'brew' | 'pot';

/** Which half a phone is showing. Brew is where the work is, so it is first. */
let stationView: StationView = 'brew';

let splitWatched = false;

function isSplit(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(SPLIT).matches;
}

/**
 * Crossing the width has to redraw, and nothing else makes it.
 *
 * The panel is rebuilt on world changes; a rotation is not one. Registered once
 * for the life of the module, because the panel that would own it is thrown
 * away on every press.
 */
function watchSplit(): void {
  if (splitWatched || typeof window === 'undefined') return;
  splitWatched = true;
  window.matchMedia(SPLIT).addEventListener('change', () => changed());
}

const pinned = new Set<string>();
const expanded = new Set<string>();
/** Sections folded shut. Shut is the exception, so this starts empty. */
const folded = new Set<string>();

export function isStationOpen(): boolean {
  return open;
}

export function openStation(sim: Simulation, cauldronId: string): void {
  sim.setActiveCauldron(cauldronId);
  open = true;
  changed();
}

export function closeStation(): void {
  open = false;
  changed();
}

// -- the station -------------------------------------------------------------

export function renderStation(sim: Simulation): HTMLElement {
  watchSplit();
  const split = isSplit();
  const blend = sim.blend();

  const children: HTMLElement[] = [
    el('div', { class: 'station-bar' }, [
      button(t('station.back'), () => closeStation(), { variant: 'quiet', small: true }),
      el('span', { class: 'station-title', text: t(`cauldronTier.${sim.cauldron.tierId}`) }),
      el('span', {
        class: 'station-capacity num',
        text: `${Math.round(blend ? totalEssence(blend) : 0)} / ${sim.cauldronCapacity}`,
      }),
    ]),
  ];

  /*
   * Two halves on a phone, and the work is the first of them.
   *
   * Brew holds everything a blend is built out of — what is in store and what
   * it would come out as — plus whatever recipes have been starred, so the
   * ratio you are aiming at is on screen while you pick. The pot and the whole book are the reference half: you go there to
   * choose what to make, and come back here to make it.
   */
  if (split) {
    children.push(viewSwitch());
    children.push(
      el(
        'div',
        { class: 'station-cols' },
        stationView === 'brew'
          ? [
              scroller('left', 'station-col station-left', [
                renderPinned(sim),
                renderStores(sim),
                renderVerdict(sim),
              ]),
            ]
          : [
              scroller('middle', 'station-col station-middle', [renderPot(sim)]),
              renderRight(sim),
            ],
      ),
    );
    // The columns above are the view this strip chose; name them as one.
    const cols = children[children.length - 1]!;
    cols.id = 'station-panel';
    cols.setAttribute('role', 'tabpanel');
    cols.setAttribute('aria-labelledby', `station-tab-${stationView}`);
  } else {
    children.push(
      el('div', { class: 'station-cols' }, [renderLeft(sim), renderMiddle(sim), renderRight(sim)]),
    );
  }

  const node = el('div', { class: 'station' }, children);
  node.dataset.view = split ? stationView : 'all';
  return node;
}

function viewSwitch(): HTMLElement {
  return tabStrip({
    name: 'station',
    className: 'station-views',
    current: stationView,
    tabs: (['brew', 'pot'] as StationView[]).map((id) => ({
      id,
      label: t(`station.view.${id}`),
    })),
    onSelect: (id) => {
      stationView = id as StationView;
      changed();
    },
  });
}

/**
 * The recipes you said you were working toward, kept beside the stores.
 *
 * The star already existed in the book and already floated a recipe to the top
 * of it — but on a phone the book is the other half of the screen, so a pin was
 * a promise the layout could not keep. Here it is what it sounds like: the
 * thing you are aiming at, next to the things you are aiming it with.
 */
function renderPinned(sim: Simulation): HTMLElement {
  const blend = sim.blend();
  const rows = sim
    .knownRecipes()
    .filter((recipe) => pinned.has(recipe.id))
    .map((recipe) => renderRecipe(recipe, blend));

  /*
   * Nothing pinned is one quiet line, not an empty box.
   *
   * A dashed `grid-empty` panel saying "star a recipe in the book" took a
   * quarter of a phone's brew half to tell the player to go and do something on
   * the other half — on the screen whose whole point is room for the
   * ingredients. The invitation is still there; it is just a sentence.
   */
  if (rows.length === 0) {
    return el('p', { class: 'field-note station-pinned-hint', text: t('station.pinnedHint') });
  }

  return el('section', { class: 'station-block station-pinned' }, [
    el('span', { class: 'field-label', text: t('station.pinnedHere') }),
    ...rows,
  ]);
}

// -- left: ingredients ------------------------------------------------------

const FRESHNESS_TONE: Record<Freshness, 'default' | 'warn' | 'good'> = {
  dewfresh: 'good',
  fresh: 'default',
  dried: 'warn',
};

function renderLeft(sim: Simulation): HTMLElement {
  return scroller('left', 'station-col station-left', [renderStores(sim)]);
}

/**
 * A filter chip that toggles one value in a set.
 *
 * Chips rather than a search box: the panel is rebuilt on every world change, so
 * a text field would lose focus mid-word. Every axis here is a short closed
 * list, which a row of toggles says better than typing would anyway.
 */
function filterChip<T>(label: string, set: Set<T>, value: T): HTMLElement {
  const active = set.has(value);
  const node = el('button', { class: 'sort-chip', type: 'button', text: label });
  node.setAttribute('aria-pressed', String(active));
  node.addEventListener('click', () => {
    if (active) set.delete(value);
    else set.add(value);
    changed();
  });
  return node;
}

function renderStores(sim: Simulation): HTMLElement {
  const full = sim.cauldron.contents.units.length >= sim.cauldronMaxIngredients;

  const rows = inventoryRows(sim.world, sim.now).filter((entry) => {
    const def = getIngredient(entry.ingredientId);
    if (
      !matchesSearch(
        storeQuery,
        t(`ingredient.${entry.ingredientId}`),
        t(`category.${def.category}`),
        t(`freshness.${entry.freshness}`),
      )
    ) {
      return false;
    }
    if (ingredientCategories.size > 0 && !ingredientCategories.has(def.category)) return false;
    /*
     * Freshness is an axis of its own, not a shade of the others.
     *
     * A dewfresh Sunleaf and a dried one are different ingredients as far as
     * the pot is concerned, and a store room late in a run holds both of most
     * things — so "show me only what is still dewfresh" is the question this
     * list could not be asked.
     */
    if (ingredientFreshness.size > 0 && !ingredientFreshness.has(entry.freshness)) return false;
    if (ingredientEssences.size === 0) return true;
    const strain = entry.strainId
      ? sim.world.strains.find((s) => s.id === entry.strainId)
      : undefined;
    const profile = strain?.essence ?? def.essence;
    return [...ingredientEssences].every((essence) => profile[essence] > 0);
  });

  const pageCount = Math.max(1, Math.ceil(rows.length / STORE_PAGE));
  storePage = Math.min(Math.max(1, storePage), pageCount);
  const onThisPage = rows.slice((storePage - 1) * STORE_PAGE, storePage * STORE_PAGE);
  const tiles = onThisPage.map((entry) => ingredientCard(sim, entry, full));

  /*
   * The filters fold away, because they are not what the screen is for.
   *
   * Three rows of chips — five categories, five essences, three freshnesses —
   * is about a third of a phone's brew half standing permanently between the
   * heading and the first ingredient. Shut, the row says how many are in force,
   * so a list narrowed by a filter you have forgotten is never a mystery.
   */
  const active = ingredientCategories.size + ingredientEssences.size + ingredientFreshness.size;
  const shown = filtersShown();

  const toggle = el('button', { class: 'sort-chip filter-toggle', type: 'button' }, [
    el('span', { class: 'collapsible-caret', text: '▾', 'aria-hidden': 'true' }),
    el('span', { text: t('station.filters') }),
    ...(active > 0 ? [el('span', { class: 'filter-count num', text: String(active) })] : []),
  ]);
  toggle.setAttribute('aria-expanded', String(shown));
  toggle.addEventListener('click', () => {
    filtersOpen = !shown;
    changed();
  });

  const clear = button(
    t('station.filters.clear'),
    () => {
      ingredientCategories.clear();
      ingredientEssences.clear();
      ingredientFreshness.clear();
      changed();
    },
    { variant: 'quiet', small: true },
  );

  const filters = el('div', { class: 'station-filters' });
  filters.dataset.open = String(shown);
  filters.append(el('div', { class: 'sort-row filter-bar' }, active > 0 ? [toggle, clear] : [toggle]));
  if (shown) {
    filters.append(
      el(
        'div',
        { class: 'sort-row' },
        CATEGORIES.map((category) =>
          filterChip(t(`category.${category}`), ingredientCategories, category),
        ),
      ),
      el(
        'div',
        { class: 'sort-row' },
        ESSENCES.map((essence) =>
          filterChip(t(`essence.${essence}.short`), ingredientEssences, essence),
        ),
      ),
      el(
        'div',
        { class: 'sort-row' },
        FRESHNESSES.map((freshness) =>
          filterChip(t(`freshness.${freshness}`), ingredientFreshness, freshness),
        ),
      ),
    );
  }

  const search = searchField({
    name: 'station-stores',
    value: storeQuery,
    placeholder: t('cauldron.stores.search'),
    onInput: (query) => {
      storeQuery = query;
      storePage = 1;
      changed();
    },
  });

  const empty = storeQuery.trim() ? t('common.search.none') : t('cauldron.stores.empty');

  const body = [
    search,
    filters,
    scroller('stores', 'station-scroll', [
      tiles.length > 0
        ? el('div', { class: 'ingredient-grid' }, tiles)
        : emptyNote(empty),
    ]),
  ];

  if (pageCount > 1) {
    body.push(
      pager({
        page: storePage,
        pageCount,
        onChange: (next) => {
          storePage = next;
          changed();
        },
      }),
    );
  }

  return collapsible({
    className: 'station-block',
    title: t('cauldron.inventory'),
    open: !folded.has('inventory'),
    onToggle: () => {
      if (folded.has('inventory')) folded.delete('inventory');
      else folded.add('inventory');
      changed();
    },
    body,
  });
}

/**
 * One ingredient, with its blend readable without opening anything.
 *
 * The generic tile put the count in a corner badge and everything else in a
 * `title` — which a touchscreen never shows — so choosing between two herbs
 * meant opening both. The essences run down the left edge in their own colours,
 * because what a player scans for is "which of these is the Aqua one", and that
 * is a colour and a shape rather than a word.
 */
function ingredientCard(
  sim: Simulation,
  entry: ReturnType<typeof inventoryRows>[number],
  full: boolean,
): HTMLElement {
  const def = getIngredient(entry.ingredientId);
  const strain = entry.strainId
    ? sim.world.strains.find((s) => s.id === entry.strainId)
    : undefined;
  const profile = strain?.essence ?? def.essence;

  let caption = t(`freshness.${entry.freshness}`);
  if (entry.harvestedAt !== null && entry.freshness !== 'dried') {
    const boundary =
      entry.freshness === 'dewfresh'
        ? config.freshness.dewfreshUntilMs
        : config.freshness.freshUntilMs;
    const left = entry.harvestedAt + boundary - sim.now;
    if (left > 0) caption = `${caption} · ${formatDuration(left)}`;
  }

  const name = strain
    ? t('greenhouse.strain', {
        crop: t(`ingredient.${entry.ingredientId}`),
        gen: strain.generation,
      })
    : t(`ingredient.${entry.ingredientId}`);

  const face = el('button', { class: 'ingredient-card', type: 'button' }, [
    el(
      'span',
      { class: 'ingredient-essences' },
      ESSENCES.filter((essence) => profile[essence] > 0).map((essence) =>
        el('span', { class: `ingredient-essence ${essence}` }, [
          el('span', { text: t(`essence.${essence}.short`) }),
          el('span', { class: 'num', text: String(Math.round(profile[essence])) }),
        ]),
      ),
    ),
    el('span', { class: 'ingredient-icon' }, [ingredientIcon(entry.ingredientId, 30)]),
    el('span', { class: 'ingredient-name', text: name }),
    el('span', { class: 'ingredient-freshness', text: caption }),
  ]);
  face.dataset.tone = FRESHNESS_TONE[entry.freshness];
  face.disabled = full;
  face.addEventListener('click', () => {
    if (sim.addToCauldron(entry.ingredientId, entry.freshness, entry.strainId)) changed();
    else toast(t('cauldron.pot.full'));
  });

  // Draggable, carrying the payload the pot's drop target expects.
  if (!full) {
    face.draggable = true;
    face.addEventListener('dragstart', (event) => {
      const payload = `${entry.ingredientId}:${entry.freshness}:${entry.strainId ?? ''}`;
      event.dataTransfer?.setData(INGREDIENT_DRAG, payload);
      event.dataTransfer?.setData('text/plain', payload);
    });
  }

  const info = el('button', {
    class: 'ingredient-details',
    type: 'button',
    text: 'i',
    title: t('common.details'),
    'aria-label': t('common.details'),
  });
  info.addEventListener('click', (event) => {
    event.stopPropagation();
    showIngredientInfo(sim, entry.ingredientId);
  });

  // Count top-left, details top-right, both over the card rather than inside
  // it — a button cannot contain a button, and the count must not be a target.
  return el('div', { class: 'ingredient-tile' }, [
    face,
    el('span', { class: 'ingredient-count num', text: String(entry.count) }),
    info,
  ]);
}

// -- middle: the pot ---------------------------------------------------------

function renderMiddle(sim: Simulation): HTMLElement {
  return scroller('middle', 'station-col station-middle', [renderPot(sim), renderVerdict(sim)]);
}

/**
 * What the pot is about to give you, whatever stage it is at.
 *
 * Pulled out of the middle column so the split view can keep it beside the
 * stores: the reading — grade and purity — is what you act on while you are
 * still adding things, and on a phone it used to live under the picture of the
 * cauldron, on the half of the screen you were not on.
 */
function renderVerdict(sim: Simulation): HTMLElement {
  if (sim.pendingBrew) return renderReadyCard(sim);
  if (sim.brewing) return renderBrewingTimer(sim);
  return renderOutcome(sim);
}

/**
 * The pot, with what is in it in it.
 *
 * Two layers that answer two different questions at a glance: the contents say
 * what is in it, and the surface says whether it is cooking. The surface is
 * deliberately quiet until the brew has actually been started — a pot you are
 * still filling is not doing anything yet.
 */
function renderPot(sim: Simulation): HTMLElement {
  const units = sim.cauldron.contents.units;
  const brewing = sim.brewing !== null;

  const stage = el('div', { class: 'pot-stage' });
  makeDropTarget(stage, INGREDIENT_DRAG, (payload) => {
    const [ingredientId, freshness, strainId] = payload.split(':');
    if (!ingredientId) return;
    if (sim.addToCauldron(ingredientId, freshness as Freshness | undefined, strainId || null)) {
      changed();
    }
  });

  const vessel = el('div', { class: 'pot-vessel' }, [
    el('div', { class: 'pot-rim' }),
    el(
      'div',
      { class: 'pot-contents' },
      units.map((unit, index) => {
        const node = el('button', { class: 'pot-unit', type: 'button' }, [
          ingredientIcon(unit.ingredientId, 26),
        ]);
        node.title = `${t(`ingredient.${unit.ingredientId}`)} — ${t('cauldron.action.remove')}`;
        node.addEventListener('click', () => {
          sim.removeFromCauldron(index);
          changed();
        });
        return node;
      }),
    ),
  ]);

  /*
   * Nothing written inside the pot.
   *
   * An empty pot said "The pot is empty" and the card directly beneath it said
   * "Nothing in the pot" — the same sentence twice, and the one in the bowl was
   * the redundant half. The card below carries it, with the hint that says what
   * to do about it.
   */

  // Only while it is genuinely cooking.
  if (brewing) vessel.append(el('div', { class: 'pot-brewing' }));

  stage.append(vessel);

  /*
   * A finished pot is a door, and the door is a real button.
   *
   * The pot is the thing a player looks at, so it is the thing they press when
   * it is done. It was the stage itself carrying `role="button"` and a keydown
   * handler — a hand-built button, which is only ever worth doing when a real
   * one is impossible. Here it is not: the pot holds a grid of ingredient
   * buttons while you are filling it, and a button may not contain a button,
   * but accepting a brew empties that grid. So the one moment this is pressable
   * is the one moment nothing is nested inside it, and a transparent button
   * laid over the bowl is both honest markup and a bigger target than the
   * bowl's own outline.
   */
  if (sim.pendingBrew) {
    stage.dataset.ready = 'true';
    const door = el('button', {
      class: 'pot-door',
      type: 'button',
      'aria-label': t('cauldron.bottle.open'),
      title: t('cauldron.bottle.open'),
    });
    door.addEventListener('click', () => openBottling(sim));
    stage.append(door);
  }

  const blend = sim.blend();
  const chips = blend
    ? ESSENCES.filter((essence) => blend[essence] >= PRESENT).map((essence) =>
        essenceChip(essence, blend[essence]),
      )
    : [];

  return el('section', { class: 'station-block station-pot' }, [
    stage,
    el('div', { class: 'chips pot-blend' }, chips),
  ]);
}

function renderOutcome(sim: Simulation): HTMLElement {
  const section = el('section', { class: 'station-block' });
  if (!sim.blend()) {
    section.append(emptyState(t('cauldron.empty'), t('cauldron.empty.hint')));
    return section;
  }

  const reject = button(
    t('cauldron.action.reject'),
    () => {
      sim.rejectBrew();
      toast(t('cauldron.rejected'));
      changed();
    },
    { variant: 'quiet' },
  );

  // A blend no recipe claims makes nothing. Say so, and leave pouring it back
  // as the only way on.
  const outcome = sim.assess();
  if (!outcome) {
    section.append(
      emptyState(t('cauldron.noMatch'), t('cauldron.noMatch.hint')),
      el('div', { class: 'row-actions center' }, [reject]),
    );
    return section;
  }

  section.append(
    outcomeCard({
      badge: gradeBadge(outcome.grade),
      name: t(`recipe.${outcome.recipeId}`),
      chips: [chip(t(`potency.${outcome.potencyTier}`))],
      body: [stat(t('cauldron.readout.purity'), `${Math.round(outcome.purity)} / 100`)],
    }),
  );

  const problems = outcomeProblems(outcome);
  if (problems.length > 0) {
    section.append(
      el(
        'ul',
        { class: 'problems' },
        problems.map((key) => el('li', { text: t(key) })),
      ),
    );
  }

  section.append(
    el('div', { class: 'row-actions center' }, [
      reject,
      button(t('cauldron.action.accept'), () => {
        if (sim.acceptBrew()) changed();
      }, { variant: 'gold' }),
    ]),
  );
  return section;
}

/**
 * A pot at work: what it is making, how long is left, and how far along it is.
 *
 * The clock and the bar move themselves — `data-countdown-at` and
 * `data-progress-from` are patched by the shell each frame. They used to move
 * because this whole screen was rebuilt sixty times a second for as long as
 * anything was brewing, which cost the page its scroll and most of its clicks.
 */
function renderBrewingTimer(sim: Simulation): HTMLElement {
  const brewing = sim.brewing!;
  const total = brewing.readyAt - brewing.startedAt;
  const done = sim.now - brewing.startedAt;

  const remaining = el('span', {
    text: countdown(brewing.readyAt, sim.now),
  });
  remaining.dataset.countdownAt = String(brewing.readyAt);

  const bar = meter(total > 0 ? done / total : 1);
  const fill = bar.querySelector<HTMLElement>('.meter-fill');
  if (fill && total > 0) {
    fill.dataset.progressFrom = String(brewing.startedAt);
    fill.dataset.progressTo = String(brewing.readyAt);
  }

  return el('section', { class: 'station-block' }, [
    outcomeCard({
      badge: gradeBadge(brewing.outcome.grade),
      name: t(`recipe.${brewing.outcome.recipeId}`),
      chips: [chip(t(`potency.${brewing.outcome.potencyTier}`))],
      body: [stat(t('cauldron.brewing.remaining'), remaining), bar],
    }),
  ]);
}

/**
 * Bottling, in a window of its own.
 *
 * It used to unfold inside the middle column, under the pot: three option
 * groups, a value line and two buttons appended to the column you were already
 * reading the outcome in — on a phone that is most of a screen of controls
 * arriving unannounced under a cauldron, and the thing it is asking about
 * scrolls off the top while you answer. A finished brew is a decision of its
 * own, so it gets a window, and the column keeps a card that opens it.
 */
function bottlingBody(sim: Simulation, dismiss: () => void, redraw: () => void): HTMLElement {
  const brew = sim.pendingBrew!;
  const section = el('section', { class: 'station-block' });

  const forms = availableForms(brew);
  const vessels = availableVessels(sim.world, brew);
  const seals = availableSeals(sim.world);

  if (!forms.find((f) => f.formId === formId)?.available) {
    formId = forms.find((f) => f.available)?.formId ?? formId;
  }
  if (!vessels.find((v) => v.vesselId === vesselId)?.available) {
    vesselId = vessels.find((v) => v.available)?.vesselId ?? vesselId;
  }
  if (!seals.find((s) => s.sealId === sealId)?.available) {
    sealId = seals.find((s) => s.available)?.sealId ?? sealId;
  }

  section.append(
    outcomeCard({
      badge: gradeBadge(brew.grade),
      name: t(`recipe.${brew.recipeId}`),
      chips: [chip(t(`potency.${brew.potencyTier}`))],
      body: [stat(t('cauldron.readout.purity'), `${Math.round(brew.purity)} / 100`)],
    }),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: t('workbench.form') }),
      optionGroup(
        forms.map((form) => ({
          label: t(`form.${form.formId}`),
          detail: form.available ? undefined : t(form.reasonKey ?? 'workbench.reason.potency'),
          selected: form.formId === formId,
          disabled: !form.available,
          onSelect: () => {
            formId = form.formId;
            redraw();
          },
        })),
      ),
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: t('workbench.vessel') }),
      optionGroup(
        vessels.map((vessel) => ({
          label: t(`vessel.${vessel.vesselId}`),
          detail: vessel.available
            ? t('workbench.stock', { count: vessel.inStock })
            : t(vessel.reasonKey ?? 'workbench.reason.stock'),
          selected: vessel.vesselId === vesselId,
          disabled: !vessel.available,
          onSelect: () => {
            vesselId = vessel.vesselId;
            redraw();
          },
        })),
      ),
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: t('workbench.seal') }),
      optionGroup(
        seals.map((seal) => ({
          label: t(`seal.${seal.sealId}`),
          detail:
            getSeal(seal.sealId).cost === 0
              ? t('workbench.stock.unlimited')
              : t('workbench.stock', { count: seal.inStock }),
          selected: seal.sealId === sealId,
          disabled: !seal.available,
          onSelect: () => {
            sealId = seal.sealId;
            redraw();
          },
        })),
      ),
    ]),
    stat(
      t('workbench.value.label'),
      formatGold(
        fairValue({
          recipeId: brew.recipeId,
          formId,
          vesselId,
          sealId,
          grade: brew.grade,
          potencyTier: brew.potencyTier,
        }),
      ),
    ),
    el('div', { class: 'row-actions center' }, [
      button(
        t('workbench.action.discard'),
        () => {
          dismiss();
          sim.discardPending();
          changed();
        },
        { variant: 'danger' },
      ),
      button(
        t('workbench.action.bottle'),
        () => {
          const item = sim.bottlePending({ formId, vesselId, sealId });
          if (item) {
            dismiss();
            toast(t('toast.bottled', { recipe: t(`recipe.${item.recipeId}`), grade: item.grade }));
            changed();
          }
        },
        { variant: 'gold' },
      ),
    ]),
  );

  return section;
}

/**
 * Open it, wherever the finished pot was pressed.
 *
 * Exported because the bench opens it too: a card that says Ready is a pot
 * asking to be bottled, and making the player open the station to find that
 * out puts a screen between the question and the answer.
 */
export function openBottling(sim: Simulation): void {
  if (!sim.pendingBrew) return;

  /*
   * The dialog redraws itself, rather than riding the panel's render.
   *
   * A modal is mounted on the stage precisely so a rebuild of `#panels` cannot
   * tear it out — which also means `changed()` does not redraw it. Picking a
   * vessel has to change what the vessel row looks like, so the body is rebuilt
   * in place, the way the shop's stack picker pages in place.
   */
  modal({
    className: 'bottling-dialog',
    content: (dismiss) => {
      const brew = sim.pendingBrew!;
      const body = el('div', { class: 'bottling-body' });
      const redraw = () => {
        clear(body);
        body.append(bottlingBody(sim, dismiss, redraw));
      };
      redraw();
      return [
        el('h2', { text: t('cauldron.ready.title', { recipe: t(`recipe.${brew.recipeId}`) }) }),
        body,
      ];
    },
  });
}

/** The card the middle column keeps while a pot is waiting to be bottled. */
function renderReadyCard(sim: Simulation): HTMLElement {
  const brew = sim.pendingBrew!;
  return el('section', { class: 'station-block' }, [
    outcomeCard({
      badge: gradeBadge(brew.grade),
      name: t(`recipe.${brew.recipeId}`),
      chips: [chip(t(`potency.${brew.potencyTier}`), 'good')],
      body: [
        stat(t('cauldron.readout.purity'), `${Math.round(brew.purity)} / 100`),
        el('div', { class: 'row-actions center' }, [
          button(t('cauldron.bottle.open'), () => openBottling(sim), { variant: 'gold' }),
        ]),
      ],
    }),
  ]);
}

// -- right: the recipe book --------------------------------------------------

/**
 * How full each of a recipe's essence bars is, by RATIO rather than by amount.
 *
 * Recipes are ratios, so "18 of 24" is a number the game does not actually care
 * about. What matters is whether the parts are in proportion: a 3 : 1 recipe is
 * satisfied by 3 and 1 exactly as well as by 30 and 10.
 *
 * So each essence is scored by how much of it there is *per unit the recipe
 * asks for*, and the bars are drawn against the largest of those scores. Every
 * bar full means the blend is on the ratio; a short bar is the essence you are
 * missing, and its length says how much of it is missing.
 */
function ratioFill(target: EssenceVector, blend: EssenceVector | null): Map<Essence, number> {
  const needed = ESSENCES.filter((essence) => target[essence] > 0);
  const fills = new Map<Essence, number>();
  if (!blend) {
    for (const essence of needed) fills.set(essence, 0);
    return fills;
  }

  const scores = needed.map((essence) => blend[essence] / target[essence]);
  const best = Math.max(...scores, 0);
  needed.forEach((essence, index) => {
    fills.set(essence, best > 0 ? Math.min(1, (scores[index] ?? 0) / best) : 0);
  });
  return fills;
}

/** Essences actually in the pot, which is what the auto-filter judges against. */
function essencesInPot(blend: EssenceVector | null): Essence[] {
  if (!blend) return [];
  return ESSENCES.filter((essence) => blend[essence] >= PRESENT);
}

function renderRight(sim: Simulation): HTMLElement {
  const blend = sim.blend();
  const inPot = essencesInPot(blend);

  /*
   * The book shortens itself as the pot fills.
   *
   * Once there is Ignis in the pot, no recipe without Ignis is reachable without
   * pouring it away — so listing them is listing things you cannot make. Each
   * essence added narrows the book further, which turns a list of everything
   * into the shortlist you are actually choosing between.
   *
   * Pinned recipes ignore all of it: pinning one says you are working toward it,
   * and a book that hides your goal the moment you add a wrong ingredient would
   * be hiding exactly what you need to see.
   */
  const recipes = sim.knownRecipes().filter((recipe) => {
    // A typed query is the player naming what they want, and outranks every
    // other narrowing — including a pin, which is the opposite instruction.
    if (recipeQuery.trim()) return matchesSearch(recipeQuery, t(`recipe.${recipe.id}`));
    if (pinned.has(recipe.id)) return true;
    if (recipeEssences.size > 0) {
      if (![...recipeEssences].every((essence) => recipe.target[essence] > 0)) return false;
    }
    if (!matchPot) return true;
    return inPot.every((essence) => recipe.target[essence] > 0);
  });

  recipes.sort((a, b) => {
    const pin = Number(pinned.has(b.id)) - Number(pinned.has(a.id));
    return pin || t(`recipe.${a.id}`).localeCompare(t(`recipe.${b.id}`));
  });

  const rows = recipes.map((recipe) => renderRecipe(recipe, blend));

  return scroller('right', 'station-col station-right', [
    el('section', { class: 'station-block' }, [
      sectionHead(t('cauldron.recipes'), t('station.showing', { count: recipes.length })),
      el('div', { class: 'sort-row' }, [
        (() => {
          const node = el('button', { class: 'sort-chip', type: 'button', text: t('station.matchPot') });
          node.setAttribute('aria-pressed', String(matchPot));
          node.addEventListener('click', () => {
            matchPot = !matchPot;
            changed();
          });
          return node;
        })(),
        ...ESSENCES.map((essence) =>
          filterChip(t(`essence.${essence}.short`), recipeEssences, essence),
        ),
      ]),
      searchField({
        name: 'station-recipes',
        value: recipeQuery,
        placeholder: t('station.search'),
        onInput: (query) => {
          recipeQuery = query;
          changed();
        },
      }),
      scroller(
        'recipes',
        'station-scroll',
        rows.length > 0
          ? rows
          : [emptyNote(recipeQuery.trim() ? t('common.search.none') : t('station.noRecipes'))],
      ),
      renderUnknown(sim),
    ]),
  ]);
}

/**
 * The recipes not made yet, as hints and nothing more.
 *
 * No name, no ratio and no bars: the hint is the whole of what the book will
 * say until the potion has come out of a pot. Filters and search leave this
 * list alone — narrowing it by essence would give away which essences each
 * recipe takes, which is the answer.
 */
function renderUnknown(sim: Simulation): HTMLElement {
  const unknown = sim.unknownRecipes();
  if (unknown.length === 0) return el('div');
  return collapsible({
    className: 'recipe-unknown-list',
    title: t('station.unknown'),
    note: t('station.unknown.count', { count: unknown.length }),
    open: unknownOpen,
    onToggle: () => {
      unknownOpen = !unknownOpen;
      changed();
    },
    body: unknown.map((recipe) =>
      el('div', { class: 'recipe recipe-unknown' }, [
        el('span', { class: 'recipe-name', text: t('station.unknown.name') }),
        el('span', { class: 'field-note', text: t(`recipe.${recipe.id}.hint`) }),
      ]),
    ),
  });
}

function renderRecipe(recipe: RecipeDef, blend: EssenceVector | null): HTMLElement {
  const isPinned = pinned.has(recipe.id);
  const isOpen = expanded.has(recipe.id) || isPinned;
  const fills = ratioFill(recipe.target, blend);

  const pin = el('button', {
    class: 'recipe-pin',
    type: 'button',
    text: isPinned ? '★' : '☆',
    title: isPinned ? t('station.unpin') : t('station.pin'),
    'aria-label': isPinned ? t('station.unpin') : t('station.pin'),
  });
  pin.setAttribute('aria-pressed', String(isPinned));
  pin.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isPinned) pinned.delete(recipe.id);
    else pinned.add(recipe.id);
    changed();
  });

  const head = el('div', { class: 'recipe-head', role: 'button', tabindex: '0' }, [
    el('span', { class: 'collapsible-caret', text: isOpen ? '▾' : '▸', 'aria-hidden': 'true' }),
    el('span', { class: 'recipe-name', text: t(`recipe.${recipe.id}`) }),
    pin,
  ]);
  head.setAttribute('aria-expanded', String(isOpen));
  const toggle = () => {
    if (expanded.has(recipe.id)) expanded.delete(recipe.id);
    else expanded.add(recipe.id);
    changed();
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  });

  const row = el('div', { class: 'recipe' }, [head]);
  if (isPinned) row.dataset.pinned = 'true';
  if (!isOpen) return row;

  /*
   * Only the essences the recipe asks for.
   *
   * A row of five bars where three are permanently empty says nothing about the
   * recipe and makes two recipes look alike. What a reader wants is the shape of
   * this one: which parts, in what proportion.
   */
  /*
   * The share each essence takes of the recipe, as a percentage.
   *
   * The raw target numbers were unreadable at a glance: a 1 : 1 recipe printed
   * "1" beside "1", which says nothing until you have found the other row and
   * done the division yourself — and a 2 : 2 recipe looked different from a
   * 1 : 1 that behaves identically. A share is the same statement already
   * divided, so half and half reads as 50% and 50% whatever the raw figures.
   */
  const targetTotal = ESSENCES.reduce((sum, essence) => sum + recipe.target[essence], 0);

  const bars = [...fills.entries()].map(([essence, fill]) =>
    el('div', { class: 'ratio-row' }, [
      el('span', { class: `ratio-name ${essence}`, text: t(`essence.${essence}.short`) }),
      el('div', { class: 'ratio-track' }, [
        (() => {
          const node = el('div', { class: `ratio-fill ${essence}` });
          node.style.width = `${Math.round(fill * 100)}%`;
          return node;
        })(),
      ]),
      el('span', {
        class: 'ratio-share num',
        text: targetTotal > 0 ? `${Math.round((recipe.target[essence] / targetTotal) * 100)}%` : '',
      }),
    ]),
  );

  row.append(
    el('div', { class: 'recipe-body' }, [el('div', { class: 'ratio-bars' }, bars)]),
  );

  return row;
}
