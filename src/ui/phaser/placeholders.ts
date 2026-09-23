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
import { artUrl, dominantEssence, hasArt } from '@/ui/art';
import { essenceColors, palette } from '@/ui/theme';
import type { Essence } from '@/sim/types';

/** Authoring grid. Everything is a multiple of this so the atlas stays tidy. */
const CELL = 64;

/** The scene art the world draws on every frame — see `preloadArt`. */
const PRELOADED_SCENE_ART = ['plot', 'dirtMound'] as const;

/**
 * Queue the painted sprites the world cannot start without.
 *
 * Called from `preload`, so Phaser's loader handles it before the scene builds.
 * Anything not queued here is either fetched on demand by `ensureTexture` or
 * falls through to a generated badge below, which is what lets painted art
 * replace placeholders a few files at a time.
 */
export function preloadArt(scene: Phaser.Scene): void {
  /*
   * Only what the garden stands on: the bed and the heap of earth under each
   * plant, drawn on every frame of the only screen with a world behind it.
   *
   * Queuing all of it — hundreds of ingredients and potions — meant Phaser held
   * the scene back until the last one arrived, and the world sat empty for over
   * half a minute. The rest is fetched by `ensureTexture` when something is
   * actually about to be drawn, which for a garden of four plots is four files.
   *
   * This used to take every scene, decor and shelf picture too — a couple of
   * dozen files for cauldrons, shelves and furnishings the canvas stopped
   * drawing when those screens became documents. The panels load their own art
   * as plain images, so nothing lost them.
   */
  for (const id of PRELOADED_SCENE_ART) {
    if (hasArt('scene', id)) scene.load.image(id, artUrl('scene', id));
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
}

function texture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
): {
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

/**
 * An essence glyph in Graphics calls: the shapes of `essenceGlyphPath`, on the
 * same 10×10 grid, so a badge on the canvas and a glyph in the panel agree.
 */
function drawGlyphShape(
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
