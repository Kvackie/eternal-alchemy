/*
 * Propose an essence vector for each ingredient from its own art.
 *
 * The UI already assumes an ingredient's colour and its dominant essence agree —
 * placeholder badges tint by essence, and the shelf reads at a glance because of
 * it. Deriving the vector from the sprite keeps that true for 144 hand-drawn
 * icons without eyeballing every one, and it means a red leaf is Ignis because
 * it is red, not because someone typed it.
 *
 * Hue buckets map to the five essences the palette already uses:
 *   Ignis red · Aqua blue · Terra gold-green · Aer violet-white · Umbra dark
 *
 * Output is a proposal, not a commitment — it goes to stdout as JSON for review.
 *
 *   node scripts/art-essence.js art/ingredients [> proposal.json]
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = process.argv[2] || 'art/ingredients';
/** Bottles: judge the contents, not the glass around them. */
const LIQUID = process.argv.includes('--liquid');

/** Weighted hue → essence. Returns unit-ish weights that are later scaled. */
function essenceOf(h, s, l) {
  // Washed-out colours carry their meaning in lightness rather than hue: near
  // black is Umbra, near white is Aer. Chroma has to decide before hue does.
  if (s < 0.14) {
    if (l < 0.28) return { umbra: 1 };
    if (l > 0.68) return { aer: 0.8, terra: 0.2 };
    return { terra: 0.5, umbra: 0.5 };
  }

  // Pale and soft whatever the hue — down, spore, cloud, mist. Without this the
  // only Aer in 144 sprites was two purple flowers, and a griffin feather read
  // as shadow.
  if (l > 0.72 && s < 0.38) return { aer: 0.75, aqua: 0.25 };

  /*
   * Brown is earth, not fire. A warm hue that is muted and dark is bark, soil,
   * dried leaf or mushroom stem — the single most common colour in this set, and
   * reading it as Ignis put 58 of 144 ingredients in the fire bucket.
   */
  if (h < 50 && s < 0.55 && l < 0.55) return { terra: 0.75, ignis: 0.25 };

  if (h < 16) return { ignis: 1 };
  if (h < 40) return { ignis: 0.7, terra: 0.3 };
  if (h < 68) return { terra: 0.6, ignis: 0.4 };
  if (h < 100) return { terra: 1 };
  if (h < 150) return { terra: 0.65, aqua: 0.35 };
  if (h < 185) return { aqua: 0.55, aer: 0.25, terra: 0.2 };
  if (h < 215) return { aqua: 1 };
  if (h < 250) return { aqua: 0.65, aer: 0.35 };
  if (h < 285) return l < 0.4 ? { umbra: 0.65, aer: 0.35 } : { aer: 1 };
  if (h < 325) return l < 0.42 ? { umbra: 1 } : { aer: 0.5, umbra: 0.5 };
  return { ignis: 0.55, umbra: 0.45 };
}

/**
 * Where the name knows better than the pixels.
 *
 * Only for cases where the art's palette genuinely misleads — pale ice reads as
 * Aer by colour but is obviously water, and a spectral root's glow says nothing
 * about it being of the barrow. Kept short on purpose: if this grows past a
 * handful, the hue mapping is wrong and should be fixed instead.
 */
const OVERRIDES = {
  ice: { aqua: 16, aer: 4 },
  algae: { aqua: 12, terra: 8 },
  seagrass: { aqua: 12, terra: 8 },
  shrimp: { aqua: 14, terra: 6 },
  jellyfishCoral: { aqua: 13, aer: 7 },
  magmaFish: { ignis: 15, aqua: 5 },
  spectralRoot: { umbra: 14, aer: 6 },
  voideel: { umbra: 13, aqua: 7 },
  monsterBones: { terra: 11, umbra: 9 },
  griffinFeather: { aer: 17, terra: 3 },
  manaFruit: { aer: 11, umbra: 9 },
  glowspindle: { umbra: 12, aer: 8 },
};

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

const files = readdirSync(dir)
  .filter((f) => /\.png$/i.test(f))
  .sort();

const out = {};

for (const file of files) {
  const { data, info } = await sharp(path.join(dir, file))
    .ensureAlpha()
    .resize(64, 64, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const totals = { ignis: 0, aqua: 0, terra: 0, aer: 0, umbra: 0 };
  let weightSum = 0;
  let lightnessSum = 0;
  let opaque = 0;

  for (let i = 0; i < width * height; i += 1) {
    const o = i * channels;
    if (data[o + 3] < 40) continue;
    const [h, s, l] = rgbToHsl(data[o], data[o + 1], data[o + 2]);

    /*
     * Saturated pixels say more about what a thing IS than muddy ones do — a
     * grey stem is background to a scarlet cap. Weighting by chroma stops large
     * neutral areas drowning the colour that gives the sprite its identity.
     *
     * `--liquid` sharpens this for bottles, where clear glass, cork and white
     * highlights make up most of the sprite and say nothing at all about what is
     * inside it. Only the coloured contents get a vote.
     */
    if (LIQUID && (s < 0.3 || l > 0.85 || l < 0.08)) continue;
    const weight = LIQUID ? 0.05 + s * s * 3 : 0.25 + s;
    const parts = essenceOf(h, s, l);
    for (const [essence, share] of Object.entries(parts)) {
      totals[essence] += share * weight;
    }
    weightSum += weight;
    lightnessSum += l;
    opaque += 1;
  }

  if (opaque === 0) {
    out[file.replace(/\.png$/i, '')] = null;
    continue;
  }

  // Normalise to shares, then round to a small integer vector. Magnitude is
  // assigned later from source and rarity; only the direction comes from art.
  const shares = Object.fromEntries(
    Object.entries(totals).map(([k, v]) => [k, v / weightSum]),
  );

  const top = Object.entries(shares).sort((a, b) => b[1] - a[1]);
  const vector = {};
  for (const [essence, share] of top) {
    // Drop trace essences; a vector of five smudges points nowhere useful.
    if (share < 0.12) continue;
    vector[essence] = Math.round(share * 20);
  }
  if (Object.keys(vector).length === 0) vector[top[0][0]] = 20;

  const id = file.replace(/\.png$/i, '');
  const final = OVERRIDES[id] ?? vector;
  const dominant = Object.entries(final).sort((a, b) => b[1] - a[1])[0][0];

  out[id] = {
    vector: final,
    dominant,
    overridden: OVERRIDES[id] !== undefined,
    lightness: Number((lightnessSum / opaque).toFixed(2)),
  };
}

console.log(JSON.stringify(out, null, 1));
