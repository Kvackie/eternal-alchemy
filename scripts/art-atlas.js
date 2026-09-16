/*
 * Pack the normalised sprites into texture atlases.
 *
 * NOT PART OF THE BUILD, and deliberately so. Measured against this game:
 *
 *   ingredient atlas   2.8 MB, fetched whole, before anything can be drawn
 *   16 sprites lazily  135 KB, which is the most any screen shows at once
 *
 * An atlas wins when a screen draws most of a set at once — draw calls batch to
 * one, and one request beats hundreds. No screen here does that: the garden
 * shows at most sixteen crops of three hundred, the cauldron twelve, the shelf
 * six. Paying two megabytes to save a hundred kilobytes is the wrong trade, so
 * the game loads sprites individually and on demand.
 *
 * This exists for when that stops being true — an encyclopedia listing every
 * ingredient, a recipe book with every potion, a cave grid drawn in the world
 * rather than the DOM. If one of those arrives, pack the kind it needs and load
 * the atlas for that screen only.
 *
 * Run after art-build.js, which produces the normalised sprites this packs.
 *
 *   node scripts/art-atlas.js
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'public/art';
const OUT = 'public/art/atlas';

/** Frame size per kind, matching what art-build.js emits. */
const KINDS = {
  ingredient: { w: 64, h: 64 },
  potion: { w: 64, h: 96 },
  decor: { w: 128, h: 128 },
  scene: { w: 192, h: 192 },
};

/** Pages are capped at a size every target can hold as one texture. */
const MAX = 2048;
const PAD = 2;

mkdirSync(OUT, { recursive: true });
const index = {};

for (const [kind, size] of Object.entries(KINDS)) {
  const dir = path.join(SRC, kind);
  if (!existsSync(dir)) continue;

  const files = readdirSync(dir)
    .filter((f) => /\.png$/i.test(f))
    .sort();
  if (files.length === 0) continue;

  const cellW = size.w + PAD;
  const cellH = size.h + PAD;
  const cols = Math.max(1, Math.floor(MAX / cellW));
  const rowsPerPage = Math.max(1, Math.floor(MAX / cellH));
  const perPage = cols * rowsPerPage;
  const pages = Math.ceil(files.length / perPage);

  index[kind] = { pages, frameCount: files.length };

  for (let page = 0; page < pages; page += 1) {
    const slice = files.slice(page * perPage, (page + 1) * perPage);
    const rows = Math.ceil(slice.length / cols);

    const composites = [];
    const frames = {};

    for (let i = 0; i < slice.length; i += 1) {
      const x = (i % cols) * cellW;
      const y = Math.floor(i / cols) * cellH;
      composites.push({ input: path.join(dir, slice[i]), left: x, top: y });
      frames[slice[i].replace(/\.png$/i, '')] = {
        frame: { x, y, w: size.w, h: size.h },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: size.w, h: size.h },
        sourceSize: { w: size.w, h: size.h },
      };
    }

    const width = cols * cellW;
    const height = rows * cellH;
    const name = pages === 1 ? kind : `${kind}-${page}`;

    await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(composites)
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, `${name}.png`));

    // Phaser's JSON Hash format: frames keyed by name, which is the sprite id.
    writeFileSync(
      path.join(OUT, `${name}.json`),
      JSON.stringify({
        frames,
        meta: { image: `${name}.png`, format: 'RGBA8888', size: { w: width, h: height }, scale: '1' },
      }),
      'utf8',
    );

    console.log(`${name.padEnd(14)} ${slice.length} frames  ${width}x${height}`);
  }
}

writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
writeFileSync('src/data/artAtlas.json', JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log('\natlas index:', JSON.stringify(index));
