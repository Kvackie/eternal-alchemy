/*
 * Remove images that are byte-identical to one already in the folder.
 *
 * Art packs get re-copied, and the same picture arriving twice under two names
 * would become two ingredients with one face — indistinguishable in the garden
 * and in the cauldron, which is worse than having one fewer.
 *
 * When a duplicate group contains a name the game already uses, that name wins:
 * an id referenced by recipes, crops and loot tables must not move.
 *
 *   node scripts/art-dedupe.js <dir> [--apply]
 */
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) ?? 'art/ingredients';
const APPLY = args.includes('--apply');

const known = new Set(
  JSON.parse(readFileSync('src/data/ingredients.json', 'utf8')).map((i) => i.id),
);

const files = readdirSync(dir).filter((f) => /\.png$/i.test(f));
const groups = new Map();

for (const file of files) {
  const hash = crypto.createHash('md5').update(readFileSync(path.join(dir, file))).digest('hex');
  if (!groups.has(hash)) groups.set(hash, []);
  groups.get(hash).push(file);
}

/** A name already in the data outranks anything; then a real word over a code. */
const score = (file) => {
  const stem = file.replace(/\.png$/i, '');
  if (known.has(stem)) return 3;
  if (/^[a-z][A-Za-z]*$/.test(stem) && !/^[a-z]_?\d+$/i.test(stem)) return 2;
  return 1;
};

let removed = 0;
const dupeGroups = [...groups.values()].filter((g) => g.length > 1);

for (const group of dupeGroups) {
  const sorted = [...group].sort((a, b) => score(b) - score(a) || a.length - b.length);
  const keep = sorted[0];
  for (const file of sorted.slice(1)) {
    if (APPLY) unlinkSync(path.join(dir, file));
    removed += 1;
  }
  if (dupeGroups.indexOf(group) < 10) {
    console.log(`  keep ${keep.padEnd(24)} drop ${sorted.slice(1).join(', ')}`);
  }
}

console.log(
  `\n${files.length} files, ${groups.size} distinct images, ` +
    `${removed} duplicate${removed === 1 ? '' : 's'}${APPLY ? ' removed' : ' to remove'}`,
);

const survivors = APPLY ? readdirSync(dir).filter((f) => /\.png$/i.test(f)) : [];
if (APPLY) {
  const unmapped = survivors
    .map((f) => f.replace(/\.png$/i, ''))
    .filter((id) => !known.has(id));
  console.log(`${survivors.length} files remain, ${unmapped.length} not yet an ingredient`);
} else {
  console.log('\nDry run. Re-run with --apply.');
}
