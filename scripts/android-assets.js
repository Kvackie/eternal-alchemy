/*
 * Paint the Android launcher icon and splash screen.
 *
 * The native project is generated, not committed (see ANDROID.md), so its
 * resources are Capacitor's placeholders until something writes over them. This
 * does, after `npx cap add android`: every launcher icon and splash image the
 * template ships is redrawn at its own size, so a template that adds or drops a
 * density is followed rather than guessed at.
 *
 * The picture is the golden flask from the potion art, on the game's plum-black
 * ground, and nothing else — no lettering, which would be unreadable at launcher
 * size and only there for a moment on the splash.
 *
 *   node scripts/android-assets.js
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const RES = 'android/app/src/main/res';
const SOURCE = 'art/potions/scaldclayTonic.png';
const GROUND = '#120d18';

/*
 * How much of each canvas the flask may fill, measured on its longer side.
 *
 * An adaptive icon's foreground is masked to whatever shape the launcher uses,
 * and only the middle 66% is promised to survive every mask, so the flask stays
 * well inside that. The legacy icons are drawn whole and can take more.
 */
const FILL = {
  foreground: 0.5,
  legacy: 0.7,
  splash: 0.24,
};

if (!existsSync(RES)) {
  console.error(`No ${RES}: run \`npx cap add android\` first.`);
  process.exit(1);
}

/*
 * The flask, cut free of its haze.
 *
 * The painting's glow fades out to a few percent alpha but never to nothing, so
 * it fills the whole square: trimming finds no edge, and on the icon's ground
 * the haze shows as a faint box around the bottle. Anything that faint is
 * dropped before trimming; the glow close to the glass is far stronger and
 * stays.
 */
const HAZE = 24;
const raw = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < raw.data.length; i += 4) {
  if (raw.data[i + 3] < HAZE) raw.data.fill(0, i, i + 4);
}
const flask = await sharp(raw.data, { raw: raw.info }).trim({ threshold: 0 }).png().toBuffer();

/** The flask scaled to fit a box, as a PNG buffer. */
async function flaskIn(box) {
  return sharp(flask).resize(box, box, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
}

/** A square or rectangular canvas with the flask centred on it. */
async function compose(width, height, fill, { ground = GROUND, mask = null } = {}) {
  const art = await flaskIn(Math.round(Math.min(width, height) * fill));
  const base = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: ground ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  const layers = [{ input: art, gravity: 'centre' }];
  if (mask) layers.push({ input: mask(width, height), blend: 'dest-in' });
  return base.composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

const circle = (w, h) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}"/></svg>`,
  );

const rounded = (w, h) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect width="${w}" height="${h}" rx="${w * 0.18}"/></svg>`,
  );

async function sizeOf(file) {
  const { width, height } = await sharp(file).metadata();
  return { width, height };
}

let written = 0;
for (const dir of readdirSync(RES)) {
  for (const name of readdirSync(path.join(RES, dir))) {
    const file = path.join(RES, dir, name);
    let make;
    if (name === 'ic_launcher_foreground.png') {
      make = (w, h) => compose(w, h, FILL.foreground, { ground: null });
    } else if (name === 'ic_launcher_round.png') {
      make = (w, h) => compose(w, h, FILL.legacy, { mask: circle });
    } else if (name === 'ic_launcher.png') {
      make = (w, h) => compose(w, h, FILL.legacy, { mask: rounded });
    } else if (name === 'splash.png') {
      make = (w, h) => compose(w, h, FILL.splash);
    } else {
      continue;
    }
    const { width, height } = await sizeOf(file);
    writeFileSync(file, await make(width, height));
    written += 1;
  }
}

/*
 * The adaptive icon's ground, and the Android 12+ splash.
 *
 * From Android 12 the system draws its own splash — the launcher icon on a
 * plain colour — before the app's splash image is ever reached, so that colour
 * has to be the game's ground too or every launch opens on white.
 */
const background = path.join(RES, 'values/ic_launcher_background.xml');
writeFileSync(
  background,
  readFileSync(background, 'utf8').replace(
    /(<color name="ic_launcher_background">)[^<]*(<\/color>)/,
    `$1${GROUND.toUpperCase()}$2`,
  ),
);

const styles = path.join(RES, 'values/styles.xml');
const launch = /(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)([\s\S]*?)(<\/style>)/;
const xml = readFileSync(styles, 'utf8');
if (!launch.test(xml)) {
  console.error(`No AppTheme.NoActionBarLaunch in ${styles}; the template has changed.`);
  process.exit(1);
}
writeFileSync(
  styles,
  xml.replace(launch, (_, open, body, close) => {
    const kept = body.replace(/\s*<item name="windowSplashScreen[^"]*">[^<]*<\/item>/g, '');
    return (
      `${open}${kept.trimEnd()}\n` +
      `        <item name="windowSplashScreenBackground">${GROUND}</item>\n` +
      `        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>\n` +
      `    ${close}`
    );
  }),
);

console.log(`android assets: ${written} images redrawn, launcher ground and splash colour set`);
