/**
 * Data coverage.
 *
 * This project's most persistent bug has one shape: a data file declares
 * something, the far end is never wired, and the game happily takes the
 * player's money for nothing. It has bitten five separate times — five pieces
 * of equipment, half the Codex, five vessel and seal fields, the soil on every
 * crop, and seven of the eight town modifiers that prestige exists to offer.
 *
 * Every one of those passed the test suite, because the tests measured
 * behaviour that was working and nothing asked the flat question: is this field
 * read by anything at all?
 *
 * These tests ask it. They are deliberately crude — string matching over the
 * source — because the failure they catch is crude, and a check that only works
 * when someone remembers to extend it is the thing that let these through.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '@/i18n/en.json';
import {
  crops,
  decorConfig,
  decorPieces,
  equipment,
  heroesConfig,
  ingredients,
  merchants,
  prestigeConfig,
  ranks,
  recipes,
  seals,
  vessels,
  contractsConfig,
  shaftConfig,
  caveConfig,
  customersConfig,
} from '@/sim/config';
import { angleBetween } from '@/sim/essences';
import type { EssenceVector } from '@/sim/types';

const DATA_DIR = join(process.cwd(), 'src', 'data');

function sourceText(): string {
  const parts: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== 'data') walk(full);
      } else if (entry.endsWith('.ts')) {
        parts.push(readFileSync(full, 'utf8'));
      }
    }
  })(join(process.cwd(), 'src'));
  return parts.join('\n');
}

/**
 * Fields that are legitimately not read by game code, with the reason.
 *
 * The bar for adding an entry is that the field earns its place some other way.
 * "We might use it later" is what an unread field always claims; if nothing
 * reads it and nothing documents it, it should be deleted instead.
 */
const ALLOWED_UNREAD: Record<string, string> = {
  // Weekday ids are looked up dynamically as `weekdayFootfall[day.weekday]`.
  hearthday: 'dynamic key into weekdayFootfall',
  marketday: 'dynamic key into weekdayFootfall',
  emberday: 'dynamic key into weekdayFootfall',
  stillday: 'dynamic key into weekdayFootfall',
  mireday: 'dynamic key into weekdayFootfall',
  templeday: 'dynamic key into weekdayFootfall',
  toilday: 'dynamic key into weekdayFootfall',

  // Grouping and art metadata, consumed by data-level checks below rather than
  // by game logic.
  tree: 'groups the upgrade trees; asserted consistent below',
  family: 'groups pitch actions; asserted consistent below',

  // Ceilings that no content can currently reach, kept as declared intent.
  maxPlots: 'upper bound on garden growth; asserted unreachable below',
  refreshDays: 'the board is kept full rather than refreshed on a timer',
};

describe('every data field reaches the game', () => {
  const code = sourceText();

  it('is read somewhere in src, or documented as deliberately unread', () => {
    const fields = new Map<string, Set<string>>();

    const collect = (value: unknown, file: string): void => {
      if (Array.isArray(value)) {
        for (const item of value) collect(item, file);
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          if (key.startsWith('$')) continue;
          if (!fields.has(key)) fields.set(key, new Set());
          fields.get(key)!.add(file);
          collect(inner, file);
        }
      }
    };

    /*
     * Generated art metadata is measured, not authored.
     *
     * `brewEffects.json` is written by art-build from the sprites themselves and
     * keyed by sprite id, which the scene builds at runtime as `brew${essence}`.
     * There is no literal `brewIgnis` anywhere in src to find, and adding one
     * would be worse code written to satisfy a test. Its VALUES are still
     * checked — `surfaceY` and `surfaceW` have to appear in the scene, and they
     * do.
     */
    const GENERATED = new Set(['artManifest.json', 'brewEffects.json']);

    for (const file of readdirSync(DATA_DIR)) {
      if (GENERATED.has(file)) continue;
      collect(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')), file);
    }

    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const unread: string[] = [];

    for (const [key, files] of fields) {
      if (key in ALLOWED_UNREAD) continue;
      // Counts as read if it appears as `.key`, `['key']`, `"key"` or `'key'`.
      const re = new RegExp('(\\.|\\[\'|\\["|\'|")' + escape(key) + '\\b');
      if (!re.test(code)) unread.push(`${key} (declared in ${[...files].join(', ')})`);
    }

    expect(
      unread,
      'these are declared in data and read by nothing — wire them, delete them, ' +
        'or add them to ALLOWED_UNREAD with a reason',
    ).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    // An entry that has since been wired up should leave the allowlist, so it
    // never becomes a place where real gaps hide.
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const key of Object.keys(ALLOWED_UNREAD)) {
      const re = new RegExp('(\\.|\\[\'|\\["|\'|")' + escape(key) + '\\b');
      if (key.endsWith('day')) continue; // dynamic keys never appear literally
      expect(re.test(code), `"${key}" is read now — take it out of ALLOWED_UNREAD`).toBe(false);
    }
  });
});

describe('every data id can be shown to a player', () => {
  const strings = en as Record<string, string>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(strings, key);

  it('names everything the game can put on screen', () => {
    const missing: string[] = [];
    const need = (key: string) => {
      if (!has(key)) missing.push(key);
    };

    for (const x of ingredients) need(`ingredient.${x.id}`);
    for (const x of crops) need(`crop.${x.id}`);
    for (const x of recipes) need(`recipe.${x.id}`);
    for (const x of vessels) need(`vessel.${x.id}`);
    for (const x of seals) need(`seal.${x.id}`);
    for (const x of ranks) need(`rank.${x.id}`);
    for (const x of caveConfig.species) need(`ingredient.${x.id}`);
    for (const x of heroesConfig.roster) need(`hero.${x.id}`);
    for (const x of heroesConfig.biomes) need(`biome.${x.id}`);
    for (const x of contractsConfig.factions) need(`faction.${x.id}`);
    for (const x of prestigeConfig.towns) {
      need(`town.${x.id}`);
      need(`town.${x.id}.blurb`);
    }
    for (const x of merchants) {
      need(`merchant.${x.id}`);
      // No blurb: the Market draws a trader's name and their tag, and nothing
      // reads a sentence of character about them any more.
      need(`merchant.${x.id}.tag`);
    }
    for (const x of equipment) {
      need(`equipment.${x.id}`);
      need(`equipment.${x.id}.detail`);
    }
    for (const x of decorPieces) {
      need(`decor.${x.id}`);
      need(`decor.${x.id}.detail`);
    }
    for (const spot of decorConfig.spots) need(`decor.spot.${spot}`);
    for (const node of prestigeConfig.codex) {
      need(`codex.${node.id}`);
      need(`codex.${node.id}.detail`);
    }

    // Without this, five upgrades sat in the market labelled "equipment.caveBeds".
    expect(missing, 'these would render as raw keys').toEqual([]);
  });
});

describe('the data that only documents itself still has to be true', () => {
  it('gives every upgrade a tree that groups something real', () => {
    const trees = new Set(equipment.map((def) => def.tree));
    for (const tree of trees) {
      expect(tree).toMatch(/^[a-z]+$/);
    }
    expect(trees.size).toBeGreaterThan(1);
  });

  it('keeps every pitch family to one counter and one backfire', () => {
    /*
     * The haggle docstring promises "each pitch family counters exactly one
     * stance and backfires against exactly one other". `family` is what makes
     * that a rule rather than a coincidence, so it has to hold.
     */
    const byFamily = new Map<string, { counters: Set<string>; backfires: Set<string> }>();
    for (const action of customersConfig.actions) {
      const entry =
        byFamily.get(action.family) ?? { counters: new Set(), backfires: new Set() };
      entry.counters.add(action.counters);
      entry.backfires.add(action.backfiresAgainst);
      byFamily.set(action.family, entry);
    }

    for (const [family, { counters, backfires }] of byFamily) {
      expect(counters.size, `family "${family}" counters more than one stance`).toBe(1);
      expect(backfires.size, `family "${family}" backfires against more than one stance`).toBe(1);
      expect(
        [...counters][0],
        `family "${family}" counters the stance it also backfires against`,
      ).not.toBe([...backfires][0]);
    }

    // And every stance has an answer, or a customer would be unbeatable.
    const answered = new Set([...byFamily.values()].map((entry) => [...entry.counters][0]));
    for (const stance of customersConfig.stances) {
      expect(answered.has(stance), `nothing counters a ${stance} customer`).toBe(true);
    }
  });

  it('never lets a faction outrank the contracts it posts', () => {
    for (const faction of contractsConfig.factions) {
      const templates = contractsConfig.templates.filter((t) => t.faction === faction.id);
      expect(templates.length, `faction ${faction.id} posts nothing`).toBeGreaterThan(0);
      for (const template of templates) {
        expect(
          template.requiresRank,
          `${template.id} is offered below its faction's own rank`,
        ).toBeGreaterThanOrEqual(faction.requiresRank);
      }
    }
  });

  /*
   * Every recipe must have somebody who wants it.
   *
   * Demand used to be one hand-authored line per recipe, and 63 of 71 recipes
   * had nobody at all — the back half of the book was decoration you could brew
   * and then only sell to the shelf. Palates fixed that, but a palate is a cone
   * and cones leave gaps: the Mirebloom Elixir sat in one, being murky water
   * that neither the clean-water nor the shadow palates would touch.
   *
   * So the property is asserted rather than hoped for. A new recipe that lands
   * in a gap fails here instead of shipping as content nobody can sell.
   */
  it('gives every recipe somebody who wants it', () => {
    const deg = (a: EssenceVector, b: EssenceVector) => (angleBetween(a, b) * 180) / Math.PI;

    for (const recipe of recipes) {
      const faction = contractsConfig.factions.find(
        (f) => deg(recipe.target, f.palate) < f.spreadDeg,
      );
      const customer = customersConfig.roster.find(
        (c) => c.wants.includes(recipe.id) || deg(recipe.target, c.palate) < c.spreadDeg,
      );
      const named = contractsConfig.templates.some((t) => t.recipeId === recipe.id);

      expect(
        Boolean(faction || customer || named),
        `nothing in the world wants ${recipe.id} — widen a palate or give it a template`,
      ).toBe(true);
    }
  });

  it('keeps the garden under its declared ceiling', () => {
    // maxPlots is a stated bound; the content has to stay inside it for the
    // bound to mean anything.
    const fromUpgrades = equipment.reduce(
      (sum, def) => sum + (def.effect.addPlots ?? 0) * (def.repeatable ?? 1),
      0,
    );
    expect(4 + fromUpgrades).toBeLessThanOrEqual(16);
  });
});

describe('the ingredient set', () => {
  const ESSENCE_KEYS = ['ignis', 'aqua', 'terra', 'aer', 'umbra'] as const;
  const SCALE = [4, 6, 8, 10, 12, 16, 24, 32, 36, 48];

  /*
   * One essence and nothing else, for every essence, at every step of the
   * scale. A clean single essence is what makes any ratio hittable: blending
   * only ever reaches the hull of what you hold, and a full set of clean
   * strengths is what turns balancing a ratio into arithmetic rather than luck.
   */
  it('has every essence on its own at every strength on the scale', () => {
    const missing: string[] = [];
    for (const essence of ESSENCE_KEYS) {
      for (const strength of SCALE) {
        const found = ingredients.some((ing) =>
          ESSENCE_KEYS.every((k) => ing.essence[k] === (k === essence ? strength : 0)),
        );
        if (!found) missing.push(`${essence} ${strength}`);
      }
    }
    expect(missing, 'no clean ingredient at these strengths').toEqual([]);
  });

  it('keeps every essence amount on the scale', () => {
    const off = ingredients.filter((ing) =>
      ESSENCE_KEYS.some((k) => ing.essence[k] > 0 && !SCALE.includes(ing.essence[k])),
    );
    expect(off.map((ing) => ing.id)).toEqual([]);
  });

  /*
   * Each kind comes from its own place: every herb grows in the garden, every
   * fungus in the cave, every mineral somewhere down the quarry, and every
   * exotic on an expedition.
   */
  it('gives every ingredient the source its kind promises', () => {
    const grown = new Set(crops.map((crop) => crop.yields));
    const spread = new Set(caveConfig.species.map((species) => species.id));
    const mined = new Set(shaftConfig.strata.flatMap((s) => s.veins.map((v) => v.ingredientId)));
    const found = new Set(
      heroesConfig.biomes.flatMap((b) =>
        [...b.loot, ...b.rare].filter((d) => (d.kind ?? 'ingredient') === 'ingredient').map((d) => d.ingredientId),
      ),
    );
    const source = { herb: grown, fungus: spread, mineral: mined, exotic: found } as const;
    const orphans = ingredients.filter((ing) => !source[ing.category].has(ing.id));
    expect(orphans.map((ing) => `${ing.category} ${ing.id}`)).toEqual([]);
  });

  it('brings the majority of ingredients back from expeditions', () => {
    const found = new Set(heroesConfig.biomes.flatMap((b) => [...b.loot, ...b.rare].map((d) => d.ingredientId)));
    expect(found.size / ingredients.length).toBeGreaterThan(0.5);
  });

  it('puts a new stratum every five metres', () => {
    expect(shaftConfig.depthStep).toBe(5);
    shaftConfig.strata.forEach((stratum, i) => expect(stratum.minDepth).toBe(i * 5));
  });
});

