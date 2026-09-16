/**
 * Grounds: the garden, the cave and the shaft under one screen.
 *
 * Three sub-tabs rather than three nav entries, because they are three answers
 * to the same question — where do ingredients come from — and because eight
 * top-level destinations is already one too many on a phone.
 *
 * Each keeps its own verb: the garden you plant, the cave you tend, the shaft
 * you dig.
 */

import {
  button,
  chip,
  el,
  ingredientIcon,
  makeDropTarget,
  meter,
  panelHeader,
  slot,
  slotGrid,
  stat,
} from '../components';
import { formatDuration, t } from '@/i18n';
import { showIngredientInfo } from '../ingredientInfo';
import { caveConfig, crops, getCrop, getIngredient, shaftConfig } from '@/sim/config';
import { canTend, isReady } from '@/sim/garden';
import { isMature, maturityOf } from '@/sim/cave';
import { previewCross } from '@/sim/greenhouse';
import { isWorkable, veinsByDepth } from '@/sim/shaft';
import { ESSENCES } from '@/sim/types';
import { essenceGlyphSvg } from '@/ui/theme';
import { dominantEssence } from '@/ui/phaser/placeholders';
import type { Plot } from '@/sim/types';
import type { Simulation } from '@/sim/sim';
import { changed, toast } from '@/ui/bus';

export const SEED_DRAG = 'application/x-eternal-seed';

type Tab = 'garden' | 'cave' | 'shaft';

let tab: Tab = 'garden';
let selectedCrop: string | null = null;
let selectedSpecies: string | null = null;
let caveTool: 'seed' | 'lantern' | 'tray' = 'seed';

export function setGroundsTab(next: Tab): void {
  tab = next;
}

export function renderGrounds(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body' });

  body.append(
    el(
      'div',
      { class: 'options tabs' },
      (['garden', 'cave', 'shaft'] as Tab[]).map((id) => {
        const node = el('button', { class: 'option', type: 'button' }, [
          el('span', { text: t(`grounds.tab.${id}`) }),
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

  if (tab === 'garden') renderGarden(sim, body);
  else if (tab === 'cave') renderCave(sim, body);
  else renderShaft(sim, body);

  return el('div', { class: 'panel' }, [
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
      : t('toast.harvestKinds', { kinds: kinds.size });

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

    const essences = strain
      ? ESSENCES.filter((e) => strain.essence[e] > 0)
          .map((e) => `${t(`essence.${e}.short`)} ${Math.round(strain.essence[e])}`)
          .join(' · ')
      : '';

    return slot({
      id,
      icon: iconFor(crop.yields),
      label,
      count,
      caption: formatDuration(growMs),
      selected: selectedCrop === id,
      dragType: SEED_DRAG,
      tone: strain ? 'good' : 'default',
      title: `${label}\n${t('garden.tip.seed', {
        time: formatDuration(growMs),
        soil: t(`soil.${crop.soil}`),
      })}${essences ? `\n${essences}` : ''}`,
      // What the seed will actually yield, which is the thing worth knowing
      // before spending a plot on it for half an hour.
      onInspect: () => showIngredientInfo(sim, crop.yields),
      onActivate: () => {
        selectedCrop = selectedCrop === id ? null : id;
        changed();
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

  const plots = el('section', { class: 'plots' }, [
    el('div', { class: 'stores-head' }, [
      el('span', { class: 'field-label', text: t('garden.plots') }),
      el('span', { class: 'field-note', text: t('garden.plots.hint') }),
    ]),
  ]);
  for (const plot of sim.world.plots) plots.append(renderPlot(sim, plot));
  body.append(plots);

  if (sim.hasGreenhouse) body.append(renderGreenhouse(sim));

  const ready = sim.world.plots.filter((plot) => isReady(plot, sim.now)).length;
  if (ready > 1) {
    body.append(
      el('div', { class: 'row-actions' }, [
        button(t('garden.action.harvestAll'), () => {
          const results = sim.harvestAll();
          const total = results.reduce((sum, r) => sum + r.count, 0);
          const seeds = results.reduce((sum, r) => sum + r.seeds, 0);
          toast(harvestToast(results, total, seeds));
          changed();
        }),
      ]),
    );
  }
}

/** Which crop a soil chip should judge itself against, if any is chosen. */
function soilChipFor(plot: Plot, cropId: string | null): HTMLElement {
  const wanted = cropId ? soilWantedBy(cropId) : null;
  // Marked good only when there is a crop to compare against, so an idle plot
  // never claims to suit something nobody picked.
  return chip(t(`soil.${plot.soil}`), wanted && wanted === plot.soil ? 'good' : 'plain');
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

    const canPlant = selectedCrop !== null && (sim.world.seeds[selectedCrop] ?? 0) > 0;
    // With a seed in hand the chip says whether this is the plot for it.
    const soil = soilChipFor(plot, selectedCrop);
    node.append(
      el('div', { class: 'plot-main' }, [
        el('span', { class: 'plot-title', text: t('garden.plot.empty') }),
        el('div', { class: 'row-sub' }, [soil, el('span', { text: t('garden.plot.emptyHint') })]),
      ]),
      button(
        t('garden.action.plant'),
        () => {
          if (selectedCrop && sim.plant(plot.id, selectedCrop)) changed();
        },
        { disabled: !canPlant, small: true },
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
  if (plot.crop.tended) sub.push(chip(t('garden.tended'), 'warn'));

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
  } else if (canTend(sim.world, plot.id)) {
    actions.push(
      button(
        t('garden.action.tend'),
        () => {
          if (sim.tend(plot.id)) changed();
        },
        { variant: 'ghost', small: true },
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
      caption: essences,
      selected: key === parentA || key === parentB,
      title: `${essences}${strain?.traits.length ? `\n${strain.traits.join(', ')}` : ''}`,
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
        onInspect: () => showIngredientInfo(sim, species.id),
        onActivate: () => {
          selectedSpecies = selectedSpecies === species.id ? null : species.id;
          caveTool = 'seed';
          changed();
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
        { class: 'options' },
        (['seed', 'lantern', 'tray'] as const).map((id) => {
          const node = el('button', { class: 'option', type: 'button' }, [
            el('span', { text: t(`cave.tool.${id}`) }),
            el('small', { text: t(`cave.tool.${id}.hint`) }),
          ]);
          node.setAttribute('aria-pressed', String(caveTool === id));
          node.addEventListener('click', () => {
            caveTool = id;
            changed();
          });
          return node;
        }),
      ),
    ]),
  );

  const grid = el('div', { class: 'cave-grid' });
  grid.style.setProperty('--cave-width', String(caveConfig.width));

  for (const tile of sim.world.cave.tiles) {
    const node = el('button', { class: 'cave-tile', type: 'button' });
    const mature = isMature(tile, sim.now);

    if (tile.speciesId) {
      const essence = dominantEssence(getIngredient(tile.speciesId).essence);
      node.dataset.essence = essence;
      node.append(el('span', { class: `essence-mark ${essence}`, html: essenceGlyphSvg(essence, 16) }));
      node.append(
        el('span', { class: 'cave-growth' }, [
          meter(maturityOf(tile, sim.now)),
        ]),
      );
      node.title = `${t(`ingredient.${tile.speciesId}`)}\n${
        mature ? t('cave.tile.ready') : t('cave.tile.growing')
      }`;
    } else {
      node.title = t('cave.tile.empty');
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

  body.append(
    el('section', { class: 'cave' }, [
      el('div', { class: 'stores-head' }, [
        el('span', { class: 'field-label', text: t('cave.grid') }),
        el('span', { class: 'field-note', text: t('cave.grid.hint') }),
      ]),
      grid,
    ]),
  );

  const mature = sim.world.cave.tiles.filter((tile) => isMature(tile, sim.now)).length;
  if (mature > 1) {
    body.append(
      el('div', { class: 'row-actions' }, [
        button(t('cave.harvestAll'), () => {
          const results = sim.harvestCave();
          toast(harvestToast(results, results.reduce((s, r) => s + r.count, 0), 0));
          changed();
        }),
      ]),
    );
  }
}

// ---------------------------------------------------------------------------
// Shaft — you dig
// ---------------------------------------------------------------------------

function renderShaft(sim: Simulation, body: HTMLElement): void {
  const shaft = sim.shaft;

  body.append(
    el('section', { class: 'shaft-head' }, [
      stat(t('shaft.depth'), t('shaft.metres', { depth: shaft.depth })),
      stat(t('shaft.supported'), t('shaft.metres', { depth: shaft.supportedDepth })),
      el('div', { class: 'row-actions' }, [
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
      ...(sim.canDeepenShaft()
        ? []
        : [el('span', { class: 'field-note', text: t('shaft.needBeams') })]),
    ]),
  );

  for (const group of veinsByDepth(sim.world)) {
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
          el('span', { class: 'plot-title', text: t(`ingredient.${vein.ingredientId}`) }),
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
