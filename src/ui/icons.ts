/**
 * Interface icons: the nav and the currency readouts.
 *
 * Drawn by Lorc and Delapouite for game-icons.net, CC BY 3.0 — credited on the
 * Credits page, which reads the authors from the same file. `scripts/gen-icons.js`
 * writes that file from the sources in art/icons/.
 *
 * Each is one path on a 512 grid filled with `currentColor`, so an icon takes
 * the colour of the text around it and follows the theme without a variant.
 */

import data from '@/data/icons.json';

export type IconId = keyof typeof data.icons;

/** Which author drew which icons, for the Credits page. */
export function iconsByAuthor(): Array<{ name: string; url: string; icons: string[] }> {
  return Object.entries(data.authors).map(([id, author]) => ({
    ...author,
    icons: Object.values(data.icons)
      .filter((icon) => icon.author === id)
      .map((icon) => icon.name.replace(/-/g, ' ')),
  }));
}

/** The icon as inline SVG markup, sized in CSS pixels, decorative. */
export function iconSvg(id: IconId, size = 20): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" ` +
    `height="${size}" aria-hidden="true" focusable="false">` +
    `<path fill="currentColor" d="${data.icons[id].d}"/></svg>`
  );
}
