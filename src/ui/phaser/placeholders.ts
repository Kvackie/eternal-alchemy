/**
 * Placeholder art.
 *
 * Not grey boxes: sprites generated from the game's own data, so an ingredient's
 * badge is tinted by its dominant essence and stamped with that essence's glyph.
 * Composition and silhouette are final even though the rendering isn't, which is
 * what makes the eventual painted 2D pass a file swap rather than a rebuild.
 *
 * M1 generates these at runtime. When the art pipeline lands in M4 this becomes
 * a build step writing into an atlas, and nothing else changes.
 */

import Phaser from 'phaser';
import { ingredients } from '@/sim/config';
import { artUrl, dominantEssence, hasArt, idsWithArt } from '@/ui/art';
import { essenceColors, palette } from '@/ui/theme';
import { ESSENCES } from '@/sim/types';
import type { Essence, EssenceVector } from '@/sim/types';

/** Authoring grid. Everything is a multiple of this so the atlas stays tidy. */
const CELL = 64;

/**
 * Queue every sprite that has real art.
 *
 * Called from `preload`, so Phaser's loader handles it before the scene builds.
 * Anything not queued here falls through to a generated badge below, which is
 * what lets painted art replace placeholders a few files at a time.
 */
export function preloadArt(scene: Phaser.Scene): void {
  /*
   * Only what every scene needs, which is a couple of dozen files.
   *
   * Queuing all of it — 300-odd ingredients and 260 potions — meant Phaser held
   * the scene back until the last one arrived, and the world sat empty for over
   * half a minute. The rest is fetched by `ensureTexture` when something is
   * actually about to be drawn, which for a garden of four plots is four files.
   *
   * The real answer is a packed atlas; this is the honest interim, and it keeps
   * the placeholder fallback doing exactly what it was built to do.
   */
  for (const id of idsWithArt('scene')) {
    scene.load.image(id, artUrl('scene', id));
  }
  for (const id of idsWithArt('decor')) {
    scene.load.image(`decor:${id}`, artUrl('decor', id));
  }
  // Five boards, drawn on every shop screen, so they belong in the preload
  // rather than arriving a frame after the shelves they are.
  for (const id of idsWithArt('shelf')) {
    scene.load.image(`shelf:${id}`, artUrl('shelf', id));
  }
}

/** Keys already requested, so a redraw does not queue the same file repeatedly. */
const requested = new Set<string>();

/**
 * Fetch a sprite the scene is about to want, if it isn't loaded yet.
 *
 * Returns whether the texture is ready NOW. It never blocks: the caller draws
 * its placeholder this frame, and `onReady` fires a redraw once the real sprite
 * lands. That is the same fallback path an id with no art uses permanently, so
 * there is only one behaviour to reason about.
 */
export function ensureTexture(
  scene: Phaser.Scene,
  key: string,
  url: string | null,
  onReady: () => void,
): boolean {
  if (scene.textures.exists(key)) return true;
  if (!url || requested.has(key)) return false;

  requested.add(key);
  scene.load.image(key, url);
  scene.load.once(`filecomplete-image-${key}`, onReady);
  if (!scene.load.isLoading()) scene.load.start();
  return false;
}

export function generatePlaceholders(scene: Phaser.Scene): void {
  for (const ingredient of ingredients) {
    /*
     * Only where there is no art at all.
     *
     * Badges used to be generated for every ingredient, which quietly claimed
     * the texture key — so when the real sprite arrived later, Phaser found the
     * key taken and dropped it, and painted art never appeared in the world no
     * matter how correctly it loaded.
     */
    if (hasArt('ingredient', ingredient.id)) continue;
    makeIngredientBadge(scene, ingredient.id, dominantEssence(ingredient.essence));
  }
  makePlotTile(scene);
  makeCauldron(scene);
  makeShelf(scene);
  makeBottle(scene);
}

function texture(scene: Phaser.Scene, key: string, width: number, height: number): {
  g: Phaser.GameObjects.Graphics;
  commit: () => void;
} | null {
  if (scene.textures.exists(key)) return null;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  return {
    g,
    commit: () => {
      g.generateTexture(key, width, height);
      g.destroy();
    },
  };
}

function makeIngredientBadge(scene: Phaser.Scene, id: string, essence: Essence): void {
  const made = texture(scene, `ingredient:${id}`, CELL, CELL);
  if (!made) return;
  const { g, commit } = made;
  const color = essenceColors[essence];

  g.fillStyle(palette.bgRaised, 1);
  g.fillCircle(CELL / 2, CELL / 2, CELL * 0.44);
  g.lineStyle(2, color, 0.9);
  g.strokeCircle(CELL / 2, CELL / 2, CELL * 0.44);

  g.fillStyle(color, 0.9);
  drawGlyphShape(g, essence, CELL / 2, CELL / 2, CELL * 0.4, color);

  commit();
}

/** Shared glyph geometry, so canvas sprites and the wheel agree. */
export function drawGlyphShape(
  g: Phaser.GameObjects.Graphics,
  essence: Essence,
  cx: number,
  cy: number,
  size: number,
  color: number,
): void {
  const s = size / 10;
  const ox = cx - size / 2;
  const oy = cy - size / 2;

  switch (essence) {
    case 'ignis':
      g.fillStyle(color, 1);
      g.fillTriangle(
        ox + 5 * s,
        oy + 0.8 * s,
        ox + 9.3 * s,
        oy + 9.2 * s,
        ox + 0.7 * s,
        oy + 9.2 * s,
      );
      break;
    case 'terra':
      g.fillStyle(color, 1);
      g.fillRect(ox + 1.4 * s, oy + 1.4 * s, 7.2 * s, 7.2 * s);
      break;
    case 'aqua':
      g.fillStyle(color, 1);
      g.fillCircle(ox + 5 * s, oy + 6.2 * s, 3 * s);
      g.fillTriangle(ox + 5 * s, oy + 0.8 * s, ox + 8 * s, oy + 6.5 * s, ox + 2 * s, oy + 6.5 * s);
      break;
    case 'aer':
      g.lineStyle(Math.max(2, 1.9 * s), color, 1);
      g.beginPath();
      g.moveTo(ox + 0.9 * s, oy + 7.4 * s);
      g.lineTo(ox + 5 * s, oy + 1.6 * s);
      g.lineTo(ox + 9.1 * s, oy + 7.4 * s);
      g.strokePath();
      break;
    case 'umbra':
      g.fillStyle(color, 1);
      g.fillCircle(ox + 5 * s, oy + 5 * s, 4.2 * s);
      g.fillStyle(palette.bgRaised, 1);
      g.fillCircle(ox + 6.9 * s, oy + 5 * s, 3.3 * s);
      break;
  }
}

/**
 * A tilled bed.
 *
 * No painted plot art was supplied, so this is drawn — but drawn as soil rather
 * than as a rectangle: a raised edge, furrows that vary, and grit scattered
 * across them. Deterministic, because a plot that reshuffles its own dirt on
 * every redraw is distracting.
 */
function makePlotTile(scene: Phaser.Scene): void {
  const w = CELL * 2;
  const h = CELL * 1.5;
  const made = texture(scene, 'plot', w, h);
  if (!made) return;
  const { g, commit } = made;

  // Frame first, so the soil sits inside a lip and reads as a raised bed.
  g.fillStyle(0x3a2e20, 1);
  g.fillRoundedRect(0, 0, w, h, 7);
  g.fillStyle(0x241c14, 1);
  g.fillRoundedRect(3, 3, w - 6, h - 6, 5);

  // Furrows: alternating light and dark ridges, as ploughed earth catches light.
  const rows = 5;
  for (let i = 0; i < rows; i += 1) {
    const y = 8 + ((h - 16) * i) / rows;
    const band = (h - 16) / rows;
    g.fillStyle(i % 2 === 0 ? 0x2c2318 : 0x201911, 1);
    g.fillRect(7, y, w - 14, band * 0.82);
    g.fillStyle(0x3d3122, 0.5);
    g.fillRect(7, y, w - 14, 1.5);
  }

  // Grit, from a fixed sequence so the same plot is the same plot every frame.
  let seed = 1337;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  g.fillStyle(0x4a3b28, 0.55);
  for (let i = 0; i < 60; i += 1) {
    g.fillRect(8 + next() * (w - 16), 8 + next() * (h - 16), 1.5, 1.5);
  }

  commit();
}

function makeCauldron(scene: Phaser.Scene): void {
  const made = texture(scene, 'cauldron', CELL * 3, CELL * 3);
  if (!made) return;
  const { g, commit } = made;
  const cx = CELL * 1.5;

  g.fillStyle(0x1d2422, 1);
  g.fillEllipse(cx, CELL * 1.9, CELL * 2.4, CELL * 2);
  g.lineStyle(3, 0x36423d, 1);
  g.strokeEllipse(cx, CELL * 1.9, CELL * 2.4, CELL * 2);

  g.fillStyle(palette.goodWash, 1);
  g.fillEllipse(cx, CELL * 1.25, CELL * 2.05, CELL * 0.7);
  g.lineStyle(2, palette.good, 0.8);
  g.strokeEllipse(cx, CELL * 1.25, CELL * 2.05, CELL * 0.7);

  commit();
}

/**
 * A board with a lip and a shadow under it.
 *
 * The old version was a flat bar, which read as a line rather than a surface —
 * bottles appeared to float above a stripe. A lit top edge, a darker face and a
 * cast shadow are enough to say "things stand on this".
 */
function makeShelf(scene: Phaser.Scene): void {
  const w = CELL * 4;
  const h = CELL;
  const made = texture(scene, 'shelf', w, h);
  if (!made) return;
  const { g, commit } = made;

  const top = h * 0.62;
  const thickness = h * 0.2;

  // Shadow first, so the board sits on top of it.
  g.fillStyle(0x000000, 0.35);
  g.fillRect(6, top + thickness, w - 12, h * 0.12);

  g.fillStyle(0x3a2c1d, 1);
  g.fillRect(0, top, w, thickness);
  // Lit edge along the front lip.
  g.fillStyle(0x5a462e, 1);
  g.fillRect(0, top, w, 2.5);
  // Darker underside, where the board turns away from the light.
  g.fillStyle(0x241b12, 1);
  g.fillRect(0, top + thickness - 3, w, 3);

  // Two brackets, so the board reads as fixed to a wall rather than hovering.
  g.fillStyle(0x2b2116, 1);
  for (const x of [w * 0.14, w * 0.86]) {
    g.fillRect(x - 3, top + thickness, 6, h * 0.16);
  }

  commit();
}

function makeBottle(scene: Phaser.Scene): void {
  const made = texture(scene, 'bottle', CELL, CELL * 1.5);
  if (!made) return;
  const { g, commit } = made;
  const cx = CELL / 2;

  g.fillStyle(0x8fd4c3, 0.22);
  g.fillRect(cx - 7, 8, 14, 18);
  g.fillRoundedRect(cx - 17, 24, 34, 60, 8);
  g.lineStyle(2, 0xa9bdb6, 0.8);
  g.strokeRect(cx - 7, 8, 14, 18);
  g.strokeRoundedRect(cx - 17, 24, 34, 60, 8);

  // Tinted at runtime by the potion's blend, which is why the fill is neutral.
  g.fillStyle(0xffffff, 0.9);
  g.fillRoundedRect(cx - 13, 44, 26, 36, 6);

  commit();
}

/** Blend an essence vector into one colour, for tinting a bottle's contents. */
export function blendColor(vector: EssenceVector): number {
  let total = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (const essence of ESSENCES) {
    const weight = vector[essence];
    if (weight <= 0) continue;
    const color = essenceColors[essence];
    r += ((color >> 16) & 0xff) * weight;
    g += ((color >> 8) & 0xff) * weight;
    b += (color & 0xff) * weight;
    total += weight;
  }

  if (total === 0) return palette.textFaint;
  return ((r / total) << 16) | ((g / total) << 8) | (b / total);
}
