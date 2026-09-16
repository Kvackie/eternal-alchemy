/*
 * Remove a flat background from artwork that arrived without transparency.
 *
 * Not "make every white pixel transparent" — that punches holes through
 * highlights, and a sunlit plank or a glint on a leaf is exactly as white as the
 * background behind it. Instead the fill spreads inward from the borders, so
 * only background actually CONNECTED to the edge is removed and anything
 * enclosed by the artwork survives.
 *
 * Edge pixels get partial alpha rather than a hard cut: anti-aliasing blends the
 * subject into the background, and a binary threshold leaves either a white
 * fringe or a chewed outline. Alpha ramps across a tolerance band instead.
 *
 *   node scripts/art-dekey.js <file-or-dir> [--apply] [--tol=24] [--soft=52]
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

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

  const at = (x, y) => {
    const o = (y * width + x) * channels;
    return [data[o], data[o + 1], data[o + 2]];
  };

  /*
   * One background tone, or two.
   *
   * Some art arrives on a painted CHECKERBOARD — the pattern that means
   * "transparent" in a format which cannot hold it. Averaging the corners then
   * gives a colour halfway between the two squares that matches neither, and the
   * flood stops at the first tile boundary with the board still in place.
   *
   * So the first tone is read from a corner, and the run along the top edge is
   * searched for a second that differs from it. A picture on a flat background
   * simply never finds one.
   */
  const first = at(0, 0);
  const apart = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

  let second = null;
  for (let x = 1; x < Math.min(width, 160); x += 1) {
    const sample = at(x, 0);
    const gap = apart(sample, first);
    // Far enough to be the other square, near enough not to be the artwork.
    if (gap > 6 && gap < 70) {
      second = sample;
      break;
    }
  }

  const tones = second ? [first, second] : [first];
  const dist = (i) => {
    const o = i * channels;
    let best = 255;
    for (const tone of tones) {
      const d = Math.max(
        Math.abs(data[o] - tone[0]),
        Math.abs(data[o + 1] - tone[1]),
        Math.abs(data[o + 2] - tone[2]),
      );
      if (d < best) best = d;
    }
    return best;
  };

  /*
   * Flood inward from every border pixel. A queue rather than recursion because
   * a 1254² image overflows the stack, and Uint8Array rather than a Set because
   * this runs once per pixel and allocation dominates otherwise.
   */
  const seen = new Uint8Array(width * height);
  const queue = [];
  for (let x = 0; x < width; x += 1) {
    queue.push(x, x + (height - 1) * width);
  }
  for (let y = 0; y < height; y += 1) {
    queue.push(y * width, width - 1 + y * width);
  }

  let head = 0;
  while (head < queue.length) {
    const i = queue[head];
    head += 1;
    if (seen[i]) continue;
    if (dist(i) > SOFT) continue;
    seen[i] = 1;

    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) queue.push(i - 1);
    if (x < width - 1) queue.push(i + 1);
    if (y > 0) queue.push(i - width);
    if (y < height - 1) queue.push(i + width);
  }

  let removed = 0;
  for (let i = 0; i < width * height; i += 1) {
    if (!seen[i]) continue;
    const d = dist(i);
    // Inside TOL it is background; between TOL and SOFT it is an anti-aliased
    // edge, so alpha ramps rather than cutting.
    const alpha = d <= TOL ? 0 : Math.round(((d - TOL) / (SOFT - TOL)) * 255);
    data[i * channels + 3] = alpha;
    if (alpha < 255) removed += 1;
  }

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
