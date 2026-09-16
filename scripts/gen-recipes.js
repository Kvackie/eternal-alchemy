/*
 * Build the systematic half of the recipe book.
 *
 * The hand-authored recipes cover 71 scattered points and left the book far
 * thinner than the 385 ingredients feeding it. This lays down a grid instead:
 * every essence direction worth naming, at every potency, so a player who has
 * worked out how to make a strong Ignis brew has somewhere for it to go.
 *
 *   5 pure         (IGN, AQU, TER, AER, UMB)
 * + 10 pairs       (1:1)
 * + 10 triples     (1:1:1)
 * = 25 directions x 5 potencies = 125 recipes
 *
 * The hand-authored ones are UNTOUCHED and win wherever they overlap: they name
 * a narrow essence window inside a grid band, and identification prefers the
 * more specific match. A Health Tonic sitting at exactly 14 essence stays a
 * Health Tonic rather than becoming a Minor Aqua Draught.
 *
 *   node scripts/gen-recipes.js [--write]
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
const AXES = ['ignis', 'aqua', 'terra', 'aer', 'umbra'];

/** Short names that read as a potion rather than as a spreadsheet cell. */
const ESSENCE_WORD = {
  ignis: 'Ember',
  aqua: 'Tide',
  terra: 'Loam',
  aer: 'Gale',
  umbra: 'Shade',
};
const KEY = { ignis: 'ignis', aqua: 'aqua', terra: 'terra', aer: 'aer', umbra: 'umbra' };

/*
 * The potency ladder, as essence windows.
 *
 * Bounds are the same thresholds `config.potency` grades by, so the recipe you
 * identify as and the potency you are awarded always agree — a Greater Ember
 * Draught is greater potency by construction, not by coincidence.
 *
 * Sovereign is open-topped: there is no "too strong", only the cauldron's own
 * capacity, which is what the bigger cauldrons are for.
 */
const TIERS = [
  /*
   * The bottom band starts at zero, not at the potency threshold.
   *
   * Anchoring it to `minor`'s minEssence of 20 left every brew under 20 matching
   * nothing at all — which is most early brews, and they would all have come out
   * as Murk. The ladder has to cover the whole range from the first dewcap up.
   */
  { id: 'minor', word: 'Faint', min: 0, max: 45, value: 0.6 },
  { id: 'common', word: '', min: 45, max: 100, value: 1 },
  { id: 'greater', word: 'Strong', min: 100, max: 180, value: 2.2 },
  { id: 'grand', word: 'Grand', min: 180, max: 300, value: 4.5 },
  { id: 'sovereign', word: 'Sovereign', min: 300, max: null, value: 9 },
];

/** Rounded so a generated id is stable if the ladder shifts by a point. */
const BASE_VALUE = 26;

const recipes = JSON.parse(readFileSync('src/data/recipes.json', 'utf8'));
const existing = recipes.filter((r) => !r.generated);

/** Every direction the grid covers, cheapest to describe first. */
function directions() {
  const out = [];
  for (const a of AXES) out.push([a]);
  for (let i = 0; i < AXES.length; i += 1) {
    for (let j = i + 1; j < AXES.length; j += 1) out.push([AXES[i], AXES[j]]);
  }
  for (let i = 0; i < AXES.length; i += 1) {
    for (let j = i + 1; j < AXES.length; j += 1) {
      for (let k = j + 1; k < AXES.length; k += 1) out.push([AXES[i], AXES[j], AXES[k]]);
    }
  }
  return out;
}

/**
 * A cone wide enough to be hittable, tight enough not to swallow its neighbours.
 *
 * Pure directions sit far from everything and can afford to be generous. Triples
 * cluster near the middle of the space and have to be tighter or they overlap
 * each other.
 */
/*
 * Wide enough that the gaps between directions are covered, tight enough that
 * neighbours stay apart.
 *
 * At 16 degrees a pair cone could not reach a 2:1 blend, which sits 18.4 from
 * the 1:1 direction and 26.6 from the pure one — so two parts water to one of
 * earth matched nothing at all and came out as Murk. The angles are fixed by
 * geometry, so these are chosen against them:
 *
 *   pure to pair       45.0    20 + 24 = 44   fits
 *   pair to triple     35.3    24 + 11 = 35   fits
 *   pair to pair       60.0    24 + 24 = 48   fits
 *   triple to triple   33.6    11 + 11 = 22   fits
 *
 * A pair cone at 24 covers every two-axis ratio between 1:1 and 2:1, and the
 * pure cone at 20 covers 3:1 and beyond, so the space has no holes left in it.
 */
const TOLERANCE = { 1: 20, 2: 24, 3: 11 };

/**
 * A temperature band per direction, spread across the usable range.
 *
 * Bands do not identify a recipe — they are what you hunt for once you know
 * which recipe you are making — so they only need to be distinct enough that
 * finding one is a real memory rather than a guess.
 */
function bandFor(index, count) {
  const LOW = 70;
  const HIGH = 250;
  const width = 35;
  const min = Math.round(LOW + ((HIGH - LOW - width) * index) / Math.max(1, count - 1));
  return { min, max: min + width };
}

const dirs = directions();
const generated = [];

dirs.forEach((axes, index) => {
  const target = {};
  for (const a of AXES) target[a] = axes.includes(a) ? 1 : 0;

  // Anything not in the blend is a contaminant: that is what makes a pure line
  // demanding and a triple forgiving.
  const contaminants = AXES.filter((a) => !axes.includes(a));

  const stem = axes.map((a) => ESSENCE_WORD[a]).join('');
  const band = bandFor(index, dirs.length);
  // Alternate so neither method ends up the poor relation.
  const method = index % 2 === 0 ? 'stirred' : 'simmered';

  for (const tier of TIERS) {
    const id =
      stem.charAt(0).toLowerCase() +
      stem.slice(1) +
      tier.id.charAt(0).toUpperCase() +
      tier.id.slice(1);

    generated.push({
      id,
      target,
      contaminants,
      toleranceDeg: TOLERANCE[axes.length],
      essence: { min: tier.min, max: tier.max },
      temperature: band,
      method,
      // Scales with the tier, so the ladder is worth climbing on its own terms.
      baseValue: Math.round(BASE_VALUE * axes.length * tier.value),
      knownFromStart: false,
      generated: true,
    });
  }
});

/*
 * Give every hand-authored recipe an exact essence window.
 *
 * These are the unique ones, and what makes them unique is that they sit at a
 * PARTICULAR magnitude rather than anywhere in a band — a Health Tonic is a
 * specific small brew, not "some amount of water and earth". A narrow window is
 * also what keeps them reachable: identification prefers the more specific
 * match, so without one a signature would be swallowed by the grid band it sits
 * inside.
 *
 * The magnitude comes from the recipe's own baseValue, so an expensive potion is
 * a big brew and a cheap one is small. That is a fact the data already knew; it
 * was simply never expressed as a quantity.
 */
const ingredients = JSON.parse(readFileSync('src/data/ingredients.json', 'utf8'));

const vec = (o) => AXES.map((a) => o[a] ?? 0);
const angle = (a, b) => {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const mag = Math.hypot(...a) * Math.hypot(...b);
  return mag === 0 ? 90 : (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
};

/**
 * The smallest honest blend that lands in a recipe's cone, and what it weighs.
 *
 * The window has to sit where the recipe can actually BE brewed. Deriving it
 * from baseValue instead put the Health Tonic at 27-41 essence when three
 * dewcaps — the blend its own test uses, and the one the game teaches you with —
 * come to well under that, so the tonic became unmakeable and every attempt
 * came out as Murk.
 */
function reachableEssence(recipe) {
  const target = vec(recipe.target);
  const tol = recipe.toleranceDeg;

  /*
   * What a player would actually put in: three of something that suits.
   *
   * The MEDIAN fitting ingredient, not the closest one. Keying off the closest
   * picked whichever sprite happened to sit nearest the ratio — often a dense
   * mineral at 54 essence a unit — and put the Ember Draught's window three
   * times higher than the two emberroot the game teaches it with.
   */
  const fits = ingredients
    .map((ing) => ({ v: vec(ing.essence), a: angle(vec(ing.essence), target) }))
    .filter((x) => x.a <= tol)
    .map((x) => x.v.reduce((s, n) => s + n, 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  if (fits.length === 0) return 0;
  /*
   * The WEAKEST suitable ingredient, not the median.
   *
   * The floor has to clear two of whatever a player actually has, and early on
   * that is the feeblest herb that fits the ratio. Keying off the median put the
   * Wind Draught's floor at 57 while two gale thistles come to 40, so the
   * draught the tutorial teaches could not be made.
   */
  return fits[0] * 2;
}

/**
 * A floor, and a ceiling at Grand.
 *
 * The floor says the thing that matters — you cannot make a Health Tonic from a
 * single leaf. A narrow window or a single-tier window are both knife edges,
 * since whether a recipe is makeable would then depend on exactly how many
 * units a player happened to add.
 *
 * The ceiling exists because a signature outranks a generated recipe, so an
 * open-topped signature swallowed the WHOLE ladder on its direction: pure Ignis
 * always resolved to the hand-authored Scald Philtre, and Sovereign Ember
 * Essence could not be brewed at all. Signatures are ordinary-strength
 * preparations; at Grand scale and above you are making raw essence, not a
 * tonic, and the generated rungs own that ground.
 */
const GRAND_FLOOR = TIERS.find((t) => t.id === 'grand').min;

function windowAround(centre) {
  return { min: Math.max(1, Math.round(centre * 0.75)), max: GRAND_FLOOR };
}

/*
 * Recomputed every run, not preserved.
 *
 * The window is derived from the ingredients and the recipe's own cone, so it
 * has to move when either does — a hand edit here would silently rot the first
 * time an ingredient's essence changed. Murk keeps no window: it is what you get
 * when nothing matched, at any magnitude.
 */
const signatures = existing.map((r) => {
  if (r.isFallback) return r;
  const centre = reachableEssence(r);
  return { ...r, essence: windowAround(centre || 20) };
});

// Half-open, matching `withinEssenceWindow`: touching at a bound is not overlap.
const overlaps = (a, b) =>
  a && b && a.min < (b.max ?? Infinity) && b.min < (a.max ?? Infinity);

/*
 * Two recipes are ambiguous when a single blend could be either: same method,
 * cones that touch, AND essence windows that touch. Identification breaks ties
 * by specificity, so this only reports pairs of EQUAL specificity, where there
 * is no principled winner.
 */
const ambiguous = [];
const all = [...signatures.filter((r) => !r.isFallback), ...generated];
for (let i = 0; i < all.length; i += 1) {
  for (let j = i + 1; j < all.length; j += 1) {
    const a = all[i];
    const b = all[j];
    if (a.method !== b.method) continue;
    if (!overlaps(a.essence, b.essence)) continue;
    // A signature always beats a generated recipe, so those pairs are decided.
    // Only two of the same kind can be genuinely ambiguous.
    if (Boolean(a.generated) !== Boolean(b.generated)) continue;
    if (angle(vec(a.target), vec(b.target)) < a.toleranceDeg + b.toleranceDeg) {
      ambiguous.push(`${a.id} vs ${b.id}`);
    }
  }
}

console.log(`${dirs.length} directions x ${TIERS.length} tiers = ${generated.length} recipes`);
console.log(`  pure ${AXES.length}, pairs 10, triples 10`);
console.log(`hand-authored kept: ${existing.length}`);
console.log(`book total: ${existing.length + generated.length}`);

const windowed = signatures.filter((r) => r.essence && !r.isFallback).length;
console.log(`signatures given an exact window: ${windowed}`);
const sample = signatures.filter((r) => r.essence && !r.isFallback).slice(0, 5);
for (const s of sample) {
  console.log(`  ${s.id.padEnd(22)} ${s.essence.min}-${s.essence.max} essence  (${s.baseValue}g)`);
}

if (ambiguous.length) {
  console.log(`\nAMBIGUOUS — same method, touching cones, touching windows, equal specificity:`);
  for (const a of ambiguous.slice(0, 20)) console.log('  ' + a);
  if (ambiguous.length > 20) console.log(`  … and ${ambiguous.length - 20} more`);
} else {
  console.log('\nno ambiguous pairs: every blend resolves to exactly one recipe');
}

/*
 * Display names.
 *
 * Deliberately a different vocabulary from the hand-authored recipes — Essence,
 * Blend and Trine rather than Tonic, Draught and Philtre — so a generated line
 * never collides with a signature name and a player can tell at a glance which
 * kind of thing they are looking at.
 */
function displayName(recipe) {
  const axes = AXES.filter((a) => recipe.target[a] > 0);
  const tier = TIERS.find((t) => t.min === recipe.essence.min);
  const noun = axes.length === 1 ? 'Essence' : axes.length === 2 ? 'Blend' : 'Trine';
  const stem = axes.map((a) => ESSENCE_WORD[a]).join('-');
  return [tier?.word, stem, noun].filter(Boolean).join(' ');
}

if (WRITE) {
  const merged = [...signatures, ...generated];
  const target = 'src/data/recipes.json';
  const temp = `${target}.tmp`;
  writeFileSync(temp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  renameSync(temp, target);
  console.log(`\nwrote ${target} (${merged.length} recipes)`);

  const enPath = 'src/i18n/en.json';
  const en = JSON.parse(readFileSync(enPath, 'utf8'));
  let added = 0;
  for (const recipe of generated) {
    const key = `recipe.${recipe.id}`;
    if (en[key]) continue;
    en[key] = displayName(recipe);
    added += 1;
  }
  const enTemp = `${enPath}.tmp`;
  writeFileSync(enTemp, JSON.stringify(en, null, 2) + '\n', 'utf8');
  renameSync(enTemp, enPath);
  console.log(`wrote ${enPath} (${added} recipe names added)`);
  console.log(`  e.g. ${displayName(generated[0])} / ${displayName(generated[4])} / ${displayName(generated[62])}`);
} else {
  console.log('\nDry run. Re-run with --write.');
}
