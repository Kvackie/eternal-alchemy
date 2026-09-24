/*
 * Contact sheet: tile a folder of images into one labelled grid.
 *
 * Reviewing sixty sprites one file at a time is wasteful; one sheet showing all
 * of them with their filenames underneath is the same information at a fraction
 * of the cost. Rendered on the game's own dark ground, because that is what
 * these sit on and it is the only way to see which ones disappear against it.
 *
 *   node scripts/contact-sheet.js <dir> <out.png> [nameFilterRegex] [columns]
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [, , dir, out, filterArg, colsArg] = process.argv;
const filter = filterArg ? new RegExp(filterArg, 'i') : null;
const COLS = Number(colsArg) || 8;

const CELL = 128;
const LABEL = 22;
const PAD = 6;

const files = readdirSync(dir)
  .filter((f) => /\.(png|webp)$/i.test(f))
  .filter((f) => (filter ? filter.test(f) : true))
  .sort();

if (files.length === 0) {
  console.log('no files matched');
  process.exit(0);
}

const rows = Math.ceil(files.length / COLS);
const cellW = CELL + PAD * 2;
const cellH = CELL + LABEL + PAD * 2;

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const composites = [];

for (let i = 0; i < files.length; i += 1) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const x = col * cellW + PAD;
  const y = row * cellH + PAD;

  const buf = await sharp(path.join(dir, files[i]))
    .resize(CELL, CELL, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  composites.push({ input: buf, left: x, top: y });

  const label = escape(files[i].replace(/\.(png|webp)$/i, ''));
  const svg = Buffer.from(
    `<svg width="${cellW}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg">
       <text x="${cellW / 2}" y="15" font-family="monospace" font-size="12"
             fill="#e2e7e0" text-anchor="middle">${label}</text>
     </svg>`,
  );
  composites.push({ input: svg, left: col * cellW, top: y + CELL + 2 });
}

await sharp({
  create: {
    width: COLS * cellW,
    height: rows * cellH,
    channels: 4,
    background: { r: 24, g: 30, b: 27, alpha: 1 },
  },
})
  .composite(composites)
  .png()
  .toFile(out);

console.log(`${files.length} tiles -> ${out} (${COLS * cellW}x${rows * cellH})`);
