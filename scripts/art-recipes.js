/*
 * Propose recipes for the widened ingredient set.
 *
 * A recipe is a direction in essence-space with a cone around it. Two rules
 * decide whether one may exist:
 *
 *   1. It must be BREWABLE — some blend of gatherable ingredients has to land
 *      inside its cone. Blending only reaches the positive hull of what you can
 *      gather, so plenty of directions are simply impossible.
 *   2. It must not OVERLAP a same-method recipe. The identifier picks the
 *      nearest match, so two overlapping cones make one of them unreachable
 *      forever.
 *
 * Method is a second axis: a stirred and a simmered recipe may share a
 * direction, which is what makes the book twice the size the geometry suggests.
 *
 * Candidates are walked in a fixed order and taken greedily, so the output is
 * deterministic — re-running does not reshuffle a player's recipe book.
 *
 *   node scripts/art-recipes.js [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
const AXES = ['ignis', 'aqua', 'terra', 'aer', 'umbra'];

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};

/*
 * Tolerance and blend width are the two dials on how many recipes fit.
 *
 * Tighter cones pack more in but are harder to hit; wider blends open new
 * directions but crowd toward the centre of the space, where every ratio looks
 * like every other one. Both default to the values the book was built with.
 */
const TOLERANCE = arg('tol', 14);
const MAX_ESSENCES = arg('essences', 3);

const ingredients = JSON.parse(readFileSync('src/data/ingredients.json', 'utf8'));
const recipes = JSON.parse(readFileSync('src/data/recipes.json', 'utf8'));
const strings = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'));

const vec = (o) => AXES.map((a) => o[a] ?? 0);
const pool = ingredients.map((i) => vec(i.essence));

function angle(a, b) {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const mag = Math.hypot(...a) * Math.hypot(...b);
  return mag === 0 ? Math.PI / 2 : Math.acos(Math.max(-1, Math.min(1, dot / mag)));
}
const deg = (r) => (r * 180) / Math.PI;

/** Closest a non-negative blend can get. Greedy, deterministic — see balance.test.ts. */
function bestBlend(target) {
  let current = pool.reduce((best, e) => (angle(e, target) < angle(best, target) ? e : best));
  let best = angle(current, target);
  for (const w of [1, 0.5, 0.25, 0.1, 0.05, 0.02]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const e of pool) {
        const cand = current.map((v, i) => v + e[i] * w);
        const a = angle(cand, target);
        if (a < best - 1e-9) {
          current = cand;
          best = a;
          improved = true;
        }
      }
    }
  }
  return deg(best);
}

/*
 * Candidate directions: every small-integer ratio over the five essences.
 *
 * Four-essence blends were excluded at first on the theory that they crowd the
 * centre of the space and become indistinguishable. The overlap check turns out
 * to enforce that far better than a rule of thumb — it rejects the ones that
 * genuinely collide and keeps seventeen that do not. A recipe wanting a little
 * of everything is a legitimate thing to want.
 */
const candidates = [];
for (let a = 0; a <= 3; a += 1) {
  for (let b = 0; b <= 3; b += 1) {
    for (let c = 0; c <= 3; c += 1) {
      for (let d = 0; d <= 3; d += 1) {
        for (let e = 0; e <= 3; e += 1) {
          const v = [a, b, c, d, e];
          const nonZero = v.filter((x) => x > 0).length;
          if (nonZero === 0 || nonZero > MAX_ESSENCES) continue;
          // Reduce by gcd so 2:2 and 1:1 are not treated as different targets.
          const g = v.reduce((acc, x) => (x ? gcd(acc, x) : acc), 0);
          if (g > 1) continue;
          candidates.push(v);
        }
      }
    }
  }
}
function gcd(x, y) {
  return y ? gcd(y, x % y) : x;
}

const TOL = TOLERANCE;
const existing = recipes.filter((r) => !r.isFallback).map((r) => ({
  target: vec(r.target),
  method: r.method,
  tol: r.toleranceDeg,
  id: r.id,
}));

const taken = [...existing];
const proposed = [];

for (const v of candidates) {
  for (const method of ['stirred', 'simmered']) {
    if (taken.some((t) => t.method === method && deg(angle(t.target, v)) <= t.tol + TOL)) continue;
    // Comfortably inside, not just barely — a recipe only hittable at its exact
    // optimum grades the same every time and stops being a skill.
    const reach = bestBlend(v);
    if (reach > TOL * 0.7) continue;

    const entry = { target: v, method, tol: TOL, reach };
    taken.push(entry);
    proposed.push(entry);
  }
}

// -------------------------------------------------------------- naming

const ADJ = {
  ignis: ['Ember', 'Cinder', 'Pyre', 'Coal', 'Scald'],
  aqua: ['Tide', 'Dew', 'Mire', 'Brine', 'Rill'],
  terra: ['Loam', 'Chalk', 'Bark', 'Flint', 'Clay'],
  aer: ['Gale', 'Sky', 'Zephyr', 'Cloud', 'Drift'],
  umbra: ['Shade', 'Grave', 'Veil', 'Dusk', 'Wane'],
};
const NOUN = ['Tonic', 'Draught', 'Elixir', 'Philtre', 'Cordial', 'Tincture', 'Infusion', 'Extract'];

const usedNames = new Set(Object.entries(strings).filter(([k]) => k.startsWith('recipe.')).map(([, v]) => v));
const usedIds = new Set(recipes.map((r) => r.id));

function nameFor(v, method, salt) {
  const ranked = AXES.map((a, i) => [a, v[i]]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
  const lead = ranked[0][0];
  const second = ranked[1]?.[0];

  for (let i = 0; i < 40; i += 1) {
    const adj = ADJ[lead][(salt + i) % ADJ[lead].length];
    const tail = second ? ADJ[second][(salt + i * 3) % ADJ[second].length].toLowerCase() : '';
    const noun = NOUN[(salt + i * 5) % NOUN.length];
    const display = tail ? `${adj}${tail} ${noun}` : `${adj} ${noun}`;
    const id = display.replace(/[^A-Za-z]/g, '');
    const camel = id.charAt(0).toLowerCase() + id.slice(1);
    if (!usedNames.has(display) && !usedIds.has(camel)) {
      usedNames.add(display);
      usedIds.add(camel);
      return { id: camel, display };
    }
  }
  return null;
}

/** Hotter for fire, colder for air — the band should read as the thing it makes. */
function bandFor(v) {
  const weight = { ignis: v[0], aqua: v[1], terra: v[2], aer: v[3], umbra: v[4] };
  const total = Object.values(weight).reduce((a, b) => a + b, 0) || 1;
  const heat =
    (weight.ignis * 265 + weight.umbra * 240 + weight.terra * 185 + weight.aqua * 130 + weight.aer * 85) /
    total;
  const min = Math.max(25, Math.round(heat - 18));
  return { min, max: Math.min(300, min + 35) };
}

const emitted = [];
proposed.forEach((p, index) => {
  const named = nameFor(p.target, p.method, index);
  if (!named) return;
  const target = Object.fromEntries(AXES.map((a, i) => [a, p.target[i]]));
  const contaminants = AXES.filter((a, i) => p.target[i] === 0);
  const magnitude = p.target.reduce((a, b) => a + b, 0);

  emitted.push({
    id: named.id,
    display: named.display,
    target,
    contaminants,
    toleranceDeg: TOL,
    temperature: bandFor(p.target),
    method: p.method,
    // Fewer, rarer essences in the ratio means a harder blend, so it is worth more.
    baseValue: Math.round(28 + magnitude * 6 + contaminants.length * 5),
    knownFromStart: false,
    reach: p.reach,
  });
});

console.log(`existing real recipes: ${existing.length}`);
console.log(`candidate directions:  ${candidates.length}`);
console.log(`new recipes proposed:  ${emitted.length}`);
for (const e of emitted.slice(0, 10)) {
  console.log(
    `   ${e.display.padEnd(24)} ${e.method.padEnd(9)} ${JSON.stringify(e.target)} reach ${e.reach.toFixed(1)}deg`,
  );
}
if (emitted.length > 10) console.log(`   … and ${emitted.length - 10} more`);

if (!WRITE) {
  console.log('\nReport only. Re-run with --write to add them.');
  process.exit(0);
}

const fallbackIndex = recipes.findIndex((r) => r.isFallback);
const additions = emitted.map(({ display, reach, ...keep }) => keep);
recipes.splice(fallbackIndex < 0 ? recipes.length : fallbackIndex, 0, ...additions);
writeFileSync('src/data/recipes.json', JSON.stringify(recipes, null, 2) + '\n', 'utf8');

for (const e of emitted) strings[`recipe.${e.id}`] = e.display;
writeFileSync('src/i18n/en.json', JSON.stringify(strings, null, 2) + '\n', 'utf8');

console.log(`\nwrote ${additions.length} recipes and their names`);
