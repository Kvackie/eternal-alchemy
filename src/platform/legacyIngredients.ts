/**
 * The ingredient set before the rebuild, for migrating saves.
 *
 * 391 ingredients became 151 on a clean strength scale. Every one that went is
 * folded into the kept ingredient of the same kind closest to it in essence;
 * seeds of a crop that went become seeds of the nearest herb, and spores of a
 * species that went become spores of the nearest fungus. Only a save migration
 * reads this.
 */

/** Kept ingredient → the ones that fold into it. */
const INGREDIENTS: Record<string, string[]> = {
  autumnmaple: [
    'acorn', 'amberTuber', 'barkslab', 'blossombranch', 'clawroot', 'crimsontop', 'emberbundle',
    'fanfungus', 'flamepetal', 'goldleaf', 'husknut', 'oakmast', 'oldMandragora', 'pepperBerry',
    'roots', 'sunberry', 'sunribbon', 'sweetHoney', 'witherleaf', 'yellowTulip',
  ],
  barkAgate: [
    'barkQuartz', 'barkStone', 'chalkJasper', 'chalkShard', 'clayGarnet', 'flintQuartz',
    'ironAgate', 'ironGarnet', 'ironGlass', 'loamShard', 'slateGarnet',
  ],
  bilberry: [
    'azurefan', 'blueberryThistle', 'cottonFluff', 'ice', 'tidebulb', 'tidecluster', 'whitedaisy',
    'wispcoil',
  ],
  brineGlass: [
    'brineJasper', 'loamQuartz', 'mireShard', 'rillOpal',
  ],
  brineTopaz: [
    'dewOpal', 'frostGarnet', 'frostPrism', 'mireGeode', 'mireJasper', 'mireTopaz', 'rillGlass',
    'rillJasper', 'rillShard', 'tideGlass', 'tideJasper', 'tideTopaz',
  ],
  broadleaf: [
    'azureberry', 'bladegrass', 'blueBud', 'coinleaf', 'cottonSky', 'curlwhorl', 'driftbranch',
    'fanleaf', 'fiddlehead', 'flameWeed', 'fourleafClover', 'goldyarrow', 'grass', 'grassmandrake',
    'greenBerry', 'greenhook', 'greenolive', 'heartleaf', 'hollysprig', 'ivyleaf', 'lacewort',
    'oakmoss', 'paleLeek', 'pinkclover', 'plumeleaf', 'podleaf', 'purplethistle', 'redcurrant',
    'roseberry', 'rowanberry', 'sawgrass', 'sawleaf', 'scalebark', 'scrollleaf', 'shadefern',
    'snapmaw', 'snarlgrass', 'spiderbloom', 'springcurl', 'sunspike', 'thicketleaf', 'thornspiral',
    'thornvine', 'tussock', 'twistroot', 'willowleaf', 'wintercherry', 'youngtree',
  ],
  chalkGeode: [
    'flintBeryl', 'loamGlass', 'slateTopaz',
  ],
  chalkGlass: [
    'clayQuartz',
  ],
  chalkNodule: [
    'barkShard', 'flintCrystal', 'flintGarnet',
  ],
  cinderOpal: [
    'cinderTopaz', 'coalAgate', 'coalGlass', 'coalQuartz', 'emberGlass', 'emberOpal',
    'emberQuartz', 'emberSpar', 'emberstone', 'flareGeode', 'flareOpal', 'flareTopaz',
    'forgeGlass', 'forgeSpar', 'pyreGarnet', 'scaldGlass',
  ],
  cinderQuartz: [
    'scaldAgate', 'scaldGeode', 'scaldJasper', 'scaldQuartz', 'scaldTopaz',
  ],
  cinderleaf: [
    'coilbulb', 'emberconch', 'emberroot', 'flamefrond', 'scarletmaple', 'youngRose',
  ],
  cloudJasper: [
    'duskPrism', 'nightPrism', 'shadeJasper', 'skyGarnet', 'skyGlass', 'veilGarnet', 'waneGarnet',
    'waneGeode', 'waneQuartz', 'wispAgate',
  ],
  dandelion: [
    'antlerbranch', 'ashblade', 'barkchip', 'dewblade', 'dryroot', 'emberFruit', 'ghostroot',
    'goldbeet', 'goldcoral', 'goldfrond', 'goldiris', 'goldspike', 'hairroot', 'honeycombFlower',
    'jadeberry', 'mandragora', 'peapod', 'puffpod', 'scarletbud', 'shalecap', 'sunflower',
    'thornbranch', 'uncommonRoot', 'vinestaff',
  ],
  deepCrystal: [
    'brineGarnet', 'brineShard', 'mireQuartz', 'tideGarnet', 'tidePrism', 'tideShard',
  ],
  deepJasper: [
    'dewAgate', 'rillGarnet',
  ],
  emberCrystal: [
    'emberGeode', 'flareShard',
  ],
  emberJasper: [
    'cinderGlass', 'flareQuartz', 'pyreGeode', 'pyreQuartz', 'voidGarnet',
  ],
  emberShard: [
    'emberAgate', 'emberTopaz', 'flareGlass', 'flareJasper', 'forgeBeryl', 'forgeJasper',
    'forgeQuartz',
  ],
  flamefan: [
    'witchCap',
  ],
  forgeOpal: [
    'cinderGarnet', 'coalShard', 'flintAgate', 'flintShard', 'pyreShard', 'slateGlass',
    'slateJasper', 'slateQuartz',
  ],
  galeGarnet: [
    'aetherGarnet', 'skyPrism', 'zephyrGlass',
  ],
  greensprig: [
    'budsprig', 'commonWeed', 'greenclover', 'inkcap', 'tealberry', 'toothvine', 'uncommonWeed',
  ],
  magicRoot: [
    'uniqueRoot',
  ],
  mirePrism: [
    'brineOpal', 'brineStone', 'dewGarnet', 'dewQuartz', 'dewShard', 'frostAgate', 'frostGlass',
    'frostJasper', 'frostQuartz', 'frostSpar', 'mireBeryl', 'mireGlass', 'rillCrystal',
    'tideBeryl',
  ],
  quicksilverTear: [
    'bloodgrass',
  ],
  rillQuartz: [
    'driftGlass', 'galeQuartz',
  ],
  seagrass: [
    'algae', 'fanFlower', 'scaleleaf',
  ],
  vampirRose: [
    'dragonFlower', 'monsterRoot', 'salamanderScale',
  ],
  veilJasper: [
    'wispShard',
  ],
  waneOnyx: [
    'shadeSpar', 'voidQuartz',
  ],
  wispGarnet: [
    'skySpar',
  ],
};

/** Kept crop → the crops whose seeds fold into it. */
const SEEDS: Record<string, string[]> = {
  autumnmaple: [
    'acorn', 'amberTuber', 'barkslab', 'clawroot', 'crimsontop', 'emberbundle', 'fanfungus',
    'flamepetal', 'husknut', 'oakmast', 'oldMandragora', 'pepperBerry', 'roots', 'sunberry',
    'sweetHoney', 'yellowTulip',
  ],
  bilberry: [
    'azurefan', 'blueberryThistle', 'cottonFluff', 'ice', 'tidebulb', 'tidecluster', 'whitedaisy',
  ],
  broadleaf: [
    'azureberry', 'blueBud', 'cottonSky', 'goldyarrow', 'greenBerry', 'greenhook', 'greenolive',
    'lacewort', 'paleLeek', 'pinkclover', 'purplethistle', 'redcurrant', 'roseberry', 'rowanberry',
    'scalebark', 'snapmaw', 'spiderbloom', 'thornspiral', 'twistroot', 'wintercherry', 'youngtree',
  ],
  cinderleaf: [
    'emberconch', 'emberroot', 'youngRose',
  ],
  dandelion: [
    'barkchip', 'dryroot', 'emberFruit', 'ghostroot', 'goldbeet', 'goldiris', 'honeycombFlower',
    'jadeberry', 'mandragora', 'peapod', 'puffpod', 'scarletbud', 'shalecap', 'sunflower',
    'uncommonRoot',
  ],
  greensprig: [
    'greenclover', 'inkcap', 'tealberry',
  ],
  seagrass: [
    'algae', 'dewcap', 'fanFlower',
  ],
};

/** Kept cave species → the species whose spores fold into it. */
const SPORES: Record<string, string[]> = {
  flamefan: [
    'witchCap',
  ],
};

function invert(table: Record<string, string[]>): ReadonlyMap<string, string> {
  return new Map(Object.entries(table).flatMap(([next, olds]) => olds.map((old) => [old, next] as const)));
}

export const LEGACY_INGREDIENTS = invert(INGREDIENTS);
export const LEGACY_SEEDS = invert(SEEDS);
export const LEGACY_SPORES = invert(SPORES);
