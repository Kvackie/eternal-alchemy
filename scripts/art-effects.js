/*
 * Slice the cauldron-effect sheet into one sprite per essence.
 *
 * The sheet arrives as five brews on a painted CHECKERBOARD — the pattern
 * artists use to mean "transparent" in a format that cannot hold transparency.
 * `art-dekey.js` reads both checker tones now too, but it keys one picture per
 * file: this is five on one sheet, which have to be found and cut apart first,
 * and each brew's rim read off the art — so the keying lives here as well
 * rather than as a second pass over files that do not exist yet.
 *
 * The background test is "close to EITHER checker tone", and the flood runs
 * from the borders inward, which is what protects the pale highlights inside
 * the flames and foam from being punched out.
 *
 *   node scripts/art-effects.js [--apply]
 */
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const APPLY = process.argv.includes('--apply');
const SOURCE = 'art/scene/cauldronEffects.jpg';

/**
 * The five brews, in reading order.
 *
 * Positions are FOUND, not declared. Assuming an even three-by-two grid cut the
 * bottom-row images in half, because they are not aligned to the top row's
 * columns — so the sheet is segmented by looking for the empty gutters between
 * the paintings instead.
 */
const ORDER = [
  { id: 'brewIgnis', note: 'red, bubbling, licked with flame' },
  { id: 'brewAqua', note: 'blue, curling like water' },
  { id: 'brewTerra', note: 'brown, thick, throwing grit' },
  { id: 'brewAer', note: 'pale violet, wisping upward' },
  { id: 'brewUmbra', note: 'near-black, heavy and slow' },
];

/**
 * Where each brew's rim ends and its interior begins, read off the art.
 *
 * Every brew is painted with a smooth band around its outside and the bubbling
 * detail within. This is the row where that band gives way — the near lip of
 * the liquid, and the line its underside is cut on.
 *
 * Measured rather than derived. The obvious automatic rule — the mass's
 * shoulder, where the silhouette stops widening — lands right for the round
 * brews and far too high for the flat-topped Shadow one, whose body is nearly
 * full width from the top down.
 */
const RIM_ROW = {
  brewIgnis: 0.5,
  brewAqua: 0.5,
  brewTerra: 0.5,
  brewAer: 0.48,
  brewUmbra: 0.42,
};

/**
 * How squat a cauldron's mouth is: ellipse height over width.
 *
 * The six pots run 0.32 to 0.38, so one shape serves all of them.
 */
const MOUTH_ASPECT = 0.35;

/** Within this distance of a checker tone counts as background. */
const TOL = 30;
/** Beyond this is definitely subject; between the two, alpha ramps. */
const SOFT = 62;

const dist = (r, g, b, c) => Math.max(Math.abs(r - c[0]), Math.abs(g - c[1]), Math.abs(b - c[2]));

/**
 * Runs of "there is paint here" along one axis, with the gutters between them.
 *
 * Projection rather than connected components, because the smoke rising off each
 * brew breaks into separate specks — a component labeller would hand back forty
 * fragments per painting, while a column of pixels containing ANY paint is
 * unambiguous.
 */
function bands(counts, minGap, minRun) {
  const out = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] > 0) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap >= minGap) {
        if (i - gap - start >= minRun) out.push([start, i - gap]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0 && counts.length - start >= minRun) out.push([start, counts.length]);
  return out;
}

if (!existsSync(SOURCE)) {
  console.log(`no ${SOURCE} — nothing to slice`);
  process.exit(0);
}

const meta = await sharp(SOURCE).metadata();
console.log(`${SOURCE} ${meta.width}x${meta.height}`);

const { data, info } = await sharp(SOURCE)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const at = (x, y) => (y * width + x) * channels;

/*
 * The two checker tones, read from the corner.
 *
 * Sampled rather than assumed: the sheet is a JPEG, so its "white" is not 255
 * and the grey is whatever the exporter chose.
 */
const light = [data[at(1, 1)], data[at(1, 1) + 1], data[at(1, 1) + 2]];
let dark = light;
for (let step = 2; step < 120; step += 1) {
  const p = at(step, 1);
  if (dist(data[p], data[p + 1], data[p + 2], light) > 8) {
    dark = [data[p], data[p + 1], data[p + 2]];
    break;
  }
}
console.log(`checker: rgb(${light}) and rgb(${dark})`);

const offBackground = (p) =>
  Math.min(
    dist(data[p], data[p + 1], data[p + 2], light),
    dist(data[p], data[p + 1], data[p + 2], dark),
  );

// Paint mask for segmentation. A firmer threshold than the alpha ramp uses, so
// JPEG noise in the checker does not read as a painting.
const paint = new Uint8Array(width * height);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if (offBackground(at(x, y)) > SOFT) paint[y * width + x] = 1;
  }
}

const rowCounts = new Int32Array(height);
for (let y = 0; y < height; y += 1) {
  let n = 0;
  for (let x = 0; x < width; x += 1) n += paint[y * width + x];
  rowCounts[y] = n;
}

const boxes = [];
for (const [top, bottom] of bands(rowCounts, 12, 40)) {
  const colCounts = new Int32Array(width);
  for (let x = 0; x < width; x += 1) {
    let n = 0;
    for (let y = top; y < bottom; y += 1) n += paint[y * width + x];
    colCounts[x] = n;
  }
  for (const [left, right] of bands(colCounts, 12, 40)) {
    boxes.push({ left, top, width: right - left, height: bottom - top });
  }
}

if (boxes.length !== ORDER.length) {
  console.log(`\nfound ${boxes.length} paintings, expected ${ORDER.length}:`);
  for (const b of boxes) console.log(`  ${b.left},${b.top} ${b.width}x${b.height}`);
  console.log('Adjust the gutter thresholds, or the sheet layout changed.');
  process.exit(1);
}

for (const [index, box] of boxes.entries()) {
  const cell = ORDER[index];

  // Key this painting's own region: flood inward from ITS border.
  const region = await sharp(SOURCE).extract(box).ensureAlpha().raw().toBuffer();
  const w = box.width;
  const h = box.height;
  const rAt = (x, y) => (y * w + x) * 4;
  const rOff = (p) =>
    Math.min(
      dist(region[p], region[p + 1], region[p + 2], light),
      dist(region[p], region[p + 1], region[p + 2], dark),
    );

  const seen = new Uint8Array(w * h);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (seen[i]) return;
    if (rOff(rAt(x, y)) > SOFT) return;
    seen[i] = 1;
    queue.push(x, y);
  };
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }

  let cleared = 0;
  while (queue.length) {
    const y = queue.pop();
    const x = queue.pop();
    const p = rAt(x, y);
    const d = rOff(p);
    // Ramp rather than cut, so the soft edges of smoke keep their falloff.
    region[p + 3] = d <= TOL ? 0 : Math.round(((d - TOL) / (SOFT - TOL)) * 255);
    if (region[p + 3] < 8) cleared += 1;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  console.log(
    `  ${cell.id.padEnd(11)} at ${String(box.left).padStart(4)},${String(box.top).padStart(4)} ` +
      `${w}x${h}  cleared ${((cleared / (w * h)) * 100).toFixed(1).padStart(5)}%  ${cell.note}`,
  );

  if (APPLY) {
    const trimmed = await sharp(region, { raw: { width: w, height: h, channels: 4 } })
      .trim({ threshold: 6 })
      .png()
      .toBuffer();
    await sharp(await poolUnderside(trimmed, RIM_ROW[cell.id]))
      .png({ compressionLevel: 9 })
      .toFile(`art/scene/${cell.id}.png`);
  }
}

/**
 * Reshape the brew's underside from a ball into a pool.
 *
 * The sheet paints each brew as a complete sphere of liquid, which is a
 * perfectly good picture and the wrong shape for a cauldron: what you actually
 * see in a pot is an elliptical pool of the stuff, with its far edge tucked
 * behind the rim and its near edge curving toward you. A sphere placed on a
 * mouth either floats above it or hangs its underside over the pot's front, and
 * no amount of moving it fixes that — the shape is wrong, not the position.
 *
 * So everything below the rim is recut to the ellipse a mouth would show. Above
 * the rim nothing is touched, which leaves the flames and smoke to rise as
 * painted.
 */
async function poolUnderside(buffer, rimRow) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const solidAt = (x, y) => data[(y * width + x) * channels + 3] > 200;

  // Fall back to the widest row when a brew has no measured rim.
  let cutY;
  if (rimRow === undefined) {
    let bestW = 0;
    cutY = 0;
    for (let y = 0; y < height; y += 1) {
      let first = -1;
      let last = -1;
      for (let x = 0; x < width; x += 1) {
        if (solidAt(x, y)) {
          if (first < 0) first = x;
          last = x;
        }
      }
      const w = first < 0 ? 0 : last - first + 1;
      if (w > bestW) {
        bestW = w;
        cutY = y;
      }
    }
  } else {
    cutY = Math.min(height - 1, Math.round(rimRow * height));
  }

  // The pool's width is the brew's own width at the rim.
  let first = -1;
  let last = -1;
  for (let x = 0; x < width; x += 1) {
    if (solidAt(x, cutY)) {
      if (first < 0) first = x;
      last = x;
    }
  }
  if (first < 0) return buffer;

  const cx = (first + last) / 2;
  const rx = (last - first + 1) / 2;
  const ry = rx * MOUTH_ASPECT;

  for (let y = cutY; y < height; y += 1) {
    const dy = (y - cutY) / ry;
    // Half-width of the ellipse at this row; nothing survives past its bottom.
    const half = dy >= 1 ? -1 : rx * Math.sqrt(1 - dy * dy);
    for (let x = 0; x < width; x += 1) {
      if (Math.abs(x - cx) > half) data[(y * width + x) * channels + 3] = 0;
    }
  }

  return sharp(data, { raw: { width, height, channels } }).trim({ threshold: 6 }).png().toBuffer();
}

console.log(`\n${ORDER.length} effects${APPLY ? ' written' : ''}`);
if (!APPLY) console.log('Dry run. Re-run with --apply.');
