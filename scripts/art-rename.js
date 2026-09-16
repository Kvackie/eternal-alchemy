/*
 * Normalise source art filenames to game ids.
 *
 * Filenames are the contract between the art folder and `src/data`, so they have
 * to be camelCase ids. Two jobs:
 *   - the explicit map below, for files whose names carry no meaning (g_01, m_04)
 *   - mechanical tidying for the rest: `.PNG` -> `.png`, spaces and hyphens out,
 *     first letter lowered.
 *
 * Idempotent: running it twice is a no-op, and it refuses to overwrite.
 *
 *   node scripts/art-rename.js [--apply]
 */
import { readdirSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');

/** Named from the contact sheets — 43 foliage, 19 fungi, and three strays. */
const EXPLICIT = {
  // g_* — foliage, herbs and fronds
  g_01: 'shadefern',
  g_02: 'coinleaf',
  g_03: 'snarlgrass',
  g_04: 'flamefrond',
  g_05: 'goldspike',
  g_06: 'curlwhorl',
  g_07: 'emberbranch',
  g_08: 'tidecluster',
  g_09: 'bonefrond',
  g_10: 'cinderleaf',
  g_11: 'tussock',
  g_12: 'frostrosette',
  g_13: 'bloodgrass',
  g_14: 'witherleaf',
  g_15: 'springcurl',
  g_16: 'scarletmaple',
  g_17: 'goldiris',
  g_18: 'wispcoil',
  g_19: 'oakmoss',
  g_20: 'bluepetal',
  g_21: 'sunribbon',
  g_22: 'thicketleaf',
  g_23: 'fiddlehead',
  g_24: 'hairroot',
  g_25: 'scrollleaf',
  g_26: 'grassmandrake',
  g_27: 'azurefan',
  g_28: 'ashsprig',
  g_29: 'broadleaf',
  g_30: 'spiderbloom',
  g_31: 'goldcoral',
  g_32: 'heartleaf',
  g_33: 'toothvine',
  g_34: 'sawgrass',
  g_35: 'dewblade',
  g_36: 'scaleleaf',
  g_37: 'plumeleaf',
  g_38: 'fourleafClover',
  g_39: 'cleftleaf',
  g_40: 'thornvine',
  g_41: 'bladegrass',
  g_42: 'sawleaf',
  g_43: 'autumnmaple',

  // m_* — fungi for the cave
  m_01: 'ambercap',
  m_02: 'mosscap',
  m_03: 'flamefan',
  m_04: 'honeycap',
  m_05: 'glowspindle',
  m_06: 'loamcap',
  m_07: 'puffnest',
  m_08: 'bubblecap',
  m_09: 'tubefungus',
  m_10: 'spotcap',
  m_11: 'sunfungus',
  m_12: 'buttercap',
  m_13: 'eyecap',
  m_14: 'azurecap',
  m_15: 'violetcap',
  m_16: 'goldcap',
  m_17: 'russetcap',
  m_18: 'inkcap',
  m_19: 'crimsoncap',

  // A second fungus pack, whose numbering said nothing about the art.
  mushroom: 'cellarcap',
  mushroom01: 'mosstier',
  mushroom02: 'toadstool',
  mushroom03: 'trumpetgill',
  mushroom04: 'stoutcap',
  mushroom05: 'bluecone',
  mushroom06: 'palecap',
  mushroom07: 'verdigriscap',
  mushroom08: 'coalcap',
  mushroomLayered: 'tieredcap',

  // A berry, pod and bone pack — named from the contact sheet.
  b_01: 'sloeberry',
  b_02: 'jadeberry',
  b_03: 'tidebulb',
  b_04: 'violetpod',
  b_05: 'scarletbud',
  b_06: 'wintercherry',
  b_07: 'goldbeet',
  b_08: 'azureberry',
  b_09: 'clawroot',
  b_10: 'roseberry',
  b_11: 'scalebark',
  b_12: 'snapmaw',
  b_13: 'coilbulb',
  b_14: 'fanfungus',
  b_15: 'emberconch',
  b_16: 'greenolive',
  b_17: 'rowanberry',
  b_18: 'curlflame',
  b_19: 'tidewisp',
  b_20: 'bonefang',
  b_21: 'barkchip',
  b_22: 'flamepetal',
  b_23: 'husknut',
  b_24: 'oakmast',
  b_25: 'sunberry',
  b_26: 'duskberry',
  b_27: 'puffpod',
  b_28: 'peapod',
  b_29: 'barkslab',

  // A herb pack.
  h_01_t: 'lacewort',
  h_02_t: 'goldyarrow',
  h_03_t: 'thornspiral',
  h_04_t: 'goldfrond',
  h_08_t: 'violetroot',
  h_09_t: 'greenhook',
  h_10_t: 'pinklotus',
  h_11_t: 'broomgrass',
  h_12_t: 'budsprig',
  h_13_t: 'ghostroot',
  h_14_t: 'violetgarlic',
  h_15_t: 'fanleaf',
  h_16_t: 'roseSalt',
  h_17_t: 'cornflower',
  h_18_t: 'purplethistle',
  h_19_t: 'emberbundle',
  h_20_t: 'hollysprig',
  h_21_t: 'wisteria',
  h_22_t: 'blossombranch',
  h_23_t: 'pinkclover',
  h_24_t: 'sunspike',
  h_25_t: 'amberTuber',
  h_26_t: 'bluecoral',
  h_27_t: 'vinestaff',
  h_28_t: 'duskplum',
  h_29_t: 'crimsonbloom',
  h_30_t: 'nightbloom',
  h_31_t: 'ivyleaf',
  h_32_t: 'shalecap',
  h_33_t: 'youngtree',
  h_34_t: 'willowleaf',
  h_35_t: 'driftbranch',
  h_36_t: 'twistroot',
  h_37_t: 'ashblade',

  // Strays from a numbered pack.
  '109_t': 'crimsontop',
  '110_t': 'bilberry',
  '111_t': 'greenclover',
  '112_t': 'frostfan',
  '113_t': 'lilypad',
  '114_t': 'antlerbranch',
  '115_t': 'thornbranch',
  '116_t': 'redcurrant',
  '117_t': 'paleLeek',
  '118_t': 'magentaleaf',
  '119_t': 'podleaf',
  '120_t': 'tealberry',
  '11_t': 'goldleaf',
  '13_t': 'violetshroom',
  '29_t': 'greensprig',
  '46_t': 'dryroot',
  f_23: 'whitedaisy',

  // strays
  Chrysta: 'chrystaLily',
  gr_01: 'seagrass',
  lr_f_01: 'voideel',

  // decor — named for what they are, since the pack names carry nothing
  NecromancerIcons_03_t: 'skullChalice',
  NecromancerIcons_04_t: 'boneChalice',
  TradingIcons_03_t: 'coinSacks',
  TradingIcons_08_t: 'lockedChest',
  TradingIcons_53_t: 'pottedFern',
  TradingIcons_62_t: 'sproutingUrn',
  artifact_02_t: 'mortarAndPestle',
  artifact_05_t: 'goldGoblet',
  artifact_12_t: 'hourglass',
  banner_01_01: 'crimsonBanner',
  banner_02_01: 'tealBanner',
  gobilen_t_01: 'roseBanner',
  gobilen_t_02: 'violetBanner',
  gobilen_t_03: 'azureBanner',
  gobilen_t_04: 'goldBanner',
  gobilen_t_05: 'verdantBanner',
  gem_01: 'cutDiamond',
  gold_01: 'coinStack',
  pot_f_t_01: 'ironPot',
};

/** `magma fish` -> `magmaFish`, `mana-fruit` -> `manaFruit`, `Ice` -> `ice`. */
function tidy(stem) {
  const parts = stem.split(/[\s._-]+/).filter(Boolean);
  const joined = parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
  return joined.charAt(0).toLowerCase() + joined.slice(1);
}

const dirs = ['art/ingredients', 'art/decor'];
let renamed = 0;
let already = 0;
const collisions = [];

for (const dir of dirs) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (!/\.png$/i.test(file)) continue;
    const stem = file.replace(/\.png$/i, '');
    const target = (EXPLICIT[stem] ?? tidy(stem)) + '.png';
    if (target === file) {
      already += 1;
      continue;
    }

    const from = path.join(dir, file);
    const to = path.join(dir, target);

    // Case-only renames look like collisions on Windows; they are not.
    if (existsSync(to) && to.toLowerCase() !== from.toLowerCase()) {
      collisions.push(`${from} -> ${target} (target exists)`);
      continue;
    }

    if (APPLY) {
      // Two-step through a temp name, so a case-only change actually lands.
      const temp = path.join(dir, `__tmp__${target}`);
      renameSync(from, temp);
      renameSync(temp, to);
    } else {
      console.log(`${file}  ->  ${target}`);
    }
    renamed += 1;
  }
}

console.log(`\n${renamed} to rename, ${already} already correct`);
if (collisions.length) {
  console.log('\nCOLLISIONS (skipped):');
  for (const c of collisions) console.log('  ' + c);
}
if (!APPLY) console.log('\nDry run. Re-run with --apply to rename.');
