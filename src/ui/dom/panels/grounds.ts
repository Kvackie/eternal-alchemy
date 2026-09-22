/**
 * Grounds: the garden, the cave and the shaft under one screen.
 *
 * Three sub-tabs rather than three nav entries, because they are three answers
 * to the same question — where do ingredients come from — and because eight
 * top-level destinations is already one too many on a phone.
 *
 * Each keeps its own verb: the garden you plant, the cave you seed, the quarry
 * you dig.
 */

import {
  button,
  chip,
  el,
  emptyState,
  ingredientIcon,
  makeDropTarget,
  meter,
  modal,
  panelHeader,
  slot,
  slotGrid,
  stat,
  tabPanel,
  tabStrip,
} from '../components';
import { formatDuration, t } from '@/i18n';
import { showIngredientInfo } from '../ingredientInfo';
import { caveConfig, crops, getCrop, getIngredient, shaftConfig } from '@/sim/config';
import { isReady } from '@/sim/garden';
import { isMature, maturityOf } from '@/sim/cave';
import { previewCross } from '@/sim/greenhouse';
import { isWorkable, veinsByDepth } from '@/sim/shaft';
import { ESSENCES } from '@/sim/types';
import { dominantEssence } from '@/ui/phaser/placeholders';
import type { CaveTile, Plot, ShaftVein } from '@/sim/types';
import type { Simulation } from '@/sim/sim';
import { changed, toast } from '@/ui/bus';

export const SEED_DRAG = 'application/x-eternal-seed';

type Tab = 'garden' | 'cave' | 'shaft';

let tab: Tab = 'garden';
let selectedSpecies: string | null = null;
let caveTool: 'seed' | 'lantern' | 'tray' = 'seed';

export function setGroundsTab(next: Tab): void {
  tab = next;
}

/**
 * Whether what is showing here is drawn behind the panel.
 *
 * Only the garden is. The canvas paints plots, and it painted them on the Cave
 * and the Quarry too — so both tabs sat over four beds of soil, which is a
 * picture of somewhere else. Telling the shell that lets those two take the
 * whole page, which they would rather have anyway: one is a grid and the other
 * is a list, and neither has a view.
 */
export function groundsHasScene(): boolean {
  return tab === 'garden';
}

export function renderGrounds(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body' });

  body.append(
    tabStrip({
      name: 'grounds',
      current: tab,
      tabs: (['garden', 'cave', 'shaft'] as Tab[]).map((id) => ({
        id,
        label: t(`grounds.tab.${id}`),
      })),
      onSelect: (id) => {
        tab = id as Tab;
        changed();
      },
    }),
  );

  const view = el('div', { class: 'panel-body' });
  if (tab === 'garden') renderGarden(sim, view);
  else if (tab === 'cave') renderCave(sim, view);
  else renderShaft(sim, view);
  body.append(tabPanel('grounds', tab, [...view.children] as HTMLElement[]));

  /*
   * Docked beside the garden, and a full page for the other two.
   *
   * A panel that leaves room for a picture is right only when there is a
   * picture: the Cave is a grid of beds and the Quarry a list of seams, and
   * both were squeezed into 640px of a 1920px window so that four beds of the
   * garden's soil could show beside them.
   */
  return el('div', { class: groundsHasScene() ? 'panel' : 'panel panel-roomy' }, [
    panelHeader(t('grounds.title'), t(`grounds.${tab}.subtitle`)),
    body,
  ]);
}

/**
 * What a harvest actually gave you.
 *
 * "+6 harvested" told you a number and left you to guess the noun, which is the
 * one thing you needed — a garden of twenty-five beds comes up ready in a
 * jumble, and the whole point of pressing the button is to learn what is now in
 * stores. Harvesting several beds at once names the crop when they agree and
 * falls back to a count of kinds when they do not, because listing eight names
 * in a toast is no more readable than listing none.
 */
function harvestToast(
  results: Array<{ ingredientId: string; count: number }>,
  total: number,
  seeds: number,
): string {
  const kinds = new Set(results.map((r) => r.ingredientId));
  const name =
    kinds.size === 1
      ? t(`ingredient.${[...kinds][0]}`)
      : t('toast.harvestKinds', { count: kinds.size });

  return seeds > 0
    ? t('toast.harvestSeeds', { count: total, ingredient: name, seeds })
    : t('toast.harvest', { count: total, ingredient: name });
}

/** Painted art where it exists, essence glyph where it doesn't. */
function iconFor(ingredientId: string): Node {
  return ingredientIcon(ingredientId);
}

// ---------------------------------------------------------------------------
// Garden — you plant
// ---------------------------------------------------------------------------

function renderGarden(sim: Simulation, body: HTMLElement): void {
  // Wild crops and bred strains sit in the same tray — a seed is a seed.
  const wild = crops
    .map((crop) => ({ id: crop.id, count: sim.world.seeds[crop.id] ?? 0, crop, strain: null }))
    .filter((entry) => entry.count > 0);

  const bred = sim.world.strains
    .map((strain) => ({
      id: strain.id,
      count: sim.world.seeds[strain.id] ?? 0,
      crop: getCrop(strain.baseCropId),
      strain,
    }))
    .filter((entry) => entry.count > 0);

  const tiles = [...wild, ...bred].map(({ id, count, crop, strain }) => {
    const growMs = strain?.growMs ?? crop.growMs;
    const label = strain
      ? t('greenhouse.strain', { crop: t(`crop.${crop.id}`), gen: strain.generation })
      : t(`crop.${crop.id}`);

    return slot({
      id,
      icon: iconFor(crop.yields),
      label,
      count,
      /*
       * The soil is on the tile, not in a tooltip.
       *
       * Planting asks which ground, so which ground a seed wants is the whole
       * of the decision — and it lived in a `title`, which a touchscreen never
       * shows. The grow time was there too and was already in the caption,
       * which is the sort of thing a tooltip full of facts hides.
       */
      caption: [
        el('span', { text: formatDuration(growMs) }),
        chip(t(`soil.${crop.soil}`), 'plain'),
      ],
      dragType: SEED_DRAG,
      tone: strain ? 'good' : 'default',
      /*
       * The tile opens what it grows into; the panel picks it up.
       *
       * What a seed yields is the thing worth knowing before spending a plot on
       * it for half an hour, and it used to live behind a dot in the corner of
       * the tile — 18px, and the only route to it. The tap now means the same
       * thing here as everywhere else, and choosing the seed is a button inside.
       */
      /*
       * The tile explains the seed; the panel plants it.
       *
       * This used to select the seed and leave the planting to a plot's own
       * button — tile, Plant this, then Plant, three presses to put one seed in
       * the ground. The panel does it now, into the first empty plot, and keeps
       * the seed in hand so the next plot's button plants the same thing.
       * Dragging onto a particular plot is still there for when *which* plot
       * matters; this is for when it does not.
       */
      onActivate: () => {
        const free = sim.world.plots.filter((plot) => !plot.crop);
        showIngredientInfo(sim, crop.yields, {
          // A bred strain carries its own vector, not the wild plant's.
          essence: strain?.essence,
          title: strain ? label : undefined,
          action: {
            label: t('garden.seed.plant'),
            max: 1,
            blocked: free.length > 0 ? undefined : t('garden.seed.noPlot'),
            run: () => openSoilPicker(sim, id, crop.soil),
          },
        });
      },
    });
  });

  body.append(
    el('section', { class: 'seeds' }, [
      el('div', { class: 'stores-head' }, [
        el('span', { class: 'field-label', text: t('garden.seeds') }),
        el('span', { class: 'field-note', text: t('garden.seeds.source') }),
      ]),
      slotGrid(tiles, t('garden.seeds.empty')),
    ]),
  );

  /*
   * Harvest all at the top, where the list starts.
   *
   * It used to sit under the last plot, which on sixteen beds is a scroll to
   * the bottom to press the button that empties the thing you just scrolled
   * past. Nothing else here is a bulk action: tending is gone, and planting
   * asks which soil.
   */
  const ready = sim.world.plots.filter((plot) => isReady(plot, sim.now)).length;
  const plots = el('section', { class: 'plots' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('garden.plots') }),
      el('span', { class: 'field-note', text: t('garden.plots.hint') }),
      ...(ready > 0
        ? [
            button(
              t('garden.action.harvestAll', { count: ready }),
              () => {
                const results = sim.harvestAll();
                const total = results.reduce((sum, r) => sum + r.count, 0);
                const seeds = results.reduce((sum, r) => sum + r.seeds, 0);
                toast(harvestToast(results, total, seeds));
                changed();
              },
              { small: true, variant: 'good' },
            ),
          ]
        : []),
    ]),
  ]);
  for (const plot of sim.world.plots) plots.append(renderPlot(sim, plot));
  body.append(plots);

  if (sim.hasGreenhouse) body.append(renderGreenhouse(sim));

}

/** Seeds and strains you actually hold, in the order the tray shows them. */
function seedsOnHand(sim: Simulation): Array<{ id: string; label: string; count: number }> {
  const wild = crops
    .map((crop) => ({ id: crop.id, label: t(`crop.${crop.id}`), count: sim.world.seeds[crop.id] ?? 0 }))
    .filter((entry) => entry.count > 0);

  const bred = sim.world.strains
    .map((strain) => ({
      id: strain.id,
      label: t('greenhouse.strain', {
        crop: t(`crop.${strain.baseCropId}`),
        gen: strain.generation,
      }),
      count: sim.world.seeds[strain.id] ?? 0,
    }))
    .filter((entry) => entry.count > 0);

  return [...wild, ...bred];
}

/** The nearest empty plot of a given soil, counting from the first bed. */
function nearestFreePlot(sim: Simulation, soil: string): Plot | undefined {
  return sim.world.plots.find((plot) => !plot.crop && plot.soil === soil);
}

/**
 * Which ground, rather than which bed.
 *
 * Plots are interchangeable except for their soil, so asking "plot 7 or plot
 * 11" is asking a player to hold a map of their own garden in their head to
 * answer a question about dirt. The soil is the decision; the bed is
 * bookkeeping, and the nearest empty one of that soil is as good as any.
 *
 * The soil a crop wants is marked and sorted first, and a soil with no empty
 * bed left is still listed, greyed, so the picker is a picture of the garden
 * rather than a list that silently loses options.
 */
function openSoilPicker(sim: Simulation, seedId: string, wanted: string): void {
  const soils = [...new Set(sim.world.plots.map((plot) => plot.soil))].sort((a, b) => {
    const pick = Number(b === wanted) - Number(a === wanted);
    return pick || t(`soil.${a}`).localeCompare(t(`soil.${b}`));
  });

  modal({
    content: (dismiss) => [
      el('h2', { text: t('garden.soil.title') }),
      el('p', { text: t('garden.soil.hint', { soil: t(`soil.${wanted}`) }) }),
      el(
        'div',
        { class: 'shelf-picker' },
        soils.map((soil) => {
          const free = sim.world.plots.filter((plot) => !plot.crop && plot.soil === soil).length;
          return button(
            free > 0
              ? t('garden.soil.option', { soil: t(`soil.${soil}`), count: free })
              : t('garden.soil.full', { soil: t(`soil.${soil}`) }),
            () => {
              dismiss();
              const plot = nearestFreePlot(sim, soil);
              if (plot && sim.plant(plot.id, seedId)) changed();
            },
            { variant: soil === wanted ? 'good' : 'quiet', disabled: free === 0 },
          );
        }),
      ),
      el('div', { class: 'dialog-actions' }, [
        button(t('common.cancel'), dismiss, { variant: 'quiet' }),
      ]),
    ],
  });
}

/** The other way round: this bed, which seed? */
function openSeedPicker(sim: Simulation, plot: Plot): void {
  const seeds = seedsOnHand(sim);

  modal({
    content: (dismiss) => [
      el('h2', { text: t('garden.seedPicker.title') }),
      el('p', { text: t('garden.seedPicker.hint', { soil: t(`soil.${plot.soil}`) }) }),
      el(
        'div',
        { class: 'shelf-picker' },
        seeds.map((seed) => {
          const suits = soilWantedBy(seed.id) === plot.soil;
          return button(
            t('garden.seedPicker.option', { seed: seed.label, count: seed.count }),
            () => {
              dismiss();
              if (sim.plant(plot.id, seed.id)) changed();
            },
            { variant: suits ? 'good' : 'quiet' },
          );
        }),
      ),
      el('div', { class: 'dialog-actions' }, [
        button(t('common.cancel'), dismiss, { variant: 'quiet' }),
      ]),
    ],
  });
}

/** A planted plot's soil, marked good where it is the soil that crop wants. */
function soilChipFor(plot: Plot, cropId: string): HTMLElement {
  return chip(t(`soil.${plot.soil}`), soilWantedBy(cropId) === plot.soil ? 'good' : 'plain');
}

/** A strain keeps its parent's soil; an unknown seed id simply has no opinion. */
function soilWantedBy(cropOrStrainId: string): string | null {
  try {
    return getCrop(cropOrStrainId).soil;
  } catch {
    return null;
  }
}

function renderPlot(sim: Simulation, plot: Plot): HTMLElement {
  const node = el('div', { class: 'plot' });

  if (!plot.crop) {
    node.classList.add('plot-empty');
    makeDropTarget(node, SEED_DRAG, (cropId) => {
      if (sim.plant(plot.id, cropId)) changed();
    });

    /*
     * The plot asks which seed; the seed asks which soil.
     *
     * Nothing stays selected between the two any more. Choosing a seed used to
     * leave it in hand so the next plot's button would plant the same thing,
     * which meant every tap on a seed quietly armed the garden — and a plot
     * whose button did nothing until you had been somewhere else first.
     */
    const seeds = seedsOnHand(sim);
    node.append(
      el('div', { class: 'plot-main' }, [
        el('span', { class: 'plot-title', text: t('garden.plot.empty') }),
        el('div', { class: 'row-sub' }, [
          chip(t(`soil.${plot.soil}`), 'plain'),
          el('span', { text: t('garden.plot.emptyHint') }),
        ]),
      ]),
      button(
        t('garden.action.plant'),
        () => openSeedPicker(sim, plot),
        { disabled: seeds.length === 0, small: true },
      ),
    );
    return node;
  }

  const crop = getCrop(plot.crop.cropId);
  const ready = isReady(plot, sim.now);
  const remaining = Math.max(0, plot.crop.readyAt - sim.now);
  const name = t(`crop.${crop.id}`);
  if (ready) node.classList.add('plot-ready');

  const sub: Array<Node | string> = [soilChipFor(plot, crop.id)];
  if (plot.soil === crop.soil) sub.push(chip(t('garden.suited'), 'good'));

  const actions: HTMLElement[] = [];
  if (ready) {
    actions.push(
      button(
        t('garden.action.harvest'),
        () => {
          const result = sim.harvest(plot.id);
          if (result) {
            toast(harvestToast([result], result.count, result.seeds));
            changed();
          }
        },
        { small: true },
      ),
    );
  }

  node.append(
    el('span', { class: 'plot-icon' }, [iconFor(crop.yields)]),
    el('div', { class: 'plot-main' }, [
      el('span', {
        class: 'plot-title',
        text: ready
          ? t('garden.plot.ready', { crop: name })
          : t('garden.plot.growing', { crop: name, time: formatDuration(remaining) }),
      }),
      el('div', { class: 'row-sub' }, sub),
    ]),
    ...actions,
  );
  return node;
}

// ---------------------------------------------------------------------------
// Greenhouse — you breed
// ---------------------------------------------------------------------------

let parentA: string | null = null;
let parentB: string | null = null;

/** Wild crops are keyed by crop id; bred strains by strain id. */
function candidateKey(c: { cropId: string; strainId: string | null }): string {
  return c.strainId ?? c.cropId;
}

function renderGreenhouse(sim: Simulation): HTMLElement {
  const candidates = sim.crossCandidates();
  const a = candidates.find((c) => candidateKey(c) === parentA);
  const b = candidates.find((c) => candidateKey(c) === parentB);

  const tiles = candidates.map((candidate) => {
    const key = candidateKey(candidate);
    const strain = candidate.strainId
      ? sim.world.strains.find((s) => s.id === candidate.strainId)
      : undefined;

    const essences = ESSENCES.filter((e) => candidate.essence[e] > 0)
      .map((e) => `${t(`essence.${e}.short`)} ${Math.round(candidate.essence[e])}`)
      .join(' · ');

    return slot({
      id: key,
      icon: iconFor(strain ? getCrop(candidate.cropId).yields : getCrop(candidate.cropId).yields),
      label: strain
        ? t('greenhouse.strain', { crop: t(`crop.${candidate.cropId}`), gen: strain.generation })
        : t(`crop.${candidate.cropId}`),
      caption: [
        el('span', { text: essences }),
        ...(strain?.traits ?? []).map((trait) => chip(t(`trait.${trait}`), 'good')),
      ],
      selected: key === parentA || key === parentB,
      onActivate: () => {
        if (key === parentA) parentA = null;
        else if (key === parentB) parentB = null;
        else if (!parentA) parentA = key;
        else if (!parentB) parentB = key;
        else parentB = key;
        changed();
      },
    });
  });

  const section = el('section', { class: 'greenhouse' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('greenhouse.title') }),
      el('span', { class: 'field-note', text: t('greenhouse.hint') }),
    ]),
    slotGrid(tiles),
  ]);

  if (a && b) {
    const preview = previewCross(a.essence, b.essence);
    section.append(
      el('div', { class: 'outcome' }, [
        el('div', { class: 'outcome-head' }, [
          el('span', { class: 'outcome-name', text: t('greenhouse.preview') }),
        ]),
        el(
          'div',
          { class: 'chips' },
          ESSENCES.filter((e) => preview[e] > 0).map((e) =>
            chip(`${t(`essence.${e}.short`)} ${Math.round(preview[e])}`),
          ),
        ),
        el('span', { class: 'field-note', text: t('greenhouse.mutationNote') }),
      ]),
    );
  }

  section.append(
    el('div', { class: 'row-actions' }, [
      button(
        t('greenhouse.cross'),
        () => {
          if (!a || !b) return;
          const result = sim.crossStrains(a, b);
          if (result) {
            toast(
              result.mutation
                ? t('greenhouse.crossedMutation', { mutation: t(`mutation.${result.mutation}`) })
                : t('greenhouse.crossed'),
            );
            parentA = null;
            parentB = null;
            changed();
          }
        },
        { disabled: !a || !b },
      ),
    ]),
  );

  return section;
}

// ---------------------------------------------------------------------------
// Cave — it spreads
// ---------------------------------------------------------------------------

/*
 * A bed's spoken label carries what its picture only tints.
 *
 * A lantern is a warm wash and a tray is a six-pixel dot in a corner — both
 * invisible to a screen reader, and the tray nearly so to anyone else.
 */
function caveLabel(base: string, tile: CaveTile): string {
  const marks = [
    ...(tile.lit ? [t('cave.tile.lit')] : []),
    ...(tile.locked ? [t('cave.tile.trayed')] : []),
  ];
  return marks.length > 0 ? `${base} (${marks.join(', ')})` : base;
}

function renderCave(sim: Simulation, body: HTMLElement): void {
  const clusters = caveConfig.species
    .map((species) => ({ species, count: sim.world.spores[species.id] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .map(({ species, count }) =>
      slot({
        id: species.id,
        icon: iconFor(species.id),
        label: t(`ingredient.${species.id}`),
        count,
        caption: t(`cave.light.${species.light}`),
        selected: selectedSpecies === species.id,
        onActivate: () => {
          const chosen = selectedSpecies === species.id;
          showIngredientInfo(sim, species.id, {
            action: {
              label: chosen ? t('cave.spore.deselect') : t('cave.spore.select'),
              max: 1,
              run: () => {
                selectedSpecies = chosen ? null : species.id;
                caveTool = 'seed';
                changed();
              },
            },
          });
        },
      }),
    );

  body.append(
    el('section', { class: 'seeds' }, [
      el('div', { class: 'stores-head' }, [
        el('span', { class: 'field-label', text: t('cave.clusters') }),
        el('span', { class: 'field-note', text: t('cave.clusters.source') }),
      ]),
      slotGrid(clusters, t('cave.clusters.empty')),
    ]),
  );

  // The tool decides what tapping a tile does. Three verbs, one grid.
  body.append(
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: t('cave.tool') }),
      el(
        'div',
        { class: 'options options-tools' },
        /*
         * A glyph each, because three words in a row of identical cells do not
         * read as tools — they read as tabs. The picture is what says "this is
         * the thing in your hand".
         */
        ([
          ['seed', '\u{1F344}'],
          ['lantern', '\u{1F3EE}'],
          ['tray', '\u{1F9FA}'],
        ] as const).map(([id, glyph]) => {
          /*
           * The strip is three short cells; the hint has a line of its own.
           *
           * Only the tool in hand explained itself, from inside its own cell —
           * on a phone that is a sixty-pixel column of eight-word wrapping in
           * one of three cells, and a strip whose three tools are different
           * heights depending on which one you are holding.
           */
          const chosen = caveTool === id;
          const node = el('button', { class: 'option option-tool', type: 'button' }, [
            el('span', { class: 'tool-glyph', text: glyph }),
            el('span', { text: t(`cave.tool.${id}`) }),
          ]);
          node.setAttribute('aria-pressed', String(chosen));
          node.addEventListener('click', () => {
            caveTool = id;
            changed();
          });
          return node;
        }),
      ),
      el('span', { class: 'field-note', text: t(`cave.tool.${caveTool}.hint`) }),
    ]),
  );

  const grid = el('div', { class: 'cave-grid' });
  grid.style.setProperty('--cave-width', String(caveConfig.width));

  for (const tile of sim.world.cave.tiles) {
    const node = el('button', { class: 'cave-tile', type: 'button' });
    const mature = isMature(tile, sim.now);

    if (tile.speciesId) {
      /*
       * The mushroom, not its essence glyph.
       *
       * A bed used to show the dominant essence's shape, so twelve beds of
       * three species were twelve of the same two or three marks — and which
       * species a bed held was in the tooltip, which a phone never shows. The
       * painted icon is the thing you are actually growing, and the essence
       * still tints the tile behind it.
       */
      const essence = dominantEssence(getIngredient(tile.speciesId).essence);
      node.dataset.essence = essence;
      node.append(el('span', { class: 'cave-crop' }, [iconFor(tile.speciesId)]));
      node.append(el('span', { class: 'cave-growth' }, [meter(maturityOf(tile, sim.now))]));
      node.setAttribute(
        'aria-label',
        caveLabel(
          `${t(`ingredient.${tile.speciesId}`)} — ${
            mature ? t('cave.tile.ready') : t('cave.tile.growing')
          }`,
          tile,
        ),
      );
    } else {
      /*
       * An empty bed looks like a bed.
       *
       * Twelve unlit, unplanted beds were twelve black squares with nothing in
       * them and "Empty bed" in a tooltip: no way to tell a bed you can sow
       * from a hole in the page.
       */
      node.append(el('span', { class: 'cave-empty', 'aria-hidden': 'true', text: '+' }));
      node.setAttribute('aria-label', caveLabel(t('cave.tile.empty'), tile));
    }

    if (mature) node.dataset.ready = 'true';
    if (tile.lit) node.dataset.lit = 'true';
    if (tile.locked) node.dataset.locked = 'true';

    node.addEventListener('click', () => {
      if (caveTool === 'lantern') {
        sim.toggleCaveLantern(tile.index);
      } else if (caveTool === 'tray') {
        sim.toggleCaveTray(tile.index);
      } else if (mature) {
        const result = sim.harvestCaveTile(tile.index);
        if (result) toast(harvestToast([result], result.count, 0));
      } else if (!tile.speciesId && selectedSpecies) {
        if (!sim.seedCaveTile(tile.index, selectedSpecies)) toast(t('cave.noCluster'));
      }
      changed();
    });

    grid.append(node);
  }

  /*
   * Harvest all sits in the section head, where the Garden's does.
   *
   * It used to hang below the last bed, so on a phone picking the cave meant
   * scrolling past the twelve beds to reach the button that empties them. It
   * also only appeared at two ripe beds or more, which made a button that
   * comes and goes for no reason a player can see.
   */
  const ripe = sim.world.cave.tiles.filter((tile) => isMature(tile, sim.now)).length;
  body.append(
    el('section', { class: 'cave' }, [
      el('div', { class: 'stores-head' }, [
        el('span', { class: 'field-label', text: t('cave.grid') }),
        el('span', { class: 'field-note', text: t('cave.grid.hint') }),
        ...(ripe > 0
          ? [
              button(
                t('cave.harvestAll', { count: ripe }),
                () => {
                  const results = sim.harvestCave();
                  toast(harvestToast(results, results.reduce((s, r) => s + r.count, 0), 0));
                  changed();
                },
                { small: true, variant: 'good' },
              ),
            ]
          : []),
      ]),
      grid,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Shaft — you dig
// ---------------------------------------------------------------------------

function veinTitle(
  vein: ShaftVein,
  seen: Map<string, number>,
  ordinal: Map<string, number>,
): string {
  const name = t(`ingredient.${vein.ingredientId}`);
  if ((seen.get(vein.ingredientId) ?? 0) < 2) return name;
  const nth = (ordinal.get(vein.ingredientId) ?? 0) + 1;
  ordinal.set(vein.ingredientId, nth);
  return t('shaft.seam', { name, nth });
}

function renderShaft(sim: Simulation, body: HTMLElement): void {
  const shaft = sim.shaft;

  body.append(
    el('section', { class: 'shaft-head' }, [
      stat(t('shaft.depth'), t('shaft.metres', { depth: shaft.depth })),
      stat(t('shaft.supported'), t('shaft.metres', { depth: shaft.supportedDepth })),
      /*
       * The reason rides beside the button it greys out.
       *
       * It used to be a note on its own line below, which on a wide panel put
       * "buy support beams" at the far left and the dead button at the far
       * right — two facts about the same thing, a window apart.
       */
      el('div', { class: 'row-actions' }, [
        ...(sim.canDeepenShaft()
          ? []
          : [el('span', { class: 'field-note', text: t('shaft.needBeams') })]),
        button(
          t('shaft.deepen', { step: shaftConfig.depthStep }),
          () => {
            if (sim.deepenShaft()) {
              toast(t('shaft.deepened', { depth: sim.shaft.depth }));
              changed();
            }
          },
          { disabled: !sim.canDeepenShaft(), small: true },
        ),
      ]),
    ]),
  );

  const strata = veinsByDepth(sim.world);
  if (strata.length === 0) {
    body.append(emptyState(t('shaft.empty'), t('shaft.empty.hint')));
    return;
  }

  for (const group of strata) {
    /*
     * A stratum can roll the same ingredient twice, and two rows both reading
     * "Cloud Jasper" with their own sizes and their own Work it are two seams
     * you cannot tell apart. Number them, but only when there is more than one.
     */
    const seen = new Map<string, number>();
    for (const vein of group.veins) {
      seen.set(vein.ingredientId, (seen.get(vein.ingredientId) ?? 0) + 1);
    }
    const ordinal = new Map<string, number>();

    const rows = group.veins.map((vein) => {
      const working = shaft.workingVeinId === vein.id;
      const workable = isWorkable(vein, sim.now);
      const node = el('div', { class: 'vein' });
      if (working) node.dataset.working = 'true';

      const status = working
        ? t('shaft.working', {
            time: formatDuration(Math.max(0, (vein.nextBatchAt ?? sim.now) - sim.now)),
          })
        : vein.remaining > 0
          ? t('shaft.idle')
          : t('shaft.refilling', {
              time: formatDuration(Math.max(0, (vein.refillsAt ?? sim.now) - sim.now)),
            });

      node.append(
        el('span', { class: 'plot-icon' }, [iconFor(vein.ingredientId)]),
        el('div', { class: 'plot-main' }, [
          el('span', { class: 'plot-title', text: veinTitle(vein, seen, ordinal) }),
          el('div', { class: 'row-sub' }, [
            chip(t('shaft.remaining', { count: vein.remaining, size: vein.size })),
            chip(status, working ? 'good' : 'plain'),
          ]),
          meter(vein.size > 0 ? vein.remaining / vein.size : 0),
        ]),
        working
          ? button(t('shaft.stop'), () => {
              sim.stopVein();
              changed();
            }, { variant: 'quiet', small: true })
          : button(
              t('shaft.work'),
              () => {
                if (sim.workVein(vein.id)) changed();
              },
              { small: true, disabled: !workable },
            ),
      );
      return node;
    });

    body.append(
      el('section', { class: 'stratum' }, [
        el('span', { class: 'field-label', text: t('shaft.atDepth', { depth: group.depth }) }),
        ...rows,
      ]),
    );
  }
}
