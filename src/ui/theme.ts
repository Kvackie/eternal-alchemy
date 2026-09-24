/**
 * The shared visual language.
 *
 * One palette, used by both halves of the UI: the DOM panels read it through CSS
 * custom properties, the Phaser scenes read it through these numbers. Defining it
 * once is what stops the canvas and the panels drifting apart.
 *
 * Essence colours are chosen for luminance separation as well as hue, and every
 * one of them is paired with a glyph — colour is never the only signal.
 */

import type { Essence } from '@/sim/types';

export const palette = {
  bgPage: 0x120d18,
  bgPanel: 0x1b1422,
  bgRaised: 0x251c2d,
  bgInset: 0x0d0911,
  text: 0xf1e7d3,
  textDim: 0xcdbfa5,
  textFaint: 0x9e917e,
  border: 0x45352a,
  brass: 0xd4ae5c,
  good: 0x5fb89a,
  goodText: 0x94d8c0,
  goodWash: 0x173029,
  warn: 0xe0ac48,
  warnWash: 0x33261a,
} as const;

export const essenceColors: Record<Essence, number> = {
  ignis: 0xee7250,
  aqua: 0x5ca9e8,
  terra: 0xc7ac3c,
  aer: 0xac9bf0,
  umbra: 0x9f92b4,
};

/** CSS-side equivalents, so panels and canvas never disagree about a colour. */
export const essenceCss: Record<Essence, string> = {
  ignis: '#EE7250',
  aqua: '#5CA9E8',
  terra: '#C7AC3C',
  aer: '#AC9BF0',
  umbra: '#9F92B4',
};

/**
 * Glyph paths on a 10×10 grid — triangle, droplet, square, chevron, crescent.
 *
 * Distinct silhouettes, so an essence is identifiable with no colour vision at
 * all. Used in the DOM as inline SVG and drawn directly in Phaser.
 */
export const essenceGlyphPath: Record<Essence, string> = {
  ignis: 'M5 .8 9.3 9.2H.7Z',
  aqua: 'M5 .8c3.2 4 4.3 6.1 0 8.4C.7 6.9 1.8 4.8 5 .8Z',
  terra: 'M1.4 1.4h7.2v7.2H1.4Z',
  aer: 'M.9 7.4 5 1.6l4.1 5.8',
  umbra: 'M7.9 1.5a4.2 4.2 0 1 0 0 7 3.3 3.3 0 1 1 0-7Z',
};

/** Aer is the one glyph drawn as a stroke rather than a fill. */
export const essenceGlyphStroked: Record<Essence, boolean> = {
  ignis: false,
  aqua: false,
  terra: false,
  aer: true,
  umbra: false,
};

export function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Inline SVG for an essence glyph, sized in em so it scales with text. */
export function essenceGlyphSvg(essence: Essence, size = 11): string {
  const path = essenceGlyphPath[essence];
  const stroked = essenceGlyphStroked[essence];
  const paint = stroked
    ? `fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"`
    : `fill="currentColor"`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 10 10" aria-hidden="true"><path d="${path}" ${paint}/></svg>`;
}

/**
 * Day-phase lighting.
 *
 * One painted scene, four gradings — an overlay tint and strength rather than
 * four sets of art. This is the whole day/night art budget.
 */
export const phaseTint: Record<string, { color: number; alpha: number }> = {
  dawn: { color: 0xf0a860, alpha: 0.16 },
  day: { color: 0xffffff, alpha: 0 },
  dusk: { color: 0xd4703c, alpha: 0.2 },
  night: { color: 0x2a3f6b, alpha: 0.42 },
};
