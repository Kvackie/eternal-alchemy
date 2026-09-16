/*
 * Fill in display names for data ids that don't have one.
 *
 * Ids are camelCase, so a readable name is mostly a matter of splitting words
 * and capitalising: `bloodRose` -> "Blood Rose", `frostrosette` -> "Frostrosette".
 * Coined single words stay as one word, because that is what they are.
 *
 * Only ever ADDS keys. An existing string is a decision someone made and this
 * script has no business overwriting it.
 *
 *   node scripts/art-i18n.js [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const DATA = 'src/data';
const read = (f) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));

const stringsPath = 'src/i18n/en.json';
const strings = JSON.parse(readFileSync(stringsPath, 'utf8'));

/** `bloodRose` -> `Blood Rose`; `goldcap` -> `Goldcap`. */
function titleOf(id) {
  const spaced = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const wanted = new Map();
for (const i of read('ingredients.json')) wanted.set(`ingredient.${i.id}`, titleOf(i.id));
for (const c of read('crops.json')) wanted.set(`crop.${c.id}`, titleOf(c.id));
for (const d of read('decor.json').pieces) {
  wanted.set(`decor.${d.id}`, titleOf(d.id));
  wanted.set(`decor.${d.id}.detail`, '');
}

const added = [];
for (const [key, value] of wanted) {
  if (Object.prototype.hasOwnProperty.call(strings, key)) continue;
  if (value === '') continue; // details are written by hand, never generated
  strings[key] = value;
  added.push(`${key} = ${value}`);
}

console.log(`${added.length} keys missing`);
for (const a of added.slice(0, 12)) console.log('  ' + a);
if (added.length > 12) console.log(`  … and ${added.length - 12} more`);

if (!WRITE) {
  console.log('\nReport only. Re-run with --write to add them.');
  process.exit(0);
}

writeFileSync(stringsPath, JSON.stringify(strings, null, 2) + '\n', 'utf8');
console.log(`\nwrote ${stringsPath}`);
