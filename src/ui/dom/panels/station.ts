/**
 * The brewing station: one pot, full screen, three columns.
 *
 *   left   — what goes in, how hot, and how it is worked
 *   middle — the pot itself, with what is in it actually in it
 *   right  — the recipe book, showing how close the blend is to each recipe
 *
 * The old design put all of this in a docked panel beside a painted bench, which
 * meant the two halves of one act — choosing an ingredient and watching what it
 * did to the blend — were a scroll apart. Brewing is the game's one deliberate,
 * fiddly act; it gets the whole screen while you are doing it, and the bench
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
  collapsible,
  el,
  emptyState,
  essenceChip,
  gradeBadge,
  ingredientIcon,
  makeDropTarget,
  meter,
  optionGroup,
  stat,
} from '../components';
import { formatDuration, formatGold, t } from '@/i18n';
import { config, getIngredient, getSeal } from '@/sim/config';
import { inventoryRows } from '@/sim/inventory';
import { availableForms, availableSeals, availableVessels } from '@/sim/bottling';
import { outcomeProblems } from '@/sim/brewing';
import { fairValue } from '@/sim/market';
import { showIngredientInfo } from '../ingredientInfo';
import { ESSENCES } from '@/sim/types';
import type {
  BrewMethod,
  BrewOutcome,
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
let recipeEssences = new Set<Essence>();
/** The auto-filter: hide recipes the pot has already ruled out. */
let matchPot = true;

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
  return el('div', { class: 'station' }, [
    el('div', { class: 'station-bar' }, [
      button(t('station.back'), () => closeStation(), { variant: 'quiet', small: true }),
      el('span', { class: 'station-title', text: t(`cauldronTier.${sim.cauldron.tierId}`) }),
      el('span', {
        class: 'station-capacity num',
        text: `${Math.round(sim.assess()?.totalEssence ?? 0)} / ${sim.cauldronCapacity}`,
      }),
    ]),
    el('div', { class: 'station-cols' }, [
      renderLeft(sim),
      renderMiddle(sim),
      renderRight(sim),
    ]),
  ]);
}

// -- left: ingredients, heat, method -----------------------------------------

const FRESHNESS_TONE: Record<Freshness, 'default' | 'warn' | 'good'> = {
  dewfresh: 'good',
  fresh: 'default',
  dried: 'warn',
};

function renderLeft(sim: Simulation): HTMLElement {
  return scroller('left', 'station-col station-left', [
    renderStores(sim),
    renderHeat(sim),
    renderMethod(sim),
  ]);
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
    if (ingredientCategories.size > 0 && !ingredientCategories.has(def.category)) return false;
    if (ingredientEssences.size === 0) return true;
    const strain = entry.strainId
      ? sim.world.strains.find((s) => s.id === entry.strainId)
      : undefined;
    const profile = strain?.essence ?? def.essence;
    return [...ingredientEssences].every((essence) => profile[essence] > 0);
  });

  const tiles = rows.map((entry) => ingredientCard(sim, entry, full));

  const body = [
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
    scroller('stores', 'station-scroll', [
      tiles.length > 0
        ? el('div', { class: 'ingredient-grid' }, tiles)
        : el('p', { class: 'grid-empty', text: t('cauldron.stores.empty') }),
    ]),
  ];

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

function renderHeat(sim: Simulation): HTMLElement {
  const b = config.brewing;
  const temperature = Math.round(sim.temperature);
  const span = b.maxTemperature - b.minTemperature;
  const position = (temperature - b.minTemperature) / span;

  const outcome = sim.assess();
  const hint = outcome && !outcome.isFallback ? sim.bandHint(outcome.recipeId) : null;
  const target =
    hint?.known && hint.min !== null && hint.max !== null
      ? { min: hint.min, max: hint.max }
      : undefined;

  const track = el('div', { class: 'gauge-track' });
  if (target) {
    const band = el('div', { class: 'gauge-band' });
    band.style.left = `${((target.min - b.minTemperature) / span) * 100}%`;
    band.style.width = `${((target.max - target.min) / span) * 100}%`;
    track.append(band);
  }
  const fill = el('div', { class: 'gauge-fill', 'data-live-temp-fill': '' });
  fill.style.width = `${Math.min(100, Math.max(0, position * 100))}%`;
  const needle = el('div', { class: 'gauge-needle', 'data-live-temp-needle': '' });
  needle.style.left = `${Math.min(100, Math.max(0, position * 100))}%`;
  track.append(fill, needle);

  const inBand = target ? temperature >= target.min && temperature <= target.max : false;
  const gauge = el('div', { class: 'gauge' }, [
    el('div', { class: 'gauge-head' }, [
      /*
       * Patched in place every frame rather than redrawn.
       *
       * An idle pot cools continuously, but nothing on this screen forces a
       * rebuild while it does — so the gauge sat at whatever it read when the
       * panel was last drawn, and the first tap on a burner made the number
       * "jump" twenty degrees as the display caught up with the pot. Rebuilding
       * the panel every frame instead would make the whole station unclickable,
       * which is the lesson the roster taught. See `updateTemperature`.
       */
      el('span', { class: 'gauge-value num', text: `${temperature}°`, 'data-live-temp': '' }),
      target
        ? chip(
            t('cauldron.temp.target', { min: target.min, max: target.max }),
            inBand ? 'good' : 'warn',
          )
        : chip(t('cauldron.temp.noTarget')),
    ]),
    track,
  ]);
  if (inBand) gauge.dataset.inBand = 'true';

  return el('section', { class: 'station-block' }, [
    el('span', { class: 'field-label', text: t('cauldron.step2') }),
    gauge,
    el('div', { class: 'burner-row' }, [
      burnerButton(sim, 'chill', t('cauldron.action.chill'), 'cool'),
      burnerButton(sim, 'heat', t('cauldron.action.heat'), 'warm'),
    ]),
    // Coarse above, fine below: hold to travel, tap to land.
    el('div', { class: 'burner-row burner-fine' }, [
      stepButton(sim, 'chill', '−1°'),
      stepButton(sim, 'heat', '+1°'),
    ]),
  ]);
}

/*
 * Two words, and no explanation under them.
 *
 * "Melds the blend" and "Boils it down" are flavour for a binary choice the
 * recipe book already answers per recipe — so they were two lines of prose
 * taking the height of a whole section to say nothing a player acts on.
 */
function renderMethod(sim: Simulation): HTMLElement {
  return el('section', { class: 'station-block' }, [
    el('span', { class: 'field-label', text: t('cauldron.method') }),
    el(
      'div',
      { class: 'method-row' },
      (['stirred', 'simmered'] as BrewMethod[]).map((id) => {
        const node = el('button', { class: 'sort-chip method-chip', type: 'button' }, [
          el('span', { text: t(`method.${id}`) }),
        ]);
        node.setAttribute('aria-pressed', String(sim.method === id));
        node.addEventListener('click', () => {
          sim.setMethod(id);
          changed();
        });
        return node;
      }),
    ),
  ]);
}

/**
 * A burner button that ramps while held.
 *
 * The release is bound to the DOCUMENT, not to the button, and that is the
 * whole point. The old version listened on the button itself and also called
 * `changed()` on click — which rebuilds the panel and throws the button away
 * mid-gesture. The replacement never saw a `pointerup`, so `sim.burner` stayed
 * set for ever: the pot ran to the top of its range, and because a held burner
 * makes the screen redraw every frame, the whole page became unclickable and
 * had to be reloaded.
 *
 * A document listener cannot be destroyed by the thing it is watching, and
 * `once` means it cleans itself up whether or not this button still exists.
 */
function burnerButton(
  sim: Simulation,
  burner: 'heat' | 'chill',
  label: string,
  variant: string,
): HTMLElement {
  const node = el('button', { class: `btn ${variant} burner`, type: 'button' }, [label]);

  const release = () => {
    sim.burner = null;
    delete node.dataset.held;
    changed();
  };

  node.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    sim.burner = burner;
    node.dataset.held = 'true';
    document.addEventListener('pointerup', release, { once: true });
    document.addEventListener('pointercancel', release, { once: true });
  });

  /*
   * No `changed()` on the tap.
   *
   * Holding already redraws every frame, and a redraw here would replace the
   * button between this pointerdown and its pointerup — which is how the hold
   * got stuck in the first place. The frame loop paints the new temperature.
   */
  node.addEventListener('click', () => sim.nudge(burner));
  return node;
}

/**
 * One degree at a time.
 *
 * A band can be four degrees wide and the ramp moves faster than that, so
 * without this the only way onto a narrow target is to overshoot repeatedly and
 * hope. Safe to redraw on, because there is no hold to interrupt.
 */
function stepButton(sim: Simulation, burner: 'heat' | 'chill', label: string): HTMLElement {
  const node = el('button', { class: 'btn quiet small burner-step', type: 'button' }, [label]);
  node.addEventListener('click', () => {
    sim.nudge(burner, 1);
    changed();
  });
  return node;
}

// -- middle: the pot ---------------------------------------------------------

function renderMiddle(sim: Simulation): HTMLElement {
  const col = scroller('middle', 'station-col station-middle', [renderPot(sim)]);

  if (sim.pendingBrew) col.append(renderBottling(sim));
  else if (sim.brewing) col.append(renderBrewingTimer(sim));
  else col.append(renderOutcome(sim));

  return col;
}

/**
 * The pot, with what is in it in it.
 *
 * Three layers that answer three different questions at a glance: the fire says
 * how hot it is, the contents say what is in it, and the surface says whether it
 * is cooking. The last one is deliberately quiet until the brew has actually
 * been started — a pot you are still filling is not doing anything yet, and
 * bubbling at you while you fill it was the effect that said otherwise.
 */
function renderPot(sim: Simulation): HTMLElement {
  const b = config.brewing;
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

  /*
   * The fire is always lit and always answers to the temperature.
   *
   * Nothing else on this screen carries heat as a feeling rather than a number,
   * and a burner that only appears past some threshold would make the pot look
   * broken while it is merely cold.
   */
  const heat = Math.min(
    1,
    Math.max(0, (sim.temperature - b.minTemperature) / (b.maxTemperature - b.minTemperature)),
  );
  const fire = el('div', { class: 'pot-fire', 'data-live-fire': '' });
  fire.style.setProperty('--heat', heat.toFixed(3));

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

  stage.append(fire, vessel);

  const blend = sim.assess();
  const chips = blend
    ? ESSENCES.filter((essence) => blend.total[essence] >= PRESENT).map((essence) =>
        essenceChip(essence, blend.total[essence]),
      )
    : [];

  return el('section', { class: 'station-block station-pot' }, [
    stage,
    el('div', { class: 'chips pot-blend' }, chips),
  ]);
}

function temperatureLine(sim: Simulation, outcome: BrewOutcome): HTMLElement {
  const label = t('cauldron.readout.temperature');
  if (outcome.isFallback) return stat(label, `${Math.round(outcome.temperature)}°`);

  const hint = sim.bandHint(outcome.recipeId);
  const verdict = sim.temperatureVerdict(outcome.recipeId);
  if (verdict === 'inRange') return stat(label, t('cauldron.readout.tempOk'), 'good');
  if (hint.known) {
    return stat(
      label,
      t('cauldron.readout.tempOff', { degrees: Math.round(outcome.degreesOutsideBand) }),
      'warn',
    );
  }
  return stat(
    label,
    verdict === 'tooCold' ? t('cauldron.readout.tooCold') : t('cauldron.readout.tooHot'),
    'warn',
  );
}

function renderOutcome(sim: Simulation): HTMLElement {
  const section = el('section', { class: 'station-block' });
  const outcome = sim.assess();
  if (!outcome) {
    section.append(emptyState(t('cauldron.empty'), t('cauldron.empty.hint')));
    return section;
  }

  const card = el('div', { class: 'outcome' }, [
    el('div', { class: 'outcome-head' }, [
      gradeBadge(outcome.grade),
      el('span', { class: 'outcome-name', text: t(`recipe.${outcome.recipeId}`) }),
      chip(t(`potency.${outcome.potencyTier}`)),
    ]),
    stat(t('cauldron.readout.purity'), `${Math.round(outcome.purity)} / 100`),
    temperatureLine(sim, outcome),
  ]);
  if (outcome.isFallback) card.dataset.tone = 'warn';
  section.append(card);

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
      button(
        t('cauldron.action.reject'),
        () => {
          sim.rejectBrew();
          toast(t('cauldron.rejected'));
          changed();
        },
        { variant: 'quiet' },
      ),
      button(t('cauldron.action.accept'), () => {
        if (sim.acceptBrew()) changed();
      }, { variant: 'gold' }),
    ]),
  );
  return section;
}

function renderBrewingTimer(sim: Simulation): HTMLElement {
  const brewing = sim.brewing!;
  const total = brewing.readyAt - brewing.startedAt;
  const done = sim.now - brewing.startedAt;

  const clock = stat(
    t('cauldron.brewing.remaining'),
    formatDuration(Math.max(0, brewing.readyAt - sim.now)),
  );

  return el('section', { class: 'station-block' }, [
    el('div', { class: 'outcome' }, [
      el('div', { class: 'outcome-head' }, [
        gradeBadge(brewing.outcome.grade),
        el('span', { class: 'outcome-name', text: t(`recipe.${brewing.outcome.recipeId}`) }),
        chip(t(`potency.${brewing.outcome.potencyTier}`)),
      ]),
      clock,
      meter(total > 0 ? done / total : 1),
    ]),
  ]);
}

function renderBottling(sim: Simulation): HTMLElement {
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
    el('div', { class: 'outcome' }, [
      el('div', { class: 'outcome-head' }, [
        gradeBadge(brew.grade),
        el('span', { class: 'outcome-name', text: t(`recipe.${brew.recipeId}`) }),
        chip(t(`potency.${brew.potencyTier}`)),
      ]),
      stat(t('cauldron.readout.purity'), `${Math.round(brew.purity)} / 100`),
    ]),
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
            changed();
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
            changed();
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
            changed();
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
          sim.discardPending();
          changed();
        },
        { variant: 'quiet' },
      ),
      button(
        t('workbench.action.bottle'),
        () => {
          const item = sim.bottlePending({ formId, vesselId, sealId });
          if (item) {
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

function temperatureChip(sim: Simulation, recipe: RecipeDef): HTMLElement {
  const hint = sim.bandHint(recipe.id);
  if (hint.known && hint.min !== null && hint.max !== null) {
    return chip(
      t('cauldron.temp.target', { min: Math.round(hint.min), max: Math.round(hint.max) }),
      'good',
    );
  }
  if (hint.lowerBound !== null && hint.upperBound !== null) {
    return chip(
      t('cauldron.temp.between', {
        min: Math.round(hint.lowerBound),
        max: Math.round(hint.upperBound),
      }),
      'warn',
    );
  }
  if (hint.lowerBound !== null) {
    return chip(t('cauldron.temp.hotterThan', { min: Math.round(hint.lowerBound) }), 'warn');
  }
  if (hint.upperBound !== null) {
    return chip(t('cauldron.temp.colderThan', { max: Math.round(hint.upperBound) }), 'warn');
  }
  return chip(t('cauldron.temp.unknown'), 'warn');
}

function renderRight(sim: Simulation): HTMLElement {
  const blend = sim.assess()?.total ?? null;
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

  const rows = recipes.map((recipe) => renderRecipe(sim, recipe, blend));

  return scroller('right', 'station-col station-right', [
    el('section', { class: 'station-block' }, [
      el('div', { class: 'stores-head' }, [
        el('span', { class: 'field-label', text: t('cauldron.recipes') }),
        el('span', { class: 'field-note', text: t('station.showing', { count: recipes.length }) }),
      ]),
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
      scroller(
        'recipes',
        'station-scroll',
        rows.length > 0 ? rows : [el('p', { class: 'grid-empty', text: t('station.noRecipes') })],
      ),
    ]),
  ]);
}

function renderRecipe(
  sim: Simulation,
  recipe: RecipeDef,
  blend: EssenceVector | null,
): HTMLElement {
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

  /*
   * The essence total IS an amount rather than a ratio, so it is the one number
   * here worth printing — and only where the recipe actually pins one. A recipe
   * with no `essence` band accepts any magnitude, and printing a range it does
   * not have would invent a rule.
   */
  const chips: HTMLElement[] = [temperatureChip(sim, recipe), chip(t(`method.${recipe.method}`))];
  const band = recipe.essence;
  if (band) {
    const total = blend ? ESSENCES.reduce((sum, essence) => sum + blend[essence], 0) : 0;
    const inRange = total >= band.min && (band.max === null || total <= band.max);
    chips.push(
      chip(
        band.max === null
          ? t('station.essenceFrom', { min: band.min })
          : t('station.essenceRange', { min: band.min, max: band.max }),
        inRange ? 'good' : 'plain',
      ),
    );
  }

  row.append(
    el('div', { class: 'recipe-body' }, [
      el('div', { class: 'ratio-bars' }, bars),
      el('div', { class: 'chips' }, chips),
    ]),
  );

  return row;
}
