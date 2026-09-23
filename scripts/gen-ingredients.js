/*
 * The ingredient set, and everything that follows from it.
 *
 * Every amount of essence in the game sits on one scale, and each kind of
 * ingredient comes from exactly one place. This script is where both rules
 * live. It declares the slots — which kinds hold which strengths and mixes —
 * and derives the rest from them: the garden's crops, the cave's species, the
 * quarry's strata, what expeditions bring back and what each merchant trades.
 *
 * `src/data/ingredients.json` stays the record of which id (and so which name
 * and picture) fills each slot. A slot with no ingredient yet is reported;
 * add an entry for it by hand — the category and essence the report gives,
 * and an id with a name in `src/i18n/en.json` — and run this again.
 *
 * Running it on unchanged data changes nothing.
 *
 *   node scripts/gen-ingredients.js            # report only
 *   node scripts/gen-ingredients.js --write    # rewrite the data files
 */
import { readFileSync, writeFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
const E = ['ignis', 'aqua', 'terra', 'aer', 'umbra'];

const read = (file) => JSON.parse(readFileSync(`src/data/${file}`, 'utf8'));
const written = [];
const write = (file, data) => {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (text === readFileSync(`src/data/${file}`, 'utf8')) return;
  written.push(file);
  if (WRITE) writeFileSync(`src/data/${file}`, text, 'utf8');
};

const combos = (size, from = 0) =>
  size === 0
    ? [[]]
    : E.slice(from).flatMap((e, i) => combos(size - 1, from + i + 1).map((rest) => [e, ...rest]));
const PAIRS = combos(2);
const TRIPLES = combos(3);
const QUADS = combos(4);

const vec = (parts) => Object.fromEntries(E.map((e) => [e, parts[e] ?? 0]));
const even = (set, amount) => vec(Object.fromEntries(set.map((e) => [e, amount])));
const total = (v) => E.reduce((sum, e) => sum + v[e], 0);
const dominant = (v) => E.reduce((best, e) => (v[e] > v[best] ? e : best), E[0]);

// ---------------------------------------------------------------- the slots

/*
 * The scale is 4, 6, 8, 10, 12, 16, 24, 32, 36 and 48. Every essence has a
 * clean ingredient at every step, split by source from weakest to strongest;
 * the mixes are built from the same numbers, some even and some lopsided.
 */
const slots = [];
for (const e of E) {
  for (const s of [4, 6, 8, 10]) slots.push(['herb', vec({ [e]: s })]);
  for (const s of [12, 16]) slots.push(['fungus', vec({ [e]: s })]);
  for (const s of [24, 32, 36]) slots.push(['mineral', vec({ [e]: s })]);
  slots.push(['exotic', vec({ [e]: 48 })]);
}
for (const [a, b] of PAIRS) {
  slots.push(['herb', vec({ [a]: 4, [b]: 4 })]);
  slots.push(['herb', vec({ [a]: 8, [b]: 4 })]);
  slots.push(['herb', vec({ [a]: 4, [b]: 8 })]);
}
for (const t of TRIPLES) slots.push(['herb', even(t, 4)]);
// Fungi: one lopsided pair per pair of essences, alternating the heavy side.
PAIRS.forEach(([a, b], i) => {
  const [heavy, light] = i % 2 === 0 ? [a, b] : [b, a];
  slots.push(['fungus', vec({ [heavy]: 12, [light]: 6 })]);
});
for (const t of TRIPLES) slots.push(['fungus', even(t, 6)]);
PAIRS.forEach(([a, b], i) => {
  slots.push(['mineral', vec({ [a]: 16, [b]: 16 })]);
  const [heavy, light] = i % 2 === 0 ? [b, a] : [a, b];
  slots.push(['mineral', vec({ [heavy]: 24, [light]: 12 })]);
});
for (const q of QUADS) slots.push(['mineral', even(q, 8)]);
for (const t of TRIPLES) slots.push(['exotic', even(t, 16)]);
for (const q of QUADS) slots.push(['exotic', even(q, 12)]);
slots.push(['exotic', even(E, 8)]);

// ---------------------------------------------------------- ingredients

const key = (category, v) => `${category}:${E.map((e) => v[e]).join(',')}`;
const existing = new Map(
  read('ingredients.json').map((ing) => [key(ing.category, ing.essence), ing]),
);

const missing = [];
const ingredients = [];
for (const [category, essence] of slots) {
  const found = existing.get(key(category, essence));
  existing.delete(key(category, essence));
  if (!found) {
    missing.push(`${category} ${JSON.stringify(essence)}`);
    continue;
  }
  ingredients.push({ id: found.id, category, essence });
}
if (missing.length > 0 || existing.size > 0) {
  for (const slot of missing) console.error(`no ingredient fills  ${slot}`);
  for (const ing of existing.values()) console.error(`fills no slot        ${ing.id}`);
  process.exit(1);
}
const ofKind = (category) => ingredients.filter((ing) => ing.category === category);
write('ingredients.json', ingredients);

// ---------------------------------------------------------------- crops

const SOIL = { ignis: 'ash', umbra: 'ash', aqua: 'silt', aer: 'silt', terra: 'loam' };
const crops = ofKind('herb').map((herb) => ({
  id: herb.id,
  yields: herb.id,
  growMs: 150_000 * total(herb.essence),
  yieldCount: 3,
  soil: SOIL[dominant(herb.essence)],
}));
crops[0] = {
  $comment:
    'Every herb grows, and nothing else does. Seeds come from merchants and expeditions, and back from harvests. Grow time follows strength: two and a half minutes per point of essence.',
  ...crops[0],
};
write('crops.json', crops);

// ---------------------------------------------------------------- the cave

const cave = read('cave.json');
const lightOf = new Map(cave.species.map((species) => [species.id, species.light]));
const LIGHT = ['lit', 'dark', 'any'];
cave.species = ofKind('fungus').map((fungus, k) => {
  const n = total(fungus.essence);
  return {
    id: fungus.id,
    growMs: 150_000 * n,
    spreadChance: Math.round((0.09 - 0.002 * n) * 1000) / 1000,
    // A species keeps the light it was given; a new one takes its turn.
    light: lightOf.get(fungus.id) ?? LIGHT[k % 3],
  };
});
write('cave.json', cave);

// ------------------------------------------------------------- the quarry

/*
 * A new mineral every five metres, weakest at the top, with the two above it
 * still turning up beside it.
 */
const shaft = read('shaft.json');
const byStrength = (a, b) =>
  total(a.essence) - total(b.essence) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const minerals = [...ofKind('mineral')].sort(byStrength);
shaft.strata = minerals.map((_, k) => ({
  id: `stratum${k + 1}`,
  minDepth: 5 * k,
  veins: [
    [0, 5],
    [1, 3],
    [2, 2],
  ]
    .filter(([back]) => k - back >= 0)
    .map(([back, weight]) => {
      const mineral = minerals[k - back];
      return {
        ingredientId: mineral.id,
        size: Math.max(4, 16 - Math.floor(k / 3)),
        batch: total(mineral.essence) <= 32 ? 2 : 1,
        weight,
      };
    }),
}));
write('shaft.json', shaft);

// ------------------------------------------------------------ expeditions

/*
 * Every expedition brings back its own corner of the book, by dominant
 * essence, and exotics above all. The deepest minerals are the quarry's own.
 * Ties between essences go to whichever biome has fewer finds so far.
 */
const heroes = read('heroes.json');
const BIOME = {
  ignis: 'emberwaste',
  aqua: 'mirefen',
  terra: 'sunkenBarrow',
  umbra: 'sunkenBarrow',
  aer: 'skyreachSpires',
};
const counts = new Map();
const home = (v) => {
  const top = Math.max(...E.map((e) => v[e]));
  const biomes = E.filter((e) => v[e] === top).map((e) => BIOME[e]);
  const count = (b) => counts.get(b) ?? 0;
  const pick = biomes.reduce((best, b) =>
    count(b) < count(best) || (count(b) === count(best) && b < best) ? b : best,
  );
  counts.set(pick, count(pick) + 1);
  return pick;
};

const loot = new Map();
const rare = new Map();
const add = (table, biome, entry) => {
  if (!table.has(biome)) table.set(biome, []);
  table.get(biome).push(entry);
};
const everyBiome = [...new Set(Object.values(BIOME))];
for (const ing of ingredients) {
  const v = ing.essence;
  if (ing.category === 'mineral' && total(v) > 24) continue;
  if (ing.category === 'exotic' && E.every((e) => v[e] === 8)) {
    // The five-way is the rare find everywhere.
    for (const biome of everyBiome)
      add(rare, biome, { ingredientId: ing.id, min: 1, max: 1, weight: 1 });
    continue;
  }
  const biome = home(v);
  if (ing.category === 'exotic') {
    add(loot, biome, { ingredientId: ing.id, min: 1, max: 2, weight: 6 });
    add(rare, biome, { ingredientId: ing.id, min: 1, max: 3, weight: 3 });
    continue;
  }
  add(loot, biome, { ingredientId: ing.id, min: 1, max: 3, weight: 1 });
  if (ing.category === 'herb') {
    add(loot, biome, { kind: 'seed', ingredientId: ing.id, min: 1, max: 2, weight: 1 });
  }
  if (ing.category === 'fungus') {
    add(loot, biome, { kind: 'spore', ingredientId: ing.id, min: 1, max: 2, weight: 1 });
  }
}
for (const biome of heroes.biomes) {
  biome.loot = loot.get(biome.id) ?? [];
  biome.rare = rare.get(biome.id) ?? [];
}
write('heroes.json', heroes);

// -------------------------------------------------------------- merchants

/*
 * One trade each. Only the trade goods are generated; everything else a
 * merchant carries — the staples — is left exactly as it is.
 */
const TRADE = new Set(['seed', 'spore', 'ingredient']);
const merchants = read('merchants.json');
const common = minerals.slice(0, 20);
const strong = minerals.slice(20);

const exoticGate = (ing) => {
  const parts = E.filter((e) => ing.essence[e] > 0).length;
  if (parts === 3) return { tier: 0, potions: 3, minGrade: 'C' };
  if (parts === 1) return { tier: 1, potions: 4, minGrade: 'B' };
  if (parts === 4) return { tier: 2, potions: 5, minGrade: 'B' };
  return { tier: 3, potions: 6, minGrade: 'A' };
};

const trades = {
  bramm: () =>
    [...ofKind('herb')].sort(byStrength).map((herb) => {
      const n = total(herb.essence);
      return {
        kind: 'seed',
        id: herb.id,
        price: 2 * n + 4,
        stock: 4,
        weight: 1,
        tier: n <= 6 ? 0 : n <= 8 ? 1 : 2,
      };
    }),
  vessa: () => [
    ...[...ofKind('fungus')].sort(byStrength).map((fungus) => {
      const n = total(fungus.essence);
      return {
        kind: 'spore',
        id: fungus.id,
        price: 2 * n + 8,
        stock: 3,
        weight: 1,
        tier: n <= 12 ? 0 : 1,
      };
    }),
    ...common.map((mineral) => {
      const n = total(mineral.essence);
      return {
        kind: 'ingredient',
        id: mineral.id,
        price: Math.round(1.5 * n),
        stock: 6,
        weight: 1,
        tier: n <= 24 ? 0 : 1,
      };
    }),
  ],
  hesk: () =>
    strong.map((mineral, k) => ({
      kind: 'ingredient',
      id: mineral.id,
      price: 2 * total(mineral.essence),
      stock: 4,
      weight: 1,
      tier: Math.floor((k * 3) / strong.length),
    })),
  ashwalker: () =>
    ofKind('exotic')
      .map((ing) => ({ ing, gate: exoticGate(ing) }))
      .sort((a, b) => a.gate.tier - b.gate.tier || (a.ing.id < b.ing.id ? -1 : 1))
      .map(({ ing, gate }) => ({
        kind: 'ingredient',
        id: ing.id,
        stock: 2,
        weight: 1,
        tier: gate.tier,
        barter: { potions: gate.potions, minGrade: gate.minGrade },
      })),
};
for (const merchant of merchants) {
  const trade = trades[merchant.id];
  if (!trade) continue;
  merchant.pool = [...merchant.pool.filter((entry) => !TRADE.has(entry.kind)), ...trade()];
}
write('merchants.json', merchants);

// ----------------------------------------------------------------- report

const byKind = Object.groupBy(ingredients, (ing) => ing.category);
console.log(
  `${ingredients.length} ingredients: ` +
    Object.entries(byKind)
      .map(([kind, list]) => `${list.length} ${kind}`)
      .join(', '),
);
console.log(
  `${crops.length} crops, ${cave.species.length} cave species, ${shaft.strata.length} strata to ${shaft.strata.at(-1).minDepth}m`,
);
console.log(
  written.length === 0
    ? 'Nothing to change.'
    : `${WRITE ? 'Wrote' : 'Would write'}: ${written.join(', ')}`,
);
if (!WRITE && written.length > 0) console.log('Dry run. Re-run with --write.');
