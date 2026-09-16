/*
 * Choose art for the hand-authored ingredients by ESSENCE, not by name.
 *
 * Picking by name gave emberroot a blue root and gravecrown a brown one — the
 * UI tints and labels everything by dominant essence, so art that disagrees
 * with its own vector is worse than a placeholder: it teaches the wrong thing
 * at a glance.
 *
 * Each original claims the unclaimed sprite closest to its vector in angle.
 * Claiming is greedy in a fixed order, so the result is deterministic.
 *
 *   node scripts/art-match.js
 */
import { readFileSync, writeFileSync } from 'node:fs';

const AXES = ['ignis', 'aqua', 'terra', 'aer', 'umbra'];
const proposal = JSON.parse(readFileSync('art/essence.json', 'utf8').replace(/^﻿/, ''));
const ingredients = JSON.parse(readFileSync('src/data/ingredients.json', 'utf8'));

/**
 * Every hand-authored ingredient, minerals included.
 *
 * The four minerals were left out while the art was all herbs and fungi and
 * nothing looked remotely like a rock. A hundred and sixty gems later they have
 * better candidates than anything else does.
 */
const ORIGINALS = [
  'emberroot', 'sunleaf', 'galeThistle', 'moonpetal', 'ashfern',
  'dewcap', 'gravecrown', 'chalkgill',
  'chalkNodule', 'emberstone', 'deepglass', 'nullstone',
  'salamanderScale', 'mirefenPearl', 'barrowAsh', 'skyreachFeather',
  'cinderwraithAsh', 'quicksilverTear',
];

/** Art currently renamed onto an ingredient id, so it can be considered again. */
const CURRENT = {
  emberroot: 'magicRoot',
  sunleaf: 'sunflower',
  galeThistle: 'blueberryThistle',
  moonpetal: 'chrystaLily',
  ashfern: 'shadefern',
  dewcap: 'bluecone',
  chalkgill: 'palecap',
  gravecrown: 'inkcap',
  salamanderScale: 'monsterMeat',
  mirefenPearl: 'jellyfishCoral',
  barrowAsh: 'ashsprig',
  skyreachFeather: 'griffinFeather',
  cinderwraithAsh: 'spectralRoot',
  quicksilverTear: 'manaFruit',
};

const vec = (o) => AXES.map((a) => o[a] ?? 0);
function angle(a, b) {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const mag = Math.hypot(...a) * Math.hypot(...b);
  return mag === 0 ? 90 : (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

// Candidates are every sprite in the proposal, under its ORIGINAL art name.
const candidates = Object.entries(proposal)
  .filter(([, v]) => v && v.vector)
  .map(([id, v]) => ({ id, v: vec(v.vector) }));

/*
 * Scarcest first.
 *
 * Straight greedy in declaration order let galeThistle take the griffin feather,
 * leaving skyreachFeather — which is PURE Aer — with a purple spice at 39°. The
 * art skews green and red, so Aer and Umbra ingredients have very few plausible
 * sprites and have to choose before the ones spoilt for choice do.
 */
const order = ORIGINALS.map((id) => {
  const def = ingredients.find((i) => i.id === id);
  const want = def ? vec(def.essence) : null;
  const close = want ? candidates.filter((c) => angle(c.v, want) < 20).length : 0;
  return { id, want, close };
})
  .filter((o) => o.want)
  .sort((a, b) => a.close - b.close);

/**
 * How far a match may stray before it is worth flagging.
 *
 * This used to refuse anything past 25° so a wrong-coloured sprite could not
 * teach the wrong essence. Every ingredient should have a picture, so the cap is
 * now generous and a strained match is reported rather than rejected — the
 * essence vector is the ingredient's own either way, and a badge in a bed of
 * painted plants looks like a bug.
 */
const MAX_ANGLE = 70;
/** Past this the colour genuinely argues with the essence; worth knowing about. */
const STRAINED = 25;

/**
 * Where the name settles it and no amount of colour maths should argue.
 *
 * A skyreach feather is a feather. Essence alone would have handed the griffin
 * feather to gale thistle, which is also Aer-heavy but is a plant.
 */
const LOCKS = {
  skyreachFeather: 'griffinFeather',
};

/**
 * Category preferences, as a penalty rather than a filter.
 *
 * Colour alone gave chalk nodule a broadleaf and emberstone an acorn: the right
 * hue on entirely the wrong object. A cave species should look like a fungus and
 * a mineral like a stone, so a cross-category match pays for the privilege and
 * only wins when nothing in its own category comes close.
 */
const FUNGUS_ART =
  /cap$|fungus|shroom|toadstool|gill|puffnest|mosstier|bluecone|glowspindle|tieredcap/i;
const MINERAL_ART =
  /(quartz|beryl|opal|garnet|spar|geode|shard|crystal|prism|glass|stone|agate|jasper|onyx|topaz)$/i;
const CATEGORY_PENALTY = 45;
/** Minerals get the same push: a rock that is a leaf reads as a bug. */
const MINERAL_PENALTY = 45;

const claimed = new Set();
const result = {};
const declined = [];

// Locks are settled before anything is dealt, or a scarcity-ordered pick can
// take a locked sprite out from under the ingredient it belongs to.
for (const [id, artId] of Object.entries(LOCKS)) {
  claimed.add(artId);
  result[id] = artId;
  console.log(`${id.padEnd(18)} ${artId.padEnd(20)}   locked by name`);
}

for (const { id, want } of order) {
  if (result[id]) continue;
  const def = ingredients.find((i) => i.id === id);
  const wantsFungus = def?.category === 'fungus';
  const wantsMineral = def?.category === 'mineral';
  const wantsPlant = def?.category === 'herb';

  let best = null;
  let bestAngle = Infinity;
  for (const c of candidates) {
    if (claimed.has(c.id)) continue;
    // Score, not truth: the penalty steers the choice without pretending the
    // angle is something it is not.
    let penalty = 0;
    if (wantsFungus && !FUNGUS_ART.test(c.id)) penalty = CATEGORY_PENALTY;
    if (wantsMineral && !MINERAL_ART.test(c.id)) penalty = MINERAL_PENALTY;
    // And the reverse: a growing thing should not be a crystal. Emberroot came
    // out as a quartz — right colour, and still plainly not a root.
    if (wantsPlant && MINERAL_ART.test(c.id)) penalty = MINERAL_PENALTY;
    const score = angle(c.v, want) + penalty;
    if (score < bestAngle) {
      bestAngle = score;
      best = c.id;
    }
  }

  if (!best || bestAngle > MAX_ANGLE) {
    declined.push(`${id} (closest was ${best} at ${bestAngle.toFixed(1)}deg)`);
    continue;
  }

  claimed.add(best);
  result[id] = best;
  const was = CURRENT[id];
  console.log(
    `${id.padEnd(18)} ${best.padEnd(20)} ${bestAngle.toFixed(1).padStart(5)}deg` +
      (was === best ? '  (unchanged)' : `  was ${was}`),
  );
}

if (declined.length) {
  console.log('\nNo honest match — keeping the essence badge:');
  for (const d of declined) console.log('  ' + d);
}

if (process.argv.includes('--write')) {
  const previous = JSON.parse(readFileSync('art/adopted.json', 'utf8'));
  writeFileSync(
    'art/adopted.json',
    JSON.stringify(
      {
        $comment: previous.$comment,
        adopted: result,
        // What this replaced, so art-adopt.js can put the old names back before
        // claiming the new ones.
        $previous: { $comment: previous.$previous?.$comment, ...previous.adopted },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`\nwrote art/adopted.json (${Object.keys(result).length} adoptions)`);
} else {
  console.log('\nADOPTED = ' + JSON.stringify(result, null, 2));
  console.log('\nRe-run with --write to save.');
}
