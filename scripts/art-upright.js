/*
 * Stand the art up.
 *
 * Some source pieces are drawn lying at an angle — a root sprawled across its
 * canvas, a frond drawn on the diagonal. Planted in a bed they read as fallen
 * over, and no amount of per-plant lean in the scene fixes that, because the
 * lean is applied on top of whatever tilt the picture already had.
 *
 * So the tilt is measured and removed once, at build time. Each sprite's opaque
 * pixels have a principal axis — the direction the shape is longest in — found
 * from the second moments of the alpha mask. Rotating that axis onto vertical
 * is what "standing up" means for a picture.
 *
 * NOT every sprite: a berry has no meaningful long axis and a sprite already
 * near-upright does not want re-sampling. Both are gated below, and everything
 * skipped is reported so the decision stays inspectable.
 *
 * Writes art/upright.json for art-build.js to apply. Source art is never
 * touched, so a bad call here is undone by deleting an entry, not by finding
 * the original file again.
 *
 *   node scripts/art-upright.js [--write]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const WRITE = process.argv.includes('--write');
const FROM = 'art/ingredients';

/**
 * How long-and-thin a shape must be before its axis means anything.
 *
 * A circle's principal axis is whatever direction noise happens to favour, so
 * rotating a berry would be turning a coin and calling it upright.
 */
const MIN_ELONGATION = 1.45;

/** Below this the sprite is already standing; re-sampling it would only soften it. */
const MIN_TILT = 9;

/** Measure at a small size: the axis of a shape does not need full resolution. */
const SAMPLE = 96;

/**
 * Second moments of the opaque mask.
 *
 * Returns the principal axis angle in degrees measured from +x in image
 * coordinates (y pointing DOWN, as pixels do), plus how elongated the shape is.
 */
async function axisOf(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .resize(SAMPLE, SAMPLE, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] > 128) {
        n += 1;
        sx += x;
        sy += y;
      }
    }
  }
  if (n < 24) return null;

  const cx = sx / n;
  const cy = sy / n;
  let mxx = 0;
  let myy = 0;
  let mxy = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] > 128) {
        const dx = x - cx;
        const dy = y - cy;
        mxx += dx * dx;
        myy += dy * dy;
        mxy += dx * dy;
      }
    }
  }
  mxx /= n;
  myy /= n;
  mxy /= n;

  const theta = (Math.atan2(2 * mxy, mxx - myy) / 2) * (180 / Math.PI);
  const half = Math.sqrt(((mxx - myy) / 2) ** 2 + mxy ** 2);
  const mid = (mxx + myy) / 2;
  const major = mid + half;
  const minor = Math.max(1e-6, mid - half);
  return { theta, elongation: Math.sqrt(major / minor) };
}

/** Fold an angle into (-90, 90] — an axis has no head or tail. */
const foldAxis = (deg) => {
  let a = ((deg % 180) + 180) % 180;
  if (a > 90) a -= 180;
  return a;
};

const files = existsSync(FROM)
  ? readdirSync(FROM)
      .filter((f) => /\.png$/i.test(f))
      .sort()
  : [];

const rotations = {};
let round = 0;
let upright = 0;
let empty = 0;
const applied = [];

for (const file of files) {
  const id = file.replace(/\.png$/i, '');
  const measured = await axisOf(path.join(FROM, file));
  if (!measured) {
    empty += 1;
    continue;
  }
  if (measured.elongation < MIN_ELONGATION) {
    round += 1;
    continue;
  }

  /*
   * Vertical is 90 degrees from +x in y-down coordinates, and sharp's positive
   * rotation advances that angle, so the correction is simply the gap — folded,
   * because turning a shape 170 degrees to stand it up means turning it 10 the
   * other way.
   */
  const correction = foldAxis(90 - measured.theta);
  if (Math.abs(correction) < MIN_TILT) {
    upright += 1;
    continue;
  }

  rotations[id] = Math.round(correction * 10) / 10;
  applied.push({ id, correction, elongation: measured.elongation });
}

applied.sort((a, b) => Math.abs(b.correction) - Math.abs(a.correction));
for (const a of applied.slice(0, 20)) {
  console.log(
    `  ${a.id.padEnd(22)} ${a.correction.toFixed(1).padStart(6)}deg   ` +
      `${a.elongation.toFixed(2)}x long`,
  );
}
if (applied.length > 20) console.log(`  … and ${applied.length - 20} more`);

console.log(
  `\n${applied.length} to stand up, ${upright} already upright, ` +
    `${round} too round to have an axis, ${empty} empty`,
);

/*
 * Prove the sign convention rather than trusting it.
 *
 * A rotation applied the wrong way looks entirely plausible in code and lays
 * every tilted sprite down flat instead. So the worst offender is actually
 * rotated and re-measured, and the residual has to be smaller than the tilt we
 * started with.
 */
if (applied.length) {
  const worst = applied[0];
  const rotated = await sharp(path.join(FROM, `${worst.id}.png`))
    .ensureAlpha()
    .rotate(worst.correction, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const after = await axisOf(rotated);
  const residual = after ? Math.abs(foldAxis(90 - after.theta)) : NaN;
  console.log(
    `\ncheck: ${worst.id} tilted ${Math.abs(worst.correction).toFixed(1)}deg -> ` +
      `${residual.toFixed(1)}deg residual after rotation`,
  );
  if (!(residual < Math.abs(worst.correction))) {
    console.log('  WRONG WAY — the correction is making it worse. Do not write.');
    process.exit(1);
  }
}

if (WRITE) {
  const existing = existsSync('art/upright.json')
    ? JSON.parse(readFileSync('art/upright.json', 'utf8'))
    : {};
  writeFileSync(
    'art/upright.json',
    JSON.stringify(
      {
        $comment:
          'Degrees to rotate each source sprite so its long axis stands vertical, ' +
          'measured by scripts/art-upright.js from the principal axis of the alpha ' +
          'mask. Only elongated, clearly-tilted art appears here. Applied by ' +
          'art-build.js; source files are untouched. Hand edits survive a re-run ' +
          'only if you keep them — the generator rewrites this wholesale.',
        ...(existing.$pinned ? { $pinned: existing.$pinned } : {}),
        rotate: rotations,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`\nwrote art/upright.json (${applied.length} rotations)`);
} else {
  console.log('\nDry run. Re-run with --write to save.');
}
