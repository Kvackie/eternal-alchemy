/*
 * Build shelf sprites from plank textures.
 *
 * The planks arrive as opaque board faces with no structure — no thickness, no
 * bracket, no shadow. A board floating on a dark wall reads as a stripe, so each
 * shelf is composed: the plank as the face, a lit edge along the front lip, a
 * darker underside where the board turns away from the light, two brackets, and
 * a cast shadow beneath. That is what makes a bottle look like it is standing on
 * something.
 *
 * Five planks, five qualities, in the order they look: salvaged and knotted at
 * the bottom, lacquered at the top.
 *
 *   node scripts/art-shelves.js
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** Source planks live apart from `art/scene`, which is shipped art. */
const SRC = 'art/planks';
const OUT = 'art/shelves';

/*
 * The board face starts at the very top of the sprite.
 *
 * It used to sit in the middle with transparent pixels above it, so anything
 * placed at the sprite's top edge stood on nothing and appeared to float. With
 * the surface at y=0 the scene can stand a bottle on `top` and be right, with no
 * magic fraction to keep in sync between the packer and the renderer.
 */
const W = 512;
const H = 96;
const BOARD_TOP = 0;
const BOARD_H = 48;

/*
 * Every other measurement below is in units of the 256 × 48 board this was first
 * drawn at, so the shelf keeps its look at whatever size `art-build.js` ships.
 */
const U = W / 256;

/** Ordered worst to best, which is also the order they are sold in. */
const SHELVES = [
  { id: 'salvagedBoard', plank: 'Plank_02.png' },
  { id: 'roughPine', plank: 'Plank_03.png' },
  { id: 'weatheredOak', plank: 'plank_19.png' },
  { id: 'planedBoard', plank: 'Plank_04.png' },
  { id: 'lacqueredShelf', plank: 'Plank_07.png' },
];

mkdirSync(OUT, { recursive: true });

for (const shelf of SHELVES) {
  // The board face, stretched to the shelf's width.
  const board = await sharp(path.join(SRC, shelf.plank))
    .resize(W, BOARD_H, { fit: 'fill' })
    .png()
    .toBuffer();

  /*
   * Structure, as one SVG so the pieces stay in register: shadow first (it sits
   * behind everything), then the brackets, then the highlight and the underside
   * which have to overlay the board itself.
   */
  const behind = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
       <ellipse cx="${W / 2}" cy="${BOARD_TOP + BOARD_H + 6 * U}" rx="${W * 0.46}" ry="${6 * U}"
                fill="#000" opacity="0.42"/>
       <rect x="${W * 0.13}" y="${BOARD_TOP + BOARD_H}" width="${8 * U}" height="${16 * U}" fill="#2b2116"/>
       <rect x="${W * 0.85}" y="${BOARD_TOP + BOARD_H}" width="${8 * U}" height="${16 * U}" fill="#2b2116"/>
     </svg>`,
  );

  const front = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
       <rect x="0" y="${BOARD_TOP}" width="${W}" height="${2 * U}" fill="#fff" opacity="0.26"/>
       <rect x="0" y="${BOARD_TOP + BOARD_H - 4 * U}" width="${W}" height="${4 * U}" fill="#000" opacity="0.45"/>
     </svg>`,
  );

  await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: behind, left: 0, top: 0 },
      { input: board, left: 0, top: BOARD_TOP },
      { input: front, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, `${shelf.id}.png`));

  console.log(`${shelf.id.padEnd(16)} <- ${shelf.plank}`);
}

/*
 * There were uprights here — a plank rotated on its end, to hang a stacked unit
 * from. Cut once the shelves became a grid rather than a unit: a hundred shelves
 * in ten columns have nothing to hang from, and posts drawn between them would
 * be a lattice over the whole wall.
 */

console.log(`\n${SHELVES.length} shelves -> ${OUT}`);
