/*
 * Give every recipe a bottle, by colour.
 *
 * Potion art is matched to a recipe by FILENAME and nothing else, so a sprite is
 * only reachable once someone has renamed it to a recipe id. The packs shipped
 * 260 bottles under names like `az_bottle1` and `14`, which meant 195 finished
 * paintings sat unreachable while 132 recipes fell back to a generated
 * placeholder. This closes that gap without drawing anything new.
 *
 * The pairing is done on colour, because colour is the one thing a bottle and a
 * recipe can be compared on. A recipe's own colour comes from its essence
 * target mixed through the palette the rest of the game uses — so a pure ignis
 * draught wants a red bottle and an ember/tide pair wants something between red
 * and blue. A sprite's colour is the average of its SATURATED pixels: glass,
 * cork and highlight are near-grey and carry no information about what is in
 * the bottle, so they are left out of the average rather than washing it out.
 *
 * Matching is greedy over every pair, nearest first, in CIELAB — where equal
 * distances look equally different, which plain RGB does not. Greedy rather
 * than optimal: the assignment that minimises TOTAL error is happy to give one
 * recipe a poor bottle to improve two others, and a single obviously wrong
 * potion is more noticeable than a slightly better average.
 *
 * Within a family the five potencies are then re-sorted by depth of colour, so
 * Minor is the palest of its five and Sovereign the richest. Potency is not
 * something colour matching can see, but once a family holds five bottles the
 * order they are handed out in is free.
 *
 *   node scripts/art-potions.js            # plan only
 *   node scripts/art-potions.js --apply    # rename, and delete what is left
 */
import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const APPLY = process.argv.includes('--apply');

const SOURCE = 'art/potions';
const BUILT = 'public/art/potion';

const recipes = JSON.parse(readFileSync('src/data/recipes.json', 'utf8'));

/*
 * The palette, read from the stylesheet the game itself uses.
 *
 * Copying the five numbers in here would work until someone retunes a hue and
 * every bottle assigned before that quietly stops matching.
 */
function readEssenceColors() {
  const src = readFileSync('src/ui/theme.ts', 'utf8');
  const block = src.match(/essenceColors[^{]*\{([^}]*)\}/);
  const found = {};
  for (const [, name, hex] of (block?.[1] ?? '').matchAll(/(\w+):\s*0x([0-9a-fA-F]{6})/g)) {
    found[name] = parseInt(hex, 16);
  }
  if (Object.keys(found).length !== 5) {
    throw new Error('could not read essenceColors from src/ui/theme.ts');
  }
  return found;
}

const essenceColors = readEssenceColors();

// ------------------------------------------------------------------ colour

/** sRGB to CIELAB, so "how different" means what the eye means by it. */
function lab([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.9505;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.089;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function labDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * What colour a bottle reads as.
 *
 * Weighted by saturation twice over: a grey pixel is skipped outright, and the
 * ones that remain count in proportion to how colourful they are. A bottle that
 * is mostly clear glass with a thumbnail of violet in it still reads violet.
 */
async function spriteColor(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;

  for (let i = 0; i < info.width * info.height; i += 1) {
    const o = i * info.channels;
    if (data[o + 3] < 200) continue;

    const [R, G, B] = [data[o], data[o + 1], data[o + 2]];
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    if (max < 30 || min > 235) continue;

    const sat = (max - min) / max;
    if (sat < 0.18) continue;

    r += R * sat;
    g += G * sat;
    b += B * sat;
    weight += sat;
  }

  // An all-grey bottle has no colour to match on; its mean is used as-is.
  if (weight === 0) return null;
  return [r / weight, g / weight, b / weight];
}

/** A recipe's colour: its essence target mixed through the game's palette. */
function recipeColor(target) {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (const [essence, amount] of Object.entries(target)) {
    if (!amount) continue;
    const hex = essenceColors[essence];
    r += ((hex >> 16) & 255) * amount;
    g += ((hex >> 8) & 255) * amount;
    b += (hex & 255) * amount;
    total += amount;
  }
  return total ? [r / total, g / total, b / total] : [128, 128, 128];
}

// ------------------------------------------------------------------- plan

const files = readdirSync(SOURCE)
  .filter((f) => /\.png$/i.test(f))
  .map((f) => f.replace(/\.png$/i, ''));

const recipeIds = new Set(recipes.map((entry) => entry.id));
const pool = files.filter((id) => !recipeIds.has(id));
const needy = recipes.filter((entry) => !files.includes(entry.id));

console.log(`${files.length} sprites, ${files.length - pool.length} already named for a recipe`);
console.log(`${needy.length} recipes without art, ${pool.length} sprites unassigned\n`);

const colors = new Map();
for (const id of pool) {
  const found = await spriteColor(path.join(BUILT, `${id}.png`));
  if (found) colors.set(id, found);
}

/*
 * Every pair, nearest first.
 *
 * 132 x 195 is 25k pairs — small enough to score exhaustively and sort, which
 * makes the greedy pass exact about which pairing really is the closest one
 * still available rather than depending on the order recipes happen to be in.
 */
const pairs = [];
for (const recipe of needy) {
  const want = lab(recipeColor(recipe.target));
  for (const [id, rgb] of colors) {
    pairs.push({ recipe: recipe.id, sprite: id, gap: labDistance(want, lab(rgb)) });
  }
}
pairs.sort((a, b) => a.gap - b.gap);

const takenRecipe = new Set();
const takenSprite = new Set();
const plan = new Map();
for (const pair of pairs) {
  if (takenRecipe.has(pair.recipe) || takenSprite.has(pair.sprite)) continue;
  takenRecipe.add(pair.recipe);
  takenSprite.add(pair.sprite);
  plan.set(pair.recipe, pair);
}

/*
 * Potency reads as depth of colour.
 *
 * The five members of a family share one essence direction, so colour matching
 * cannot tell them apart and hands out five equally good bottles in an
 * arbitrary order. Sorting those five by how dark and saturated they are, and
 * dealing them out Minor to Sovereign, costs nothing and makes a rank visible
 * in the shelf.
 */
const POTENCY = ['Minor', 'Common', 'Greater', 'Grand', 'Sovereign'];
const families = new Map();
for (const recipe of needy) {
  const rank = POTENCY.findIndex((step) => recipe.id.endsWith(step));
  if (rank < 0 || !plan.has(recipe.id)) continue;
  const family = recipe.id.slice(0, recipe.id.length - POTENCY[rank].length);
  if (!families.has(family)) families.set(family, []);
  families.get(family).push({ rank, id: recipe.id });
}

for (const members of families.values()) {
  if (members.length < 2) continue;
  const sprites = members.map((m) => plan.get(m.id).sprite);
  // Depth: dark and saturated first is "richest", pale and washed out last.
  sprites.sort((a, b) => {
    const depth = (id) => {
      const [L, A, B] = lab(colors.get(id));
      return Math.hypot(A, B) - L * 0.6;
    };
    return depth(a) - depth(b);
  });
  members.sort((a, b) => a.rank - b.rank);
  members.forEach((member, index) => {
    plan.get(member.id).sprite = sprites[index];
  });
}

const unmatched = needy.filter((r) => !plan.has(r.id)).map((r) => r.id);
const leftover = pool.filter((id) => !takenSprite.has(id));

const byGap = [...plan].sort((a, b) => a[1].gap - b[1].gap);
const show = (label, rows) => {
  console.log(label);
  for (const [recipe, pair] of rows) {
    console.log(`  ${pair.sprite.padEnd(20)} -> ${recipe.padEnd(26)} dE ${pair.gap.toFixed(1)}`);
  }
};
show('closest:', byGap.slice(0, 8));
show('\nfurthest — check these:', byGap.slice(-8));
console.log(`\n${plan.size} assignments in total`);
if (unmatched.length) console.log(`\nstill without art: ${unmatched.join(' ')}`);
console.log(`\nleftover sprites to delete: ${leftover.length}`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply.');
  process.exit(0);
}

/*
 * Renamed through a temporary name.
 *
 * A plan can hand recipe A the sprite currently called B while giving recipe B
 * a different one; renaming straight into place would then overwrite a file the
 * plan still needs. Two passes avoids having to reason about the order.
 */
for (const [recipe, pair] of plan) {
  renameSync(path.join(SOURCE, `${pair.sprite}.png`), path.join(SOURCE, `${recipe}.png.tmp`));
}
for (const recipe of plan.keys()) {
  renameSync(path.join(SOURCE, `${recipe}.png.tmp`), path.join(SOURCE, `${recipe}.png`));
}
for (const id of leftover) {
  rmSync(path.join(SOURCE, `${id}.png`));
}

writeFileSync(
  'art/potion-assignments.json',
  JSON.stringify(
    {
      $comment:
        'Which pack sprite became which potion, from scripts/art-potions.js. Kept so a ' +
        'renamed file can be traced back to the pack it came from — the art itself is now ' +
        'stored under the recipe id and the original names are gone.',
      assigned: Object.fromEntries([...plan].map(([recipe, pair]) => [recipe, pair.sprite])),
      deleted: leftover,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

console.log(`\nrenamed ${plan.size}, deleted ${leftover.length}`);
console.log('run `node scripts/art-build.js` to rebuild');
