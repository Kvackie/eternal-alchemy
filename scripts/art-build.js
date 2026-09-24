/*
 * Normalise source art into shippable sprites.
 *
 * Source art arrives at whatever size and framing the pack used. This trims each
 * image to its own opaque bounding box, fits it into the target box with a small
 * margin, and centres it — so a tall feather and a squat mushroom occupy the same
 * cell and a grid of them reads evenly.
 *
 * Also emits a manifest, because the game needs to know what art EXISTS. An id
 * with no file keeps its generated placeholder, which is what lets art land a few
 * pieces at a time without anything breaking.
 *
 *   node scripts/art-build.js
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/*
 * Per-sprite rotations that stand tilted art upright, from art-upright.js.
 *
 * Applied here rather than to the source files, so the pictures the pack shipped
 * stay untouched and a wrong call is undone by deleting a line.
 */
const UPRIGHT = existsSync('art/upright.json')
  ? (JSON.parse(readFileSync('art/upright.json', 'utf8')).rotate ?? {})
  : {};

/*
 * Target box per kind, and how much of it to leave as breathing room.
 *
 * Twice the size anything is drawn at, give or take. An ingredient shows at up
 * to 44 CSS pixels, which a 3x phone paints with 132 device pixels — so a 64px
 * sprite was being stretched to twice its size on every phone and read as soft.
 * The page never draws at a sprite's own size: every picture is placed in a
 * box set by CSS or `setDisplaySize`, so a bigger file is sharper and nothing
 * else.
 */
const KINDS = {
  ingredient: { from: 'art/ingredients', w: 128, h: 128, margin: 0.06 },
  decor: { from: 'art/decor', w: 256, h: 256, margin: 0.04 },
  potion: { from: 'art/potions', w: 128, h: 192, margin: 0.06 },
  scene: { from: 'art/scene', w: 384, h: 384, margin: 0 },
  // Boards are wide and shallow, and composed by art-shelves.js rather than
  // dropped in raw — so they are already the right shape and want no trimming.
  shelf: { from: 'art/shelves', w: 512, h: 96, margin: 0, keepFrame: true },
};

/*
 * Portraits keep their own aspect and are not trimmed — a face is the frame.
 *
 * Not doubled with the rest. A face is drawn 56 to about 110 CSS pixels wide
 * (a tavern card on a phone is the widest), which this covers at 2x and falls a
 * little short of at 3x; doubling would roughly add another megabyte and a half
 * to the heaviest folder there is, for faces that are seldom looked at closely.
 */
const PORTRAITS = {
  merchant: { from: 'art/portraits/merchants', w: 256, h: 320 },
  hero: { from: 'art/portraits/heroes', w: 256, h: 320 },
};

/*
 * Scene art that is not a square object.
 *
 * The scene box is square because nearly everything standing in it — a
 * cauldron, a plot, a mound, a burst of flame — is about as tall as it is wide.
 * A signboard is not. Fitting one into the square would spend two thirds of the
 * file on empty padding and throw away half the resolution along the only axis
 * that ever gets stretched, so these keep their own aspect at a width that
 * suits them.
 */
const SCENE_WIDE = {
  namePlank: 640,
};

const OUT = 'public/art';

/*
 * WebP rather than PNG.
 *
 * At twice the resolution PNG would have doubled the folder again; lossy WebP
 * holds painted art at a fraction of the bytes, and `alphaQuality: 100` keeps
 * the alpha channel lossless so trimmed edges stay as clean as the PNG's were.
 * `smartSubsample` keeps colour from bleeding across thin outlines — a bottle's
 * rim, a fern's edge — for a few percent more bytes. Every browser the game
 * supports, and the Android WebView, decodes it.
 */
const EXT = 'webp';
const encode = (pipeline) =>
  pipeline.webp({ quality: 88, alphaQuality: 100, smartSubsample: true });

const manifest = {};

/*
 * The art the game can actually ask for, per kind that has a surplus.
 *
 * The packs brought far more ingredients, potions and faces than the data
 * names — some four hundred sprites and several megabytes — and `public/`
 * ships whole, so every player downloaded them. The sources stay in `art/` for
 * the day the data grows into them; only what an id points at is built. Kinds
 * missing from here (décor, scene, shelves, heroes) are built in full.
 */
const data = (file) => JSON.parse(readFileSync(path.join('src/data', file), 'utf8'));
const USED = {
  ingredient: new Set([
    ...data('ingredients.json').map((entry) => entry.id),
    ...data('crops.json').map((crop) => crop.id),
  ]),
  potion: new Set(data('recipes.json').map((recipe) => recipe.art ?? recipe.id)),
  merchant: new Set(data('merchants.json').map((merchant) => merchant.id)),
};

/** The source files of a kind that the game will use. */
function sourcesFor(kind, from) {
  const all = readdirSync(from).filter((f) => /\.png$/i.test(f));
  const used = USED[kind];
  return used ? all.filter((f) => used.has(f.replace(/\.png$/i, ''))) : all;
}

/**
 * Delete built sprites whose source is gone, BEFORE writing the new ones.
 *
 * The build only ever wrote, never cleaned, so a renamed or deleted source left
 * its old output behind for good. Nothing referenced those files — the manifest
 * is rebuilt from the sources each time — but `public/` ships whole, so they
 * were downloaded by every player regardless. Renaming 195 potions turned that
 * from a slow leak into most of the folder.
 *
 * The ordering is not incidental. Windows matches filenames without regard to
 * case, so writing `emberstone.webp` over an existing `emberStone.webp` updates
 * the file but leaves the OLD name on it — after which a clean-up pass looking
 * for `emberstone.webp` finds nothing by that name and deletes the sprite it
 * just built. Clearing first sidesteps that, and has the side benefit of
 * correcting the case of any file that drifted: a name only Windows considers
 * a match is a 404 on a case-sensitive host.
 */
function prune(outDir, ids) {
  if (!existsSync(outDir)) return 0;
  const keep = new Set(ids.map((id) => `${id}.${EXT}`));
  let gone = 0;
  // PNGs included: the sprites shipped as PNG before, and a leftover one is
  // exactly the dead weight this pass exists to clear.
  for (const file of readdirSync(outDir).filter((f) => /\.(png|webp)$/i.test(f))) {
    if (keep.has(file)) continue;
    rmSync(path.join(outDir, file));
    gone += 1;
  }
  return gone;
}

for (const [kind, spec] of Object.entries(KINDS)) {
  if (!existsSync(spec.from)) {
    manifest[kind] = [];
    continue;
  }
  const outDir = path.join(OUT, kind);
  mkdirSync(outDir, { recursive: true });

  const sources = sourcesFor(kind, spec.from);
  const ids = sources.map((f) => f.replace(/\.png$/i, ''));
  const stale = prune(outDir, ids);

  for (const file of sources) {
    const id = file.replace(/\.png$/i, '');
    let pipeline = sharp(path.join(spec.from, file)).ensureAlpha();

    /*
     * Stand it up before anything measures it.
     *
     * Rotating grows the bounding box with fresh transparent corners, so this
     * has to happen ahead of the trim — otherwise the trim fits the box the art
     * had while it was lying down and the sprite comes out framed askew.
     */
    if (kind === 'ingredient' && UPRIGHT[id]) {
      pipeline = pipeline.rotate(UPRIGHT[id], {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }

    if (kind === 'scene' && SCENE_WIDE[id]) {
      // Trimmed so the slice insets below are measured against the board and
      // not against whatever empty canvas the file was saved with.
      await encode(pipeline.trim({ threshold: 10 }).resize({ width: SCENE_WIDE[id] })).toFile(
        path.join(outDir, `${id}.${EXT}`),
      );
    } else if (spec.keepFrame) {
      // Already composed at the right shape; trimming would eat the shadow and
      // re-centre the board away from its brackets.
      await encode(pipeline.resize(spec.w, spec.h, { fit: 'fill' })).toFile(
        path.join(outDir, `${id}.${EXT}`),
      );
    } else {
      const inner = Math.round(Math.min(spec.w, spec.h) * (1 - spec.margin * 2));
      await encode(
        pipeline
          // Trim the transparent border first, so framing comes from the art
          // rather than from however much empty canvas the pack left.
          .trim({ threshold: 10 })
          .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
          .resize(spec.w, spec.h, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          }),
      ).toFile(path.join(outDir, `${id}.${EXT}`));
    }
  }
  manifest[kind] = [...ids].sort();
  console.log(
    `${kind.padEnd(10)} ${ids.length} -> ${outDir}${stale ? `  (${stale} stale removed)` : ''}`,
  );
}

for (const [kind, spec] of Object.entries(PORTRAITS)) {
  if (!existsSync(spec.from)) {
    manifest[kind] = [];
    continue;
  }
  const outDir = path.join(OUT, kind);
  mkdirSync(outDir, { recursive: true });

  const sources = sourcesFor(kind, spec.from);
  const ids = sources.map((f) => f.replace(/\.png$/i, ''));
  const stale = prune(outDir, ids);

  for (const file of sources) {
    const id = file.replace(/\.png$/i, '');
    await encode(
      sharp(path.join(spec.from, file)).resize(spec.w, spec.h, { fit: 'cover', position: 'top' }),
    ).toFile(path.join(outDir, `${id}.${EXT}`));
  }
  manifest[kind] = [...ids].sort();
  console.log(
    `${kind.padEnd(10)} ${ids.length} -> ${outDir}${stale ? `  (${stale} stale removed)` : ''}`,
  );
}

/*
 * Where each brew sits inside its own sprite.
 *
 * Two anchors. `surfaceW` is the widest near-opaque row — the liquid's own
 * width, used to scale a brew to a cauldron's mouth. `bottomX`/`bottomY` is the
 * middle of its lowest opaque row: the point that gets placed on the pot's
 * opening, so the brew rises out of the pot from where it actually rests.
 *
 * Measured here, on the built sprite, rather than on the source: normalising
 * into the 384-square moves every number, and an anchor measured against the
 * wrong frame is worse than no anchor at all.
 */
async function measureBrews() {
  const dir = path.join(OUT, 'scene');
  if (!existsSync(dir)) return;
  const anchors = {};

  for (const file of readdirSync(dir).filter((f) => /^brew.*\.webp$/i.test(f))) {
    const { data, info } = await sharp(path.join(dir, file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    /*
     * The LIQUID's widest row, not the sprite's.
     *
     * A low alpha threshold measured the smoke instead: the shadow and air
     * brews wisp out to nearly the full frame, so matching that width to a
     * cauldron's mouth made the liquid itself hang over the sides with its
     * crop edge showing in open air. Only near-opaque pixels are body.
     */
    const SOLID = 200;
    let bestY = 0;
    let bestW = 0;
    let bestFirst = 0;
    let bestLast = 0;
    for (let y = 0; y < info.height; y += 1) {
      let first = -1;
      let last = -1;
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * info.channels + 3] > SOLID) {
          if (first < 0) first = x;
          last = x;
        }
      }
      const w = first < 0 ? 0 : last - first + 1;
      if (w > bestW) {
        bestW = w;
        bestY = y;
        bestFirst = first;
        bestLast = last;
      }
    }

    /*
     * The middle of the lowest opaque row: the brew's own base.
     *
     * Read off the SOLID mask again, not every stray pixel — a single wisp of
     * smoke drifting below the liquid would otherwise define the base and hang
     * the whole sprite a few pixels too high.
     */
    let bottomY = 0;
    let bottomFirst = 0;
    let bottomLast = 0;
    for (let y = info.height - 1; y >= 0; y -= 1) {
      let first = -1;
      let last = -1;
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * info.channels + 3] > SOLID) {
          if (first < 0) first = x;
          last = x;
        }
      }
      if (first >= 0) {
        bottomY = y;
        bottomFirst = first;
        bottomLast = last;
        break;
      }
    }

    /*
     * The rim is simply the widest row now.
     *
     * `art-effects.js` recuts each brew's underside into the ellipse a cauldron
     * mouth would show, so below the rim the mass only narrows — which makes the
     * widest row the rim by construction, and a second guess at where the rim is
     * would only be able to disagree with it.
     */
    const round = (n) => Math.round(n * 1000) / 1000;
    anchors[file.replace(/\.webp$/i, '')] = {
      rimX: round((bestFirst + bestLast) / 2 / info.width),
      rimY: round(bestY / info.height),
      rimW: round(bestW / info.width),
      /** The pool's near lip: the lowest point of the liquid. */
      bottomX: round((bottomFirst + bottomLast) / 2 / info.width),
      bottomY: round((bottomY + 1) / info.height),
    };
  }

  if (Object.keys(anchors).length === 0) return;
  writeFileSync(
    'src/data/brewEffects.json',
    JSON.stringify(
      {
        $comment:
          'Anchors within each brew sprite, as fractions of its frame. Each brew is painted ' +
          'as a rounded mass with a rim running round its outside and the bubbling interior ' +
          'within; rimX/rimY is where that rim reaches its LOWEST point — the widest row of ' +
          'the mass — and rimW is how wide it is there. The scene puts rimX/rimY on the ' +
          "bottom of a cauldron's opening and scales rimW to the opening's width, so the " +
          'liquid meets the pot at its own lip. bottomX/bottomY is the very base of the mass. ' +
          'Measured from the BUILT art by scripts/art-build.js. Generated — do not edit.',
        anchors,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`brew anchors: ${Object.keys(anchors).length} -> src/data/brewEffects.json`);
}

await measureBrews();

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest) + '\n', 'utf8');

/*
 * A second copy under src/data so the game can `import` it.
 *
 * Fetching the manifest would make every consumer async for a list that is fixed
 * at build time — the scene would need a loading state, and the DOM panels would
 * need to re-render once it arrived. Importing it keeps both synchronous.
 */
writeFileSync('src/data/artManifest.json', JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(
  `\nmanifest: ${Object.entries(manifest)
    .map(([k, v]) => `${k} ${v.length}`)
    .join(', ')}`,
);
