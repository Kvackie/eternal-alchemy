/*
 * Survey source art: transparency, framing and dominant colour.
 *
 * The normaliser trims to the opaque bounding box and re-pads, which only works
 * if there is transparent margin to trim. Art that bleeds to the canvas edge has
 * nothing to trim and will read as a full square tile next to a centred object —
 * so it is worth knowing which is which before wiring 144 files into a grid.
 *
 *   node scripts/art-survey.js <dir> [nameFilterRegex]
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [, , dir, filterArg] = process.argv;
const filter = filterArg ? new RegExp(filterArg, 'i') : null;

const files = readdirSync(dir)
  .filter((f) => /\.png$/i.test(f))
  .filter((f) => (filter ? filter.test(f) : true))
  .sort();

let fullBleed = 0;
let framed = 0;
let opaque = 0;
const rows = [];

for (const file of files) {
  const image = sharp(path.join(dir, file));
  const meta = await image.metadata();
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > 16) {
        opaquePixels += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const coverage = opaquePixels / (width * height);
  // Touching every edge means there is no margin to trim.
  const touches =
    (minX <= 1 ? 1 : 0) + (minY <= 1 ? 1 : 0) + (maxX >= width - 2 ? 1 : 0) + (maxY >= height - 2 ? 1 : 0);

  const kind = !meta.hasAlpha || coverage > 0.97 ? 'opaque' : touches >= 3 ? 'full-bleed' : 'framed';
  if (kind === 'opaque') opaque += 1;
  else if (kind === 'full-bleed') fullBleed += 1;
  else framed += 1;

  rows.push({ file, kind, coverage: (coverage * 100).toFixed(0), touches });
}

console.log(`${dir}: ${files.length} files`);
console.log(`  framed (trimmable margin): ${framed}`);
console.log(`  full-bleed (no margin):    ${fullBleed}`);
console.log(`  fully opaque (no alpha):   ${opaque}`);

const odd = rows.filter((r) => r.kind !== 'framed');
if (odd.length) {
  console.log('\n  not framed:');
  for (const r of odd) console.log(`    ${r.file.padEnd(28)} ${r.kind.padEnd(12)} ${r.coverage}% covered`);
}
