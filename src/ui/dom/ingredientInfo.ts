/**
 * What an ingredient actually does.
 *
 * The tiles carried a name, a picture and five bare numbers, which tells you
 * what an ingredient IS without telling you what it is FOR. Everything a player
 * needs to reason about a blend is derivable — the essence it contributes, how
 * it ages, whether it will fit in the vessel you meant to use, and which
 * recipes it points toward — so none of it should have to be guessed at.
 *
 * The recipe list is the part that answers the question directly: an ingredient
 * "does" whatever it steers the pot toward.
 */

import {
  button,
  chip,
  el,
  emptyNote,
  ingredientIcon,
  modal,
  quantityAction,
} from './components';
import type { QuantityActionSpec } from './components';
import { t } from '@/i18n';
import { config, getIngredient, realRecipes } from '@/sim/config';
import { agingRateFor, angleBetween, applyFreshness, totalEssence } from '@/sim/essences';
import { dominantEssence } from '@/ui/art';
import { isDiscovered } from '@/sim/discovery';
import type { Simulation } from '@/sim/sim';
import { ESSENCES } from '@/sim/types';
import type { EssenceVector, Freshness, IngredientCategory } from '@/sim/types';

/** How many recipes to name. Enough to see a pattern, few enough to read. */
const SUGGESTIONS = 4;

const HOUR = 3_600_000;

/**
 * The three ages, in this ingredient's own numbers.
 *
 * Written by running `applyFreshness` per stage rather than by printing the
 * config multipliers, so the table shows what this ingredient will actually
 * contribute and cannot drift from the arithmetic the pot does.
 */
function freshnessTable(essence: EssenceVector, rate: number): HTMLElement {
  const f = config.freshness;
  // Scaled by the category's rate, so a fungus reads 24h and 96h rather than
  // the herb schedule it does not follow.
  const hours = (ms: number) => `${Math.round((ms * rate) / HOUR)}`;

  const stage = (freshness: Freshness) =>
    t('ingredientInfo.age.total', {
      total: Math.round(totalEssence(applyFreshness(essence, freshness))),
      percent: Math.round(
        (freshness === 'dewfresh'
          ? f.dewfreshEssenceMultiplier
          : freshness === 'fresh'
            ? f.freshEssenceMultiplier
            : f.driedEssenceMultiplier) * 100,
      ),
    });

  const rows: Array<[string, string, string]> = [
    [
      t('freshness.dewfresh'),
      t('ingredientInfo.age.first', { hours: hours(f.dewfreshUntilMs) }),
      stage('dewfresh'),
    ],
    [
      t('freshness.fresh'),
      t('ingredientInfo.age.between', {
        from: hours(f.dewfreshUntilMs),
        to: hours(f.freshUntilMs),
      }),
      stage('fresh'),
    ],
    [
      t('freshness.dried'),
      t('ingredientInfo.age.after', { hours: hours(f.freshUntilMs) }),
      stage('dried'),
    ],
  ];

  return el(
    'div',
    { class: 'freshness-table' },
    rows.map(([name, when, effect]) =>
      el('div', { class: 'freshness-row' }, [
        el('span', { class: 'freshness-stage', text: name }),
        el('span', { class: 'freshness-when num', text: when }),
        el('span', { class: 'freshness-effect', text: effect }),
      ]),
    ),
  );
}

/**
 * Recipes this ingredient steers the pot toward, nearest first.
 *
 * Angle between the ingredient's own vector and the recipe's target, which is
 * exactly the measure the cauldron identifies by — so this is not a hint, it is
 * the same arithmetic the brew will do.
 *
 * Undiscovered recipes are included but unnamed: knowing that something you
 * hold points at a recipe you have not met is a reason to experiment, whereas
 * naming it would hand over the discovery.
 */
function pointsToward(sim: Simulation, essence: EssenceVector) {
  const matches = realRecipes()
    .map((recipe) => ({
      recipe,
      deg: (angleBetween(essence, recipe.target) * 180) / Math.PI,
      known: isDiscovered(sim.world, recipe.id),
    }))
    .filter((entry) => entry.deg <= entry.recipe.toleranceDeg + 12)
    .sort((a, b) => a.deg - b.deg);

  /*
   * One entry per DIRECTION, not per recipe.
   *
   * An ingredient's essence is a direction, so it sits at exactly the same
   * angle from every rung of a ladder — listing Faint, Strong, Grand and
   * Sovereign Ember separately filled the panel with four identical lines at
   * four identical angles. Which rung you get is decided by how much you put
   * in, and that is the pot's business, not the ingredient's.
   *
   * A known recipe wins its direction over an unknown one, so the panel names
   * what it can.
   */
  const byDirection = new Map<string, (typeof matches)[number]>();
  for (const entry of matches) {
    const key = JSON.stringify(entry.recipe.target);
    const held = byDirection.get(key);
    if (!held || (entry.known && !held.known)) byDirection.set(key, entry);
  }

  const distinct = [...byDirection.values()].sort((a, b) => a.deg - b.deg);
  return {
    known: distinct.filter((entry) => entry.known).slice(0, SUGGESTIONS),
    unknown: distinct.filter((entry) => !entry.known).length,
  };
}

function essenceRows(essence: EssenceVector): HTMLElement {
  const rows = ESSENCES.filter((axis) => essence[axis] > 0).map((axis) =>
    el('div', { class: 'essence-row' }, [
      el('span', { class: `essence-swatch ${axis}` }),
      el('span', { class: 'essence-name', text: t(`essence.${axis}`) }),
      el('span', { class: 'num', text: String(essence[axis]) }),
    ]),
  );

  if (rows.length === 0) {
    return emptyNote(t('ingredientInfo.noEssence'));
  }
  return el('div', { class: 'essence-rows' }, rows);
}

/**
 * The properties panel for one ingredient.
 *
 * Built as a plain overlay so it sits over whichever screen asked for it, and
 * dismisses on backdrop click or Escape like the other dialogs.
 */
/**
 * Show what an ingredient does, and optionally offer to act on it.
 *
 * The action is what the tile's click used to be. Moving it in here is what
 * lets a tap on a tile mean "tell me about this" everywhere, instead of meaning
 * "buy one" in the market and "select" in the garden and "tell me" only on a
 * dot in the corner too small to aim at.
 */
export interface IngredientInfoOptions {
  action?: QuantityActionSpec;
  /**
   * The vector to report, where it is not the wild ingredient's own.
   *
   * A bred strain yields its base crop's ingredient but carries a crossbred
   * essence, so reading the definition gave the wild plant's numbers — a
   * generation-3 strain opened a panel that contradicted the tooltip on the
   * tile that opened it, and pointed at recipes chosen from the wrong vector.
   */
  essence?: EssenceVector;
  /** The name to show, where it is not the ingredient's own. */
  title?: string;
}

export function showIngredientInfo(
  sim: Simulation,
  ingredientId: string,
  options: IngredientInfoOptions = {},
): void {
  const { action, title } = options;
  const def = getIngredient(ingredientId);
  const essence = options.essence ?? def.essence;
  const total = totalEssence(essence);
  const dominant = dominantEssence(essence);

  const tags: HTMLElement[] = [chip(t(`category.${def.category as IngredientCategory}`))];
  for (const trait of def.traits ?? []) {
    tags.push(chip(t(`trait.${trait}`), trait === 'volatile' ? 'warn' : 'good'));
  }

  const suggestions = pointsToward(sim, essence);

  const build = (dismiss: () => void) => [el('div', { class: 'ingredient-info' }, [
    el('div', { class: 'ingredient-info-head' }, [
      el('span', { class: 'ingredient-info-art' }, [ingredientIcon(ingredientId, 44)]),
      el('div', {}, [
        el('h2', { text: title ?? t(`ingredient.${ingredientId}`) }),
        el('div', { class: 'row-sub' }, tags),
      ]),
    ]),

    el('span', {
      class: 'field-label',
      text: t('ingredientInfo.contributes', { total: String(total) }),
    }),
    essenceRows(essence),

    el('span', { class: 'field-label', text: t('ingredientInfo.suits') }),
    suggestions.known.length === 0 && suggestions.unknown === 0
      ? emptyNote(t('ingredientInfo.suitsNothing'))
      : el('div', { class: 'ingredient-info-recipes' }, [
          ...suggestions.known.map((entry) =>
            el('div', { class: 'ingredient-info-recipe' }, [
              el('span', { text: t(`recipe.${entry.recipe.id}`) }),
              chip(
                t('ingredientInfo.off', { deg: entry.deg.toFixed(0) }),
                entry.deg <= entry.recipe.toleranceDeg ? 'good' : 'default',
              ),
            ]),
          ),
          /*
           * The unknown ones as a count, not a list.
           *
           * Naming them would hand over the discovery; listing them as four
           * identical "not brewed yet" rows told the player nothing at all. A
           * number is the honest middle: there is something here worth finding.
           */
          ...(suggestions.unknown > 0
            ? [
                el('p', {
                  class: 'ingredient-info-note',
                  // "And 3 more" needs something to be more *than*. With no
                  // known recipes above it, the count stands on its own.
                  text: t(
                    suggestions.known.length > 0
                      ? 'ingredientInfo.undiscovered'
                      : 'ingredientInfo.undiscoveredOnly',
                    { count: suggestions.unknown },
                  ),
                }),
              ]
            : []),
        ]),

    /*
     * How it behaves over time, and then the figures.
     *
     * Wrapped together so the sentence sits against the table it introduces.
     * Which branch runs is the category's business now, not the `stable`
     * trait's: stone, expedition finds and reagents have no schedule to show,
     * and everything else gets one drawn at its own rate.
     */
    ...(agingRateFor(ingredientId) <= 0
      ? [el('p', { class: 'ingredient-info-note', text: t('ingredientInfo.stable') })]
      : [
          el('div', { class: 'freshness-block' }, [
            el('p', { class: 'ingredient-info-note', text: t('ingredientInfo.ages') }),
            freshnessTable(essence, agingRateFor(ingredientId)),
          ]),
        ]),

    el('div', { class: 'dialog-actions' }, [
      button(t('common.close'), dismiss, { variant: 'quiet' }),
      ...(action
        ? [
            quantityAction({
              ...action,
              // The panel closes on the way out, so the result lands on the
              // screen behind it rather than under a dialog nobody dismissed.
              run: (quantity) => {
                dismiss();
                action.run(quantity);
              },
            }),
          ]
        : []),
    ]),
  ])];

  modal({ content: build });
}
