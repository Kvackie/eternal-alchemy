/*
 * Background keying shared by `art-dekey.js` and `art-effects.js`.
 *
 * Not "make every background-coloured pixel transparent" — that punches holes
 * through highlights, and a sunlit plank or a glint in a flame is exactly as
 * pale as the background behind it. Instead the fill spreads inward from the
 * borders, so only background actually CONNECTED to the edge is removed and
 * anything enclosed by the artwork survives.
 *
 * The background may be one tone or two. Some art arrives on a painted
 * CHECKERBOARD — the pattern that means "transparent" in a format which cannot
 * hold it — and averaging the corners then gives a colour halfway between the
 * two squares that matches neither, so the flood stops at the first tile
 * boundary with the board still in place. The test is "close to ANY tone".
 *
 * Edge pixels get partial alpha rather than a hard cut: anti-aliasing blends the
 * subject into the background, and a binary threshold leaves either a white
 * fringe or a chewed outline. Alpha ramps across a tolerance band instead.
 *
 * Everything works on a raw RGBA(-ish) buffer from sharp, in place. The callers
 * differ only in where they read the tones, how far apart they must be, and the
 * tolerance band — so those are parameters, and the algorithm lives here once.
 */

/** Largest single-channel gap between two RGB triples. */
export const apart = (a, b) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** Distance from the pixel at byte offset `o` to the NEAREST background tone. */
export function toneDistance(data, o, tones) {
  let best = 255;
  for (const tone of tones) {
    const d = Math.max(
      Math.abs(data[o] - tone[0]),
      Math.abs(data[o + 1] - tone[1]),
      Math.abs(data[o + 2] - tone[2]),
    );
    if (d < best) best = d;
  }
  return best;
}

/**
 * The background tone or tones, read off the image.
 *
 * The first tone is the pixel at (`x`, `y`). The rest of that row, up to (not
 * including) column `span`, is searched for a second tone further than `minGap`
 * from it — far enough to be the other square — and nearer than `maxGap`, so
 * not the artwork. A picture on a flat background simply never finds one, and
 * gets back a single tone.
 *
 * Sampled rather than assumed: a JPEG's "white" is not 255, and the grey is
 * whatever the exporter chose.
 */
export function readTones(data, width, channels, { x = 0, y = 0, span, minGap, maxGap = 256 }) {
  const at = (px) => {
    const o = (y * width + px) * channels;
    return [data[o], data[o + 1], data[o + 2]];
  };
  const first = at(x);
  for (let px = x + 1; px < span; px += 1) {
    const sample = at(px);
    const gap = apart(sample, first);
    if (gap > minGap && gap < maxGap) return [first, sample];
  }
  return [first];
}

/**
 * Key the background out of a raw image buffer, in place.
 *
 * Floods inward from every border pixel through pixels within `soft` of a tone.
 * Each one reached gets alpha 0 inside `tol`, and a ramp up to 255 between `tol`
 * and `soft` for the anti-aliased edge; pixels the flood never reaches keep the
 * alpha they had.
 *
 * An explicit stack rather than recursion because a 1254² image overflows the
 * call stack, and a Uint8Array rather than a Set because this runs once per
 * pixel and allocation dominates otherwise. Pixels are marked as they are
 * pushed, so none is queued twice.
 *
 * Returns how many reached pixels ended with alpha below `clearBelow`.
 */
export function floodKey(data, width, height, channels, tones, { tol, soft, clearBelow }) {
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (i) => {
    if (seen[i]) return;
    if (toneDistance(data, i * channels, tones) > soft) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push(x + (height - 1) * width);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(width - 1 + y * width);
  }

  let cleared = 0;
  while (stack.length) {
    const i = stack.pop();
    const d = toneDistance(data, i * channels, tones);
    const alpha = d <= tol ? 0 : Math.round(((d - tol) / (soft - tol)) * 255);
    data[i * channels + 3] = alpha;
    if (alpha < clearBelow) cleared += 1;

    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  return cleared;
}
