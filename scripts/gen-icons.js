/*
 * The game's interface icons, from game-icons.net.
 *
 * The nav and the currency readouts used to be emoji, which every platform
 * draws in its own style and none of them in this game's. These are one set,
 * drawn for games, and single-colour, so they take the theme's colour like
 * text does.
 *
 * The sources are vendored in art/icons/ as `<author>--<name>.svg`, with the
 * set's licence beside them: CC BY 3.0, so every author is named on the
 * Credits page, which reads them from the file this writes. Each source is a
 * white shape on a black square; the square is dropped and only the shape's
 * path is kept, so the icon is a single path on a 512 grid.
 *
 *   node scripts/gen-icons.js           # show what would change
 *   node scripts/gen-icons.js --write   # write src/data/icons.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** What each interface slot shows, as `<author>--<name>` in art/icons/. */
const ICONS = {
  shop: 'delapouite--shop',
  board: 'delapouite--wanted-reward',
  market: 'lorc--swap-bag',
  grounds: 'lorc--sprout',
  cauldron: 'lorc--cauldron',
  roster: 'lorc--crossed-swords',
  ledger: 'lorc--quill-ink',
  settings: 'lorc--cog',
  gold: 'delapouite--two-coins',
  renown: 'lorc--laurel-crown',
  mastery: 'lorc--crystal-ball',
  // Stand-ins for a picture not painted yet: an empty shelf board, a
  // destination, a tool, a furnishing.
  shelf: 'delapouite--wood-beam',
  destination: 'lorc--treasure-map',
  equipment: 'lorc--anvil',
  decor: 'delapouite--candles',
};

/** How each author asks to be credited, from the set's licence file. */
const AUTHORS = {
  delapouite: { name: 'Delapouite', url: 'https://delapouite.com' },
  lorc: { name: 'Lorc', url: 'https://lorcblog.blogspot.com' },
};

const BACKGROUND = 'M0 0h512v512H0z';

const out = {};
for (const [id, file] of Object.entries(ICONS)) {
  const svg = readFileSync(`art/icons/${file}.svg`, 'utf8');
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((d) => d !== BACKGROUND);
  if (paths.length === 0) throw new Error(`${file}: no shape found`);

  const [author, name] = file.split('--');
  if (!AUTHORS[author]) throw new Error(`${file}: add ${author} to AUTHORS`);
  out[id] = { d: paths.join(' '), name, author };
}

const json = `${JSON.stringify({ authors: AUTHORS, icons: out }, null, 2)}\n`;
const target = 'src/data/icons.json';
let current = '';
try {
  current = readFileSync(target, 'utf8');
} catch {
  // Not written yet.
}

if (current === json) {
  console.log(`${Object.keys(out).length} icons. Nothing to change.`);
} else if (process.argv.includes('--write')) {
  writeFileSync(target, json);
  console.log(`${Object.keys(out).length} icons -> ${target}`);
} else {
  console.log(`${target} is out of date; run with --write.`);
  process.exitCode = 1;
}
