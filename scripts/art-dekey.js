/*
 * Remove a flat or checkerboard background from artwork that arrived without
 * transparency, one picture per file.
 *
 * The keying itself — the flood inward from the borders, the "close to either
 * checker tone" test and the alpha ramp across the TOL..SOFT band — lives in
 * `art-key.js`, shared with `art-effects.js`. This script only picks the files,
 * skips any that already carry transparency, reads the tones from the top-left
 * corner and top edge, and writes the result back over the original.
 *
 *   node scripts/art-dekey.js <file-or-dir> [--apply] [--tol=24] [--soft=52]
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { floodKey, readTones } from './art-key.js';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const num = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};

/** Within this of the background colour is definitely background. */
const TOL = num('tol', 24);
/** Beyond this is definitely subject. Between the two, alpha ramps. */
const SOFT = num('soft', 52);

if (!target) {
  console.log('usage: node scripts/art-dekey.js <file-or-dir> [--apply]');
  process.exit(1);
}

const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => /\.png$/i.test(f))
      .map((f) => path.join(target, f))
  : [target];

for (const file of files) {
  const image = sharp(file).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Already has meaningful transparency? Leave it alone.
  let clear = 0;
  for (let i = 0; i < width * height; i += 1) if (data[i * channels + 3] < 16) clear += 1;
  if (clear / (width * height) > 0.02) {
    console.log(`${path.basename(file).padEnd(22)} already transparent — skipped`);
    continue;
  }

  // One background tone, or the two squares of a painted checkerboard: the
  // first from the corner, the second searched for along the top edge.
  const tones = readTones(data, width, channels, {
    span: Math.min(width, 160),
    minGap: 6,
    maxGap: 70,
  });
  const removed = floodKey(data, width, height, channels, tones, {
    tol: TOL,
    soft: SOFT,
    clearBelow: 255,
  });

  console.log(
    `${path.basename(file).padEnd(22)} bg ${tones.map((t) => `rgb(${t.join(',')})`).join(' + ')}` +
      `  cleared ${((removed / (width * height)) * 100).toFixed(1)}%`,
  );

  if (APPLY) {
    await sharp(data, { raw: { width, height, channels } })
      .png({ compressionLevel: 9 })
      .toFile(`${file}.tmp`);
    const { renameSync } = await import('node:fs');
    renameSync(`${file}.tmp`, file);
  }
}

if (!APPLY) console.log('\nDry run. Re-run with --apply.');
