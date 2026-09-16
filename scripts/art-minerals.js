/*
 * Name the gems and fold them into the ingredient folder.
 *
 * 161 numbered crystals carry no meaning in their filenames, but they carry it
 * plainly in their colour — and colour is already how this project derives
 * essence. So each gem is named for what it IS: a red one becomes an Ember
 * something, a violet one a Gale something.
 *
 * Minerals matter mechanically because they are `stable` (no freshness) and
 * dense, which makes them the precise instrument for hitting a ratio that herbs
 * can only approximate.
 *
 *   node scripts/art-minerals.js [--apply]
 */
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const FROM = 'art/minerals';
const TO = 'art/ingredients';

const proposal = JSON.parse(readFileSync('art/minerals-essence.json', 'utf8').replace(/^﻿/, ''));

const ADJ = {
  ignis: ['Ember', 'Cinder', 'Pyre', 'Coal', 'Scald', 'Forge', 'Flare'],
  aqua: ['Tide', 'Dew', 'Mire', 'Brine', 'Rill', 'Deep', 'Frost'],
  terra: ['Loam', 'Chalk', 'Bark', 'Flint', 'Clay', 'Iron', 'Slate'],
  aer: ['Gale', 'Sky', 'Zephyr', 'Cloud', 'Drift', 'Aether', 'Wisp'],
  umbra: ['Shade', 'Grave', 'Veil', 'Dusk', 'Wane', 'Night', 'Void'],
};
const NOUN = [
  'quartz', 'beryl', 'opal', 'garnet', 'spar', 'geode', 'shard', 'crystal',
  'prism', 'glass', 'stone', 'agate', 'jasper', 'onyx', 'topaz',
];

/*
 * Names already spoken for — existing FILES and existing INGREDIENT IDS both.
 *
 * Checking only filenames produced `emberStone.png` while the game already had
 * an `emberstone` ingredient with no art yet. Windows treats those as the same
 * file, so the adoption step believed the picture was already in place and the
 * ingredient silently ended up with none.
 */
const taken = new Set([
  ...readdirSync(TO)
    .filter((f) => /\.png$/i.test(f))
    .map((f) => f.replace(/\.png$/i, '').toLowerCase()),
  ...JSON.parse(readFileSync('src/data/ingredients.json', 'utf8')).map((i) => i.id.toLowerCase()),
]);

const files = readdirSync(FROM)
  .filter((f) => /\.png$/i.test(f))
  .sort();

let named = 0;
const skipped = [];
const plan = [];

files.forEach((file, index) => {
  const stem = file.replace(/\.png$/i, '');
  const p = proposal[stem];
  if (!p || !p.dominant) {
    skipped.push(`${file} (no usable colour)`);
    return;
  }

  const adjectives = ADJ[p.dominant];
  let id = null;
  for (let attempt = 0; attempt < adjectives.length * NOUN.length; attempt += 1) {
    const adj = adjectives[(index + attempt) % adjectives.length];
    const noun = NOUN[(index * 3 + attempt * 5) % NOUN.length];
    const candidate = adj + noun.charAt(0).toUpperCase() + noun.slice(1);
    const camel = candidate.charAt(0).toLowerCase() + candidate.slice(1);
    if (!taken.has(camel.toLowerCase())) {
      id = camel;
      break;
    }
  }
  if (!id) {
    skipped.push(`${file} (no free name)`);
    return;
  }

  taken.add(id.toLowerCase());
  plan.push({ from: path.join(FROM, file), to: path.join(TO, `${id}.png`), id, essence: p.dominant });
  named += 1;
});

for (const step of plan.slice(0, 12)) {
  console.log(`  ${path.basename(step.from).padEnd(10)} -> ${step.id.padEnd(20)} ${step.essence}`);
}
if (plan.length > 12) console.log(`  … and ${plan.length - 12} more`);

if (APPLY) {
  for (const step of plan) {
    if (existsSync(step.to)) continue;
    renameSync(step.from, step.to);
  }
}

console.log(`\n${named} named${APPLY ? ' and moved' : ''}, ${skipped.length} skipped`);
for (const s of skipped) console.log('  ' + s);
if (!APPLY) console.log('\nDry run. Re-run with --apply.');
