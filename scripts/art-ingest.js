/*
 * Turn the art folder into game data.
 *
 * 144 hand-drawn icons is more than anyone wants to hand-author, so the shape of
 * each ingredient is derived: direction from the sprite's own colour (see
 * art-essence.js), magnitude from its tier, and its SOURCE from what it plainly
 * is. A mushroom belongs in the cave, a berry in the garden, a monster's bone in
 * a hero's pack.
 *
 * The source assignment is the part that matters. An ingredient nobody can
 * gather is the bug this project keeps re-learning, so every id this emits lands
 * in exactly one of: a cave species, a garden crop, a biome loot table, or a
 * merchant's stock.
 *
 *   node scripts/art-ingest.js            # report only
 *   node scripts/art-ingest.js --write    # rewrite the data files
 */
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const DATA = 'src/data';
const read = (f) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));

/**
 * Write via a temp file and rename.
 *
 * A plain `writeFileSync` truncates before it writes, so a crash between the two
 * leaves an empty file — which is exactly how `heroes.json` was lost, and this
 * project has no version control to restore it from. Rename is atomic, so the
 * old file survives intact until the new one is complete.
 */
function writeJson(name, value) {
  const target = path.join(DATA, name);
  const temp = `${target}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(temp, target);
}

// PowerShell redirects write a BOM; strip it rather than depend on the shell.
// Written as an escape, not a literal, so no editor round-trip can mangle it.
const proposal = JSON.parse(
  readFileSync(process.argv[2] ?? 'art/essence.json', 'utf8').replace(/^\uFEFF/, ''),
);
const files = readdirSync('art/ingredients')
  .filter((f) => /\.png$/i.test(f))
  .map((f) => f.replace(/\.png$/i, ''))
  .sort();

/**
 * The hand-authored core, whose numbers were tuned against the recipe book.
 *
 * Everything else in the data files is derived from art and rebuilt on every
 * run, so re-running after a change to the derivation corrects the world rather
 * than appending a second copy of it.
 */
const ORIGINAL_IDS = new Set([
  'emberroot', 'sunleaf', 'galeThistle', 'moonpetal', 'ashfern',
  'dewcap', 'gravecrown', 'chalkgill',
  'chalkNodule', 'emberstone', 'deepglass', 'nullstone',
  'salamanderScale', 'mirefenPearl', 'barrowAsh', 'skyreachFeather',
  'cinderwraithAsh', 'quicksilverTear',
]);

const existing = read('ingredients.json').filter((i) => ORIGINAL_IDS.has(i.id));
const existingIds = new Set(existing.map((i) => i.id));

/**
 * Art for ingredients that already existed.
 *
 * These keep their ids and their hand-tuned essence vectors — recipes, contracts,
 * cave species, shaft strata and four biome loot tables all point at them, and
 * re-deriving their numbers from a sprite would quietly re-balance the game. They
 * only gain a picture.
 */
const ADOPTED = JSON.parse(readFileSync('art/adopted.json', 'utf8')).adopted;
const adoptedArt = new Set(Object.values(ADOPTED));

/** Fungi go to the cave. Named from the two mushroom packs. */
const FUNGI = new Set([
  'ambercap', 'mosscap', 'flamefan', 'honeycap', 'glowspindle', 'loamcap', 'puffnest',
  'bubblecap', 'tubefungus', 'spotcap', 'sunfungus', 'buttercap', 'eyecap', 'azurecap',
  'violetcap', 'goldcap', 'russetcap', 'crimsoncap',
  'cellarcap', 'mosstier', 'toadstool', 'trumpetgill', 'stoutcap', 'palecap',
  'verdigriscap', 'coalcap', 'tieredcap', 'poisonCap', 'witchCap', 'poffpuffBall',
]);

/** Things a hero brings back rather than things you grow. */
const WILD = /fern|frond|grass|leaf|moss|vine|weed|sprig|coil|curl|whorl|thicket|tussock|bough|branch|spike|ribbon|blade|plume|cleft|saw|maple|fiddlehead|hairroot|scroll|coral|kelp/i;
const MONSTROUS = /monster|dragon|griffin|spectral|void|vampir|blood|angler|magma|shrimp|eel|bone|egg|meat|glow|mana|magic|unique|rare/i;
const AQUATIC = /algae|seagrass|shrimp|jelly|coral|angler|magma|ice|eel|tide|azure|bubble|cotton|frost/i;

/**
 * Gems, named by `art-minerals.js` as <essence><gemNoun>.
 *
 * These are the shaft's whole reason to exist. Minerals are `stable` — no
 * freshness, no decay — and dense, which makes them the precise instrument for
 * hitting a ratio that herbs can only approximate.
 */
const MINERAL =
  /(quartz|beryl|opal|garnet|spar|geode|shard|crystal|prism|glass|stone|agate|jasper|onyx|topaz)$/i;

function categoryOf(id) {
  if (MINERAL.test(id)) return 'mineral';
  if (FUNGI.has(id)) return 'fungus';
  if (MONSTROUS.test(id)) return 'exotic';
  if (WILD.test(id)) return 'wild';
  return 'crop';
}

/**
 * Which biome a wild or exotic find comes from, by what it is made of.
 *
 * Terra is the largest bucket by far, and sending all of it to one biome left
 * the barrow with thirty finds and the Spires with two. Green things grow
 * everywhere, so they are dealt round instead — every biome stays worth visiting.
 */
const EVERYWHERE = ['sunkenBarrow', 'emberwaste', 'skyreachSpires', 'mirefen'];
let dealt = 0;

function biomeOf(id, dominant) {
  if (AQUATIC.test(id)) return 'mirefen';
  if (dominant === 'ignis') return 'emberwaste';
  if (dominant === 'umbra') return 'sunkenBarrow';
  if (dominant === 'aer') return 'skyreachSpires';
  if (dominant === 'aqua') return 'mirefen';
  dealt += 1;
  return EVERYWHERE[dealt % EVERYWHERE.length];
}

/**
 * Tier from how strange the name sounds, which is a proxy for how rare the art
 * looks. Magnitude follows tier, so a common weed is weak and a griffin feather
 * is not — the direction is the art's, the strength is the design's.
 */
function tierOf(id) {
  if (/common|weed|grass|acorn|leaf|dandelion|berry(?!Thistle)/i.test(id)) return 0;
  if (MONSTROUS.test(id) || /unique|rare|spectral|dragon|griffin/i.test(id)) return 2;
  return 1;
}

const SCALE = [16, 24, 34];

const added = [];
const skipped = [];

for (const id of files) {
  if (adoptedArt.has(id)) continue; // art claimed by an existing ingredient
  if (existingIds.has(id)) continue;

  const p = proposal[id];
  if (!p || !p.vector) {
    skipped.push(`${id} (no usable colour — fully opaque or empty)`);
    continue;
  }

  const tier = tierOf(id);
  /*
   * Minerals carry noticeably more essence per unit than herbs. That is the
   * whole trade the design rests on: herbs are cheap and perishable, stone is
   * expensive and eternal, and a large cauldron needs both to hit a ratio
   * without blowing it.
   */
  const dense = MINERAL.test(id);
  const magnitude = Math.round(SCALE[tier] * (dense ? 1.6 : 1));
  const sum = Object.values(p.vector).reduce((a, b) => a + b, 0) || 1;

  const essence = { ignis: 0, aqua: 0, terra: 0, aer: 0, umbra: 0 };
  for (const [k, v] of Object.entries(p.vector)) {
    essence[k] = Math.round((v / sum) * magnitude);
  }
  if (Object.values(essence).every((v) => v === 0)) essence[p.dominant] = magnitude;

  const category = categoryOf(id);
  const traits = category === 'mineral' ? ['stable'] : tier === 2 ? ['pure'] : [];

  added.push({
    id,
    category:
      category === 'fungus'
        ? 'fungus'
        : category === 'mineral'
          ? 'mineral'
          : category === 'exotic'
            ? 'exotic'
            : 'herb',
    essence,
    traits,
    baseValue: Math.max(3, Math.round(magnitude * (0.5 + tier * 0.45))),
    glyph:
      category === 'fungus'
        ? 'fungus'
        : category === 'mineral'
          ? 'mineral'
          : category === 'crop'
            ? 'leaf'
            : 'root',
    _source: category,
    _biome: biomeOf(id, p.dominant),
    _tier: tier,
    _dominant: p.dominant,
  });
}

// ---------------------------------------------------------------- report

const bySource = {};
const byDominant = {};
for (const a of added) {
  bySource[a._source] = (bySource[a._source] ?? 0) + 1;
  byDominant[a._dominant] = (byDominant[a._dominant] ?? 0) + 1;
}

console.log(`art files:          ${files.length}`);
console.log(`adopted by existing:${adoptedArt.size}`);
console.log(`new ingredients:    ${added.length}`);
console.log(`skipped:            ${skipped.length}`);
if (skipped.length) for (const s of skipped) console.log(`   ${s}`);

console.log('\nby source:');
for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k.padEnd(8)} ${v}`);
}
console.log('\nby dominant essence:');
for (const k of ['ignis', 'aqua', 'terra', 'aer', 'umbra']) {
  console.log(`   ${k.padEnd(8)} ${byDominant[k] ?? 0}`);
}

if (!WRITE) {
  console.log('\nReport only. Re-run with --write to emit data.');
  process.exit(0);
}

// ---------------------------------------------------------------- emit

const stripped = added.map(({ _source, _biome, _tier, _dominant, ...keep }) => keep);
writeJson('ingredients.json', [...existing, ...stripped]);

// Cave species: light preference follows essence — shadow wants dark, air and
// water want light, everything else does not mind.
const cave = read('cave.json');
cave.species = cave.species.filter((s) => ORIGINAL_IDS.has(s.id));
const caveIds = new Set(cave.species.map((s) => s.id));
for (const a of added.filter((x) => x._source === 'fungus')) {
  if (caveIds.has(a.id)) continue;
  const light = a._dominant === 'umbra' ? 'dark' : a._dominant === 'terra' ? 'any' : 'lit';
  cave.species.push({
    id: a.id,
    growMs: 1800000 + a._tier * 1800000,
    spreadChance: Number((0.075 - a._tier * 0.012).toFixed(3)),
    light,
  });
}
writeJson('cave.json', cave);

/*
 * Shaft strata: the gems, dealt across depth by how strong they are.
 *
 * Depth is the shaft's whole progression, so the deeper seams have to hold
 * something worth the beams. Weak stones sit near the surface; the dense ones
 * are at the bottom, where only a fully shored shaft reaches.
 */
const shaft = read('shaft.json');
const HAND_STRATA = new Set(['chalkSeam', 'emberPocket', 'deepglassStratum']);
shaft.strata = shaft.strata.filter((s) => HAND_STRATA.has(s.id));

const gems = added.filter((a) => a._source === 'mineral');

/*
 * Offset from the hand-authored seams at 0/40/80, because `strataFor` returns a
 * single stratum — the last one at or above the depth. A gem seam sharing 80m
 * with the deepglass stratum shadowed it completely, and nullstone, the only
 * pure Umbra in the game, quietly stopped existing.
 */
const DEPTHS = [20, 60, 100, 140, 180, 220];
const generated = DEPTHS.map((minDepth, i) => ({
  id: `gemSeam${i + 1}`,
  minDepth,
  veins: [],
}));

/*
 * Banded by RANK, not by an absolute density threshold.
 *
 * Thresholds put 159 of 161 gems into two seams, because the minerals all landed
 * in a narrow band of total essence. Sorting and cutting into equal groups keeps
 * every depth worth digging to whatever the numbers happen to be.
 */
const ranked = [...gems].sort((a, b) => {
  const sum = (g) => Object.values(g.essence).reduce((x, y) => x + y, 0);
  return sum(a) - sum(b);
});
const perSeam = Math.ceil(ranked.length / generated.length);

ranked.forEach((gem, index) => {
  const band = Math.min(generated.length - 1, Math.floor(index / perSeam));
  generated[band].veins.push({
    ingredientId: gem.id,
    size: Math.max(4, 12 - band * 2),
    // Two per batch, not one. A town's ore multiplier is applied to the batch
    // and rounded, so at a batch of one Cinderhold's rich rock and Saltmarsh's
    // poor rock both come out as exactly one stone.
    batch: 2,
    weight: Math.max(1, 4 - Math.floor(band / 2)),
  });
});

shaft.strata.push(...generated.filter((s) => s.veins.length > 0));
shaft.strata.sort((a, b) => a.minDepth - b.minDepth);
writeJson('shaft.json', shaft);

// Garden crops.
const crops = read('crops.json');
const keptCrops = crops.filter((c) => ORIGINAL_IDS.has(c.id));
crops.length = 0;
crops.push(...keptCrops);
const cropIds = new Set(crops.map((c) => c.id));
for (const a of added.filter((x) => x._source === 'crop')) {
  if (cropIds.has(a.id)) continue;
  crops.push({
    id: a.id,
    yields: a.id,
    growMs: 600000 + a._tier * 900000,
    yieldCount: a._tier === 0 ? 3 : 2,
    soil: a._dominant === 'ignis' ? 'ash' : a._dominant === 'aqua' ? 'silt' : 'loam',
  });
}
writeJson('crops.json', crops);

// Biome loot: wild plants and monstrous parts, the latter on the rare table.
//
// Rebuilt from the hand-authored entries each run rather than appended to, so
// re-running after a change to the distribution corrects the tables instead of
// piling a second copy on top of the first.
const heroes = read('heroes.json');
const HAND_AUTHORED = ORIGINAL_IDS;
for (const biome of heroes.biomes) {
  biome.loot = biome.loot.filter((e) => HAND_AUTHORED.has(e.ingredientId));
  biome.rare = biome.rare.filter((e) => HAND_AUTHORED.has(e.ingredientId));
}

for (const a of added.filter((x) => x._source === 'wild' || x._source === 'exotic')) {
  const biome = heroes.biomes.find((b) => b.id === a._biome);
  if (!biome) continue;
  const table = a._source === 'exotic' ? biome.rare : biome.loot;
  if (table.some((e) => e.ingredientId === a.id)) continue;
  table.push({
    ingredientId: a.id,
    min: 1,
    max: a._tier === 0 ? 3 : 2,
    weight: Math.max(1, 4 - a._tier),
  });
}
writeJson('heroes.json', heroes);

/*
 * Merchant stock: a seed for every crop, a cluster for every cave species.
 *
 * Without this the garden and the cave are full of things nobody can start —
 * the exact failure the coverage tests exist to catch, and they did. Which
 * merchant carries what follows the essence: Bramm has the ordinary green
 * things, Vessa the water and air, the Ashwalker the shadow.
 */
const merchants = read('merchants.json');
const byId = Object.fromEntries(merchants.map((m) => [m.id, m]));
const GENERATED = new Set(added.map((a) => a.id));

for (const m of merchants) {
  m.pool = m.pool.filter((e) => !GENERATED.has(e.id));
}

const stockist = (dominant) =>
  dominant === 'umbra' ? 'ashwalker' : dominant === 'aqua' || dominant === 'aer' ? 'vessa' : 'bramm';

for (const a of added) {
  const merchant = byId[stockist(a._dominant)];
  if (!merchant) continue;
  const barter = merchant.currency === 'potions';
  const price = Math.max(3, Math.round(a.baseValue * 1.4));
  const tier = Math.min(3, a._tier + (merchant.id === 'bramm' ? 0 : 1));

  if (a._source === 'crop') {
    merchant.pool.push({
      kind: 'seed',
      id: a.id,
      ...(barter ? { barter: { potions: 1, minGrade: 'D' } } : { price }),
      stock: 4,
      weight: 2,
      tier,
    });
  } else if (a._source === 'fungus') {
    merchant.pool.push({
      kind: 'spore',
      id: a.id,
      ...(barter ? { barter: { potions: 1, minGrade: 'D' } } : { price: price + 4 }),
      stock: 3,
      weight: 2,
      tier,
    });
  }
}
writeJson('merchants.json', merchants);

console.log('\nwrote ingredients.json, cave.json, crops.json, heroes.json, merchants.json');
for (const m of merchants) console.log(`   ${m.id.padEnd(11)} pool ${m.pool.length}`);
