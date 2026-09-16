/* Throwaway: composite one tier with all five effects, exactly as the scene does. */
const sharp = require('sharp');
const OUT = process.argv[2];
const ID = process.argv[3] || 'cauldronTwo';

const BREW = require('./src/data/brewEffects.json').anchors;
const TIERS = require('./src/data/cauldrons.json').tiers;
const FX = ['brewIgnis', 'brewAqua', 'brewTerra', 'brewAer', 'brewUmbra'];

const SIZE = 250;
const CELL = 262;

(async () => {
  const tier = TIERS.find((t) => t.id === ID);
  const o = tier.opening;
  const comp = [];

  for (let i = 0; i < FX.length; i += 1) {
    const a = BREW[FX[i]];
    const left = Math.round(i * CELL + (CELL - SIZE) / 2);
    const top = 24;

    const pot = await sharp(`public/art/scene/${ID}.png`)
      .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const openingY = (o.y + o.sink) * SIZE;
    const side = Math.round((o.w * SIZE * o.fill) / a.rimW);
    const fx = await sharp(`public/art/scene/${FX[i]}.png`)
      .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const openingX = SIZE / 2 + (o.x ?? 0) * SIZE;
    comp.push({ input: pot, left, top });
    comp.push({
      input: fx,
      left: Math.round(left + openingX - a.bottomX * side),
      top: Math.round(top + openingY - a.bottomY * side),
    });
  }

  comp.push({
    input: {
      text: {
        text: `<span foreground="#e0e0e0" size="10000">${ID}  y=${o.y} w=${o.w} fill=${o.fill} sink=${o.sink}</span>`,
        rgba: true,
      },
    },
    left: 8,
    top: 4,
  });

  await sharp({
    create: {
      width: FX.length * CELL,
      height: SIZE + 34,
      channels: 4,
      background: { r: 42, g: 34, b: 28, alpha: 1 },
    },
  })
    .composite(comp)
    .png()
    .toFile(OUT);
  console.log('wrote ' + OUT);
})();
