/*
 * Give the hand-authored ingredients their art.
 *
 * Fourteen ingredients existed before any art did, and keep their ids and their
 * tuned essence vectors because recipes, contracts, cave species, shaft strata
 * and four biome loot tables all point at them. Knowing which sprite each one
 * adopts is not enough — the FILE has to carry the ingredient's id, because the
 * filename is what the manifest and the loader key on.
 *
 * Reverts any previous adoption first, so re-running after `art-match.js`
 * changes its mind actually moves the files rather than leaving both names in
 * play.
 *
 *   node scripts/art-adopt.js [--apply]
 */
import { existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const DIR = 'art/ingredients';

const config = JSON.parse(readFileSync('art/adopted.json', 'utf8'));
const adopted = config.adopted;
const previous = { ...config.$previous };
delete previous.$comment;

const at = (id) => path.join(DIR, `${id}.png`);
const rename = (from, to) => {
  if (APPLY) renameSync(from, to);
  console.log(`  ${path.basename(from)}  ->  ${path.basename(to)}`);
};

// 1. Put every previously adopted sprite back under its own name, unless the new
//    map wants that same pairing kept.
console.log('reverting:');
let reverted = 0;
for (const [ingredientId, artId] of Object.entries(previous)) {
  if (adopted[ingredientId] === artId) continue; // unchanged pairing
  /*
   * A file already named for its ingredient, which the matcher then paired with
   * itself. Reverting it would rename the picture away and leave the ingredient
   * with nothing — the adopt step below could not find a source called `dewcap`
   * because this had just renamed it to `rareFlower`.
   */
  if (adopted[ingredientId] === ingredientId) continue;
  if (!existsSync(at(ingredientId))) continue;
  if (existsSync(at(artId))) continue;
  rename(at(ingredientId), at(artId));
  reverted += 1;
}
if (reverted === 0) console.log('  (nothing to revert)');

// 2. Claim the newly chosen sprites.
console.log('\nadopting:');
let moved = 0;
const missing = [];
for (const [ingredientId, artId] of Object.entries(adopted)) {
  if (existsSync(at(ingredientId))) continue; // already named for its ingredient
  if (!existsSync(at(artId))) {
    missing.push(`${artId}.png -> ${ingredientId}.png`);
    continue;
  }
  rename(at(artId), at(ingredientId));
  moved += 1;
}
if (moved === 0) console.log('  (nothing to adopt)');

console.log(`\n${reverted} reverted, ${moved} adopted`);
if (missing.length) {
  console.log('\nMISSING SOURCE:');
  for (const m of missing) console.log('  ' + m);
}
if (!APPLY) console.log('\nDry run. Re-run with --apply.');
