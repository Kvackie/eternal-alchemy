/**
 * Settings — its own screen, not a corner of the Ledger.
 *
 * Text scaling and save management are things you change about the game, not
 * things the game did. Keeping them here means the Ledger can be a document and
 * this can be a control panel.
 */

import {
  button,
  clear,
  el,
  modal,
  outcomeCard,
  panelHeader,
  splitOnValue,
  toggleSwitch,
  VALUE_MARK,
} from '../components';
import { debugEnabled, setDebugEnabled } from '@/platform/debugFlag';
import { formatGold, formatNumber, t } from '@/i18n';
import { prestigeConfig } from '@/sim/config';
import type { CodexNodeDef, TownDef } from '@/sim/config';
import { canBuyCodex, codexCost, codexTier } from '@/sim/prestige';
import { freshSeed } from '@/sim/rng';
import type { SaveManager } from '@/platform/save';
import type { Simulation } from '@/sim/sim';
import type { World } from '@/sim/types';
import { bus, changed, confirm, toast } from '@/ui/bus';
import { credits } from '@/ui/credits';
import { iconSvg } from '@/ui/icons';

export interface SettingsDeps {
  sim: Simulation;
  saves: SaveManager;
  uiScale: number;
  setUiScale: (scale: number) => void;
  onImport: (world: World) => void;
  onNewGame: () => void;
}

const SCALES = [0.85, 1, 1.15, 1.3, 1.5];

export function renderSettings(deps: SettingsDeps): HTMLElement {
  const body = el('div', { class: 'panel-body' });

  body.append(
    el('section', { class: 'setting' }, [
      el('span', { class: 'field-label', text: t('settings.textSize') }),
      el('span', { class: 'field-note', text: t('settings.textSize.hint') }),
      el(
        'div',
        { class: 'options' },
        SCALES.map((scale) => {
          const node = el('button', { class: 'option', type: 'button' }, [
            el('span', { text: `${Math.round(scale * 100)}%` }),
          ]);
          node.setAttribute('aria-pressed', String(Math.abs(deps.uiScale - scale) < 0.001));
          node.addEventListener('click', () => deps.setUiScale(scale));
          return node;
        }),
      ),
    ]),
  );

  body.append(
    el('section', { class: 'setting' }, [
      el('span', { class: 'field-label', text: t('settings.save') }),
      el('span', { class: 'field-note', text: t('settings.save.local') }),
      el('div', { class: 'row-actions left' }, [
        button(
          t('settings.save.export'),
          () => {
            const started = exportSave(deps.saves.export(deps.sim.world));
            toast(t(started ? 'settings.save.exported' : 'settings.save.exportFailed'));
          },
          { variant: 'ghost', small: true },
        ),
        // Its own press rather than a fallback the download could not reach —
        // see `exportSave` — and the one route out of a viewer that blocks it.
        button(
          t('settings.save.copy'),
          () => {
            void copySave(deps.saves.export(deps.sim.world)).then((copied) =>
              toast(t(copied ? 'settings.save.copied' : 'settings.save.copyFailed')),
            );
          },
          { variant: 'ghost', small: true },
        ),
        button(
          t('settings.save.import'),
          () => {
            importSave((text) => {
              const world = deps.saves.import(text);
              if (!world) {
                toast(t('settings.save.failed'));
                return;
              }
              deps.onImport(world);
            });
          },
          { variant: 'quiet', small: true },
        ),
      ]),
    ]),
  );

  body.append(renderCodex(deps));

  /*
   * The debug panel, and the only way to ask for it.
   *
   * There was a `?debug=1` query flag as well, from before this switch existed.
   * One setting with two ways to set it is a thing that can disagree with
   * itself — and it did: the flag was re-read on every render and put the
   * switch straight back on.
   */
  body.append(
    el('section', { class: 'setting' }, [
      el('span', { class: 'field-label', text: t('settings.debug') }),
      el('span', { class: 'field-note', text: t('settings.debug.hint') }),
      toggleSwitch({
        label: t(debugEnabled() ? 'settings.debug.on' : 'settings.debug.off'),
        on: debugEnabled(),
        onChange: (on) => {
          setDebugEnabled(on);
          bus.emit({ type: 'debug', enabled: on });
        },
      }),
    ]),
  );

  body.append(
    el('section', { class: 'setting' }, [
      el('span', { class: 'field-label', text: t('settings.newGame') }),
      el('span', { class: 'field-note', text: t('settings.newGame.hint') }),
      el('div', { class: 'row-actions' }, [
        button(t('settings.newGame.action'), () => confirmNewGame(deps.onNewGame), {
          variant: 'warm',
          small: true,
        }),
      ]),
    ]),
  );

  body.append(
    el('section', { class: 'setting' }, [
      el('span', { class: 'field-label', text: t('settings.credits') }),
      el('span', { class: 'field-note', text: t('settings.credits.hint') }),
      el('div', { class: 'row-actions left' }, [
        button(t('settings.credits.action'), openCredits, { variant: 'quiet', small: true }),
      ]),
    ]),
  );

  // Nothing to see behind it, so it sits in the middle rather than docked right.
  return el('div', { class: 'panel panel-roomy settings-panel' }, [
    panelHeader(t('settings.title')),
    body,
  ]);
}

/**
 * The Mastery Codex and the Long Distillation.
 *
 * Lives here rather than on its own screen because it is a thing you do
 * *between* runs, not during one — and because it sits next to the other
 * irreversible button, where a player already reads carefully.
 */
function renderCodex(deps: SettingsDeps): HTMLElement {
  const { sim } = deps;
  const section = el('section', { class: 'setting codex' });

  const cards = prestigeConfig.codex.map((node) => codexCard(deps, node));

  // The purse of Mastery lives in the HUD now, beside gold and renown — it is a
  // currency, and a currency belongs where the other currencies are counted.
  section.append(
    el('span', { class: 'field-label', text: t('codex.title') }),
    el('div', { class: 'codex-grid' }, cards),
  );

  /*
   * Everywhere but here.
   *
   * Branching to the town you already live in is a reset with nothing on the
   * other side of it — same modifiers, same shop, one run gone. And because the
   * choice outlives a single render, it has to be dropped when it stops being
   * offered: retiring into Cinderhold would otherwise leave Cinderhold selected
   * in the shop you now run there, with the button live and pointing home.
   */
  const choices = prestigeConfig.towns.filter((town) => town.id !== sim.world.townId);
  if (chosenTown !== null && !choices.some((town) => town.id === chosenTown)) chosenTown = null;

  // Retirement is offered only at the top, and never without the numbers.
  if (sim.canRetire) {
    section.append(
      outcomeCard({
        name: t('prestige.title'),
        body: [
          el('span', { class: 'field-note', text: t('prestige.body') }),
          /*
           * One sentence, not a label with the number pushed to the far margin.
           *
           * A `stat` line puts the figure against the opposite edge of the panel,
           * which reads as a table of many rows — and this is the only row. Said
           * as a sentence, the number stays where the eye already is.
           */
          el(
            'p',
            { class: 'prestige-earns' },
            splitOnValue(
              t('prestige.earns', { count: VALUE_MARK }),
              el('span', { class: 'mastery num' }, [
                // Placeholder until the medal art lands.
                el('span', { class: 'mastery-mark', html: iconSvg('mastery', 14) }),
                formatNumber(sim.masteryOnRetire()),
              ]),
            ),
          ),
          el('div', { class: 'field prestige-towns' }, [
            el(
              'div',
              { class: 'options' },
              choices.map((town) => {
                const node = el('button', { class: 'option', type: 'button' }, [
                  el('span', { text: t(`town.${town.id}`) }),
                  el('small', { text: t(`town.${town.id}.blurb`) }),
                  // Spans, not a list: a button may only hold phrasing content,
                  // and a <ul> inside one is invalid however well it renders.
                  el(
                    'span',
                    { class: 'town-effects' },
                    townEffectLines(town.effects).map((line) => {
                      const item = el('small', { text: line.text });
                      item.dataset.tone = line.tone;
                      return item;
                    }),
                  ),
                ]);
                node.setAttribute('aria-pressed', String(chosenTown === town.id));
                node.addEventListener('click', () => {
                  chosenTown = town.id;
                  changed();
                });
                return node;
              }),
            ),
          ]),
          // Gold, and centred: opening a branch is the thing this section is for,
          // and it is a reward, not a hazard. Warm red read as "are you sure?".
          el('div', { class: 'row-actions center' }, [
            button(t('prestige.retire'), () => confirmRetire(deps, chosenTown), {
              variant: 'gold',
              disabled: chosenTown === null,
            }),
          ]),
        ],
      }),
    );
  } else {
    section.append(el('span', { class: 'field-note', text: t('prestige.locked') }));
  }

  return section;
}

/**
 * One Codex node.
 *
 * Every card is the same four rows — glyph, name, stars, cost — laid on a grid
 * rather than stacked, so a two-line name pushes nothing down. The stars and the
 * price sit on the same line across the whole board, which is what makes eight
 * of these readable as a set instead of eight separate labels.
 */
function codexCard(deps: SettingsDeps, node: CodexNodeDef): HTMLElement {
  const { sim } = deps;
  const tier = codexTier(sim.world, node.id);
  const maxed = tier >= node.tiers;

  // The stars take the glyph's place at the top: a decorative ✦ and a row of
  // tier stars in the same card were two star shapes saying different things.
  const card = el('button', { class: 'codex-card', type: 'button' }, [
    codexStars(tier, node.tiers),
    el('span', { class: 'codex-name', text: t(`codex.${node.id}`) }),
    maxed
      ? el('span', { class: 'codex-cost is-maxed', text: t('codex.maxed') })
      : el('span', { class: 'codex-cost mastery' }, [
          el('span', { class: 'mastery-mark', html: iconSvg('mastery', 14) }),
          formatNumber(codexCost(node.id, tier)),
        ]),
  ]);

  /*
   * Always clickable, even when maxed or unaffordable.
   *
   * The click no longer spends anything — it opens the description — so
   * disabling it would only stop a player reading what they are saving toward,
   * which is exactly when they most want to read it.
   */
  // No tooltip: the stars are the picture of this and carry the same words as
  // their label, and the card opens a dialog that writes it out in full.
  card.addEventListener('click', () => openCodex(deps, node));
  return card;
}

/** Tier as a row of stars: one drawn per level, the rest left as outlines. */
function codexStars(tier: number, total: number): HTMLElement {
  const row = el('span', {
    class: 'codex-stars',
    role: 'img',
    'aria-label': t('codex.tierOf', { tier, total }),
  });
  for (let i = 0; i < total; i += 1) {
    const star = el('span', { text: i < tier ? '★' : '☆', 'aria-hidden': 'true' });
    star.dataset.filled = String(i < tier);
    row.append(star);
  }
  return row;
}

/**
 * Read the node, then decide.
 *
 * Buying used to happen on the tile's own click, with the effect legible only as
 * a tooltip — so a tap spent Mastery on something you could not have read on a
 * touch screen at all. The description is the screen now, and the purchase is a
 * second, deliberate press.
 */
function openCodex(deps: SettingsDeps, node: CodexNodeDef): void {
  const { sim } = deps;
  const dialog = el('div', { class: 'codex-card' });

  /*
   * Closing is what tells the board to redraw.
   *
   * The modal lives on the stage now rather than inside the panel container, so
   * a redraw can no longer delete it mid-purchase — but the board behind it
   * still only needs repainting once, on the way out. The HUD's Mastery counts
   * down live regardless, because the shell redraws that every frame.
   */
  const dismiss = modal({ content: () => [dialog], onClose: changed });

  const paint = () => {
    const tier = codexTier(sim.world, node.id);
    const maxed = tier >= node.tiers;
    const cost = codexCost(node.id, tier);

    clear(dialog);
    dialog.append(
      el('h2', { text: t(`codex.${node.id}`) }),
      el('p', { text: t(`codex.${node.id}.detail`) }),
      el('div', { class: 'codex-buffs' }, codexBuffs(node, tier)),
      el('div', { class: 'codex-tier' }, [
        codexStars(tier, node.tiers),
        el('span', { class: 'field-note', text: t('codex.tierOf', { tier, total: node.tiers }) }),
      ]),
      // No price on a node with nothing left to sell: "Cost: Fully studied" is
      // a row that exists only to say the row does not apply.
      ...(maxed
        ? [el('p', { class: 'codex-price is-maxed', text: t('codex.maxed') })]
        : [
            el('p', { class: 'codex-price' }, [
              el('span', { class: 'field-label', text: t('codex.costLabel') }),
              el('span', { class: 'mastery' }, [
                el('span', { class: 'mastery-mark', html: iconSvg('mastery', 14) }),
                t('codex.cost', { cost }),
              ]),
            ]),
          ]),
      el('div', { class: 'dialog-actions' }, [
        button(t('common.close'), dismiss, { variant: 'quiet' }),
        ...(maxed
          ? []
          : [
              /*
               * The dialog survives the purchase.
               *
               * Six tiers bought one at a time meant six trips through the same
               * card, and the numbers a player is comparing — what they own now
               * against what the next level costs — are exactly the ones that
               * just moved. Repainting in place shows the change where they are
               * already looking.
               */
              button(
                t('codex.buy'),
                () => {
                  if (sim.buyCodex(node.id)) paint();
                },
                { variant: 'gold', disabled: !canBuyCodex(sim.world, node.id) },
              ),
            ]),
      ]),
    );
  };

  // `modal` has already mounted the card; this fills it, and every later
  // purchase repaints the same node in place.
  paint();
}

/**
 * What a node grants, in numbers.
 *
 * The blurb says Green Thumb makes things grow faster; it does not say by how
 * much, and a player deciding whether to spend twelve Mastery is asking exactly
 * that.
 * Each line reads "what you have now → what the next level makes it", drawn from
 * the same `effect` object the simulation folds, so it cannot drift from it.
 */
function codexBuffs(node: CodexNodeDef, tier: number): HTMLElement[] {
  const maxed = tier >= node.tiers;

  return Object.entries(node.effect)
    .filter(([, per]) => typeof per === 'number' && per !== 0)
    .map(([key, per]) => {
      const step = per as number;
      const format = BUFF_FORMAT[key] ?? ((value: number) => formatNumber(value));
      const value = el('span', { class: key === 'startingGold' ? 'gold num' : 'num' });

      if (tier > 0) value.append(format(step * tier));
      if (tier > 0 && !maxed) value.append(el('span', { class: 'codex-arrow', text: ' → ' }));
      if (!maxed) value.append(format(step * (tier + 1)));

      return el('div', { class: 'codex-buff' }, [
        el('span', { class: 'codex-buff-label', text: t(`codex.effect.${key}`) }),
        value,
      ]);
    });
}

/**
 * How each effect reads as a figure.
 *
 * Units live here rather than in `en.json` because they are attached to the
 * number, not to the sentence: a translator changes "Starting depth", not the
 * metre sign after the digits.
 */
const BUFF_FORMAT: Record<string, (total: number) => string> = {
  // Stored as a negative step against grow time, so it is a reduction.
  timerMultiplier: (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`,
  oreBatchBonus: (v) => `+${formatNumber(v)}`,
  startingDepthBonus: (v) => `+${formatNumber(v)}m`,
  startingMerchantTier: (v) => `+${formatNumber(v)}`,
  keptRecipes: (v) => formatNumber(v),
  keptHeroes: (v) => formatNumber(v),
  startingGold: (v) => formatGold(v),
  startingRenown: (v) => `+${formatNumber(v)}`,
};

/**
 * What a town actually does to a run, in sentences.
 *
 * These modifiers are the only reason the choice is a choice, and they were
 * nowhere on the screen — you picked between four blurbs. Written out from the
 * config rather than transcribed into prose, so retuning `prestige.json` can
 * never leave the description lying.
 *
 * Watch the direction of each multiplier: crop growth multiplies grow *time*,
 * so below 1 is the faster town, while ore, spread, payout and footfall all
 * multiply the yield, where above 1 is the better one.
 */
type EffectLine = { text: string; tone: 'good' | 'bad' | 'flat' };

function townEffectLines(effects: TownDef['effects']): EffectLine[] {
  const out: EffectLine[] = [];
  const percent = (value: number) => Math.round(Math.abs(1 - value) * 100);

  const say = (key: string, params: Record<string, string | number>, good: boolean) => {
    out.push({ text: t(key, params), tone: good ? 'good' : 'bad' });
  };

  const pair = (
    value: number | undefined,
    betterWhenHigher: boolean,
    higherKey: string,
    lowerKey: string,
  ) => {
    if (value === undefined || value === 1) return;
    const higher = value > 1;
    say(higher ? higherKey : lowerKey, { percent: percent(value) }, higher === betterWhenHigher);
  };

  pair(effects.cropGrowthMultiplier, false, 'town.effect.cropsSlower', 'town.effect.cropsFaster');
  // Literally the size of a batch, which is what the multiplier scales — the
  // vein still holds what it holds, so this is how fast it comes out, not how
  // much is down there. Anything grander would be overclaiming.
  pair(effects.oreBatchMultiplier, true, 'town.effect.oreBigger', 'town.effect.oreSmaller');
  pair(effects.caveSpreadMultiplier, true, 'town.effect.fungiFaster', 'town.effect.fungiSlower');
  pair(
    effects.merchantPriceMultiplier,
    false,
    'town.effect.pricesHigher',
    'town.effect.pricesLower',
  );
  pair(
    effects.contractPayoutMultiplier,
    true,
    'town.effect.contractsMore',
    'town.effect.contractsLess',
  );
  pair(effects.footfallMultiplier, true, 'town.effect.footfallMore', 'town.effect.footfallFewer');

  // Only ever more: a cave's tile array grows and never shrinks, so there is no
  // such thing as a town with fewer beds than the last one.
  const tiles = effects.caveTilesBonus ?? 0;
  if (tiles > 0) say('town.effect.caveTilesMore', { count: tiles }, true);

  const depth = effects.startingDepthBonus ?? 0;
  if (depth > 0) say('town.effect.depthDeeper', { depth }, true);

  // The baseline town has nothing to list, and a card with a blank space under
  // the blurb reads as a bug rather than as an answer. Flat, not green: "no
  // modifiers" is neither a gain nor a cost, and colouring it as a gain would
  // make the plainest town look like the best one.
  if (out.length === 0) out.push({ text: t('town.effect.none'), tone: 'flat' });

  return out;
}

let chosenTown: string | null = null;

function confirmRetire(deps: SettingsDeps, townId: string | null): void {
  if (!townId) return;
  confirm({
    title: t('prestige.confirmTitle'),
    body: t('prestige.confirmBody', { town: t(`town.${townId}`) }),
    confirm: t('prestige.retire'),
    onConfirm: () => {
      const result = deps.sim.retire(townId, freshSeed());
      if (result) deps.onImport(result.world);
    },
  });
}

/**
 * Starting over destroys a save with no undo, so it asks first.
 *
 * Through the shell's own question rather than the browser's `window.confirm`,
 * which blocks the whole tab — and through the same one every other
 * irreversible act in the game uses, rather than a second copy of it built
 * here out of a modal and two buttons.
 */
function confirmNewGame(onConfirm: () => void): void {
  confirm({
    title: t('settings.newGame.confirmTitle'),
    body: t('settings.newGame.confirmBody'),
    confirm: t('settings.newGame.action'),
    onConfirm,
  });
}

/**
 * Save the export as a file, and say whether a download was started.
 *
 * It fell back to the clipboard on failure, but the only thing that can fail
 * here is building the link: a viewer that blocks the download does it after
 * `click()` has returned, quietly, so the fallback never ran and "Save
 * downloaded" was said either way. Copying is a button of its own now, and
 * this only claims what it can see.
 */
function exportSave(text: string): boolean {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `eternal-alchemy-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** The export as text on the clipboard, and whether it got there. */
async function copySave(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function importSave(onLoaded: (text: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then(onLoaded);
  });
  input.click();
}

/**
 * The Credits page: every typeface, icon set and engine the game ships, who
 * made it, and the licence it is used under — the attribution those licences
 * ask for, somewhere a player can actually find it.
 */
function openCredits(): void {
  const link = (href: string, text: string) =>
    el('a', { href, text, target: '_blank', rel: 'noopener noreferrer' });

  modal({
    className: 'credits-dialog',
    content: (dismiss) => [
      el('h2', { text: t('credits.title') }),
      el('p', { text: t('credits.intro') }),
      ...credits().map((group) =>
        el('section', { class: 'credits-group' }, [
          el('span', { class: 'field-label', text: t(group.heading) }),
          ...group.credits.map((credit) =>
            el('div', { class: 'credit' }, [
              el('div', { class: 'credit-work' }, [
                el('strong', { text: credit.work }),
                el('span', { text: t('credits.by', { name: credit.by }) }),
              ]),
              ...(credit.detail
                ? [el('div', { class: 'credit-detail', text: credit.detail })]
                : []),
              el('div', { class: 'credit-links' }, [
                credit.licenceUrl
                  ? link(credit.licenceUrl, `${t('credits.licence')}: ${credit.licence}`)
                  : el('span', { text: `${t('credits.licence')}: ${credit.licence}` }),
                ...(credit.source ? [link(credit.source, t('credits.source'))] : []),
              ]),
            ]),
          ),
        ]),
      ),
      el('div', { class: 'dialog-actions' }, [
        button(t('common.close'), dismiss, { variant: 'quiet' }),
      ]),
    ],
  });
}
