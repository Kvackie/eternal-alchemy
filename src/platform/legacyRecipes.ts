/**
 * The recipe book before the 31 potions, for migrating saves.
 *
 * Every old recipe folds into the new one made of the same essences — a Health
 * Tonic was Aqua and Terra, so it is the Aqua–Terra potion now. Only a save
 * migration reads this; nothing in the game names these ids any more. Murk had
 * no successor and is not listed: v14 pours it away.
 */

const BY_NEW_RECIPE: Record<string, string[]> = {
  ignis: [
    'emberCommon', 'emberGrand', 'emberGreater', 'emberMinor', 'emberSovereign', 'scaldPhiltre',
  ],
  aqua: [
    'deepwaterCordial', 'tideCommon', 'tideGrand', 'tideGreater', 'tideMinor', 'tideSovereign',
  ],
  terra: [
    'chalkDraught', 'ironskinSalve', 'loamCommon', 'loamGrand', 'loamGreater', 'loamMinor',
    'loamSovereign',
  ],
  aer: [
    'galeCommon', 'galeGrand', 'galeGreater', 'galeMinor', 'galeSovereign', 'skysalt',
  ],
  umbra: [
    'nightGlass', 'shadeCommon', 'shadeGrand', 'shadeGreater', 'shadeMinor', 'shadeSovereign',
  ],
  ignisAqua: [
    'emberTideCommon', 'emberTideGrand', 'emberTideGreater', 'emberTideMinor',
    'emberTideSovereign', 'scaldrillTincture', 'sunfireTincture',
  ],
  ignisTerra: [
    'chalkcinderCordial', 'emberDraught', 'emberLoamCommon', 'emberLoamGrand', 'emberLoamGreater',
    'emberLoamMinor', 'emberLoamSovereign', 'scaldclayTonic',
  ],
  ignisAer: [
    'cinderskyTincture', 'emberGaleCommon', 'emberGaleGrand', 'emberGaleGreater', 'emberGaleMinor',
    'emberGaleSovereign', 'stormfireFlask',
  ],
  ignisUmbra: [
    'cinderveilBomb', 'emberShadeCommon', 'emberShadeGrand', 'emberShadeGreater',
    'emberShadeMinor', 'emberShadeSovereign', 'embershadeCordial',
  ],
  aquaTerra: [
    'brineflintTincture', 'flintbrineElixir', 'healthTonic', 'tideLoamCommon', 'tideLoamGrand',
    'tideLoamGreater', 'tideLoamMinor', 'tideLoamSovereign',
  ],
  aquaAer: [
    'brinecloudTonic', 'rilldriftDraught', 'tideGaleCommon', 'tideGaleGrand', 'tideGaleGreater',
    'tideGaleMinor', 'tideGaleSovereign', 'windDraught',
  ],
  aquaUmbra: [
    'mirebloomElixir', 'mireveilExtract', 'tideShadeCommon', 'tideShadeGrand', 'tideShadeGreater',
    'tideShadeMinor', 'tideShadeSovereign', 'veilmireDraught',
  ],
  terraAer: [
    'featherstoneDraught', 'flintcloudPhiltre', 'loamGaleCommon', 'loamGaleGrand',
    'loamGaleGreater', 'loamGaleMinor', 'loamGaleSovereign',
  ],
  terraUmbra: [
    'barkveilElixir', 'chalkgraveInfusion', 'loamShadeCommon', 'loamShadeGrand',
    'loamShadeGreater', 'loamShadeMinor', 'loamShadeSovereign', 'shadowPhiltre',
  ],
  aerUmbra: [
    'galeShadeCommon', 'galeShadeGrand', 'galeShadeGreater', 'galeShadeMinor',
    'galeShadeSovereign', 'galeshadeTonic', 'wraithwindVial',
  ],
  ignisAquaTerra: [
    'emberTideLoamCommon', 'emberTideLoamGrand', 'emberTideLoamGreater', 'emberTideLoamMinor',
    'emberTideLoamSovereign', 'pilgrimsRestorative', 'scaldrillElixir',
  ],
  ignisAquaAer: [
    'coalbrineDraught', 'emberTideGaleCommon', 'emberTideGaleGrand', 'emberTideGaleGreater',
    'emberTideGaleMinor', 'emberTideGaleSovereign', 'pyremireTonic', 'tideemberPhiltre',
  ],
  ignisAquaUmbra: [
    'cinderdewExtract', 'emberTideShadeCommon', 'emberTideShadeGrand', 'emberTideShadeGreater',
    'emberTideShadeMinor', 'emberTideShadeSovereign', 'embertideInfusion',
  ],
  ignisTerraAer: [
    'coalflintCordial', 'emberLoamGaleCommon', 'emberLoamGaleGrand', 'emberLoamGaleGreater',
    'emberLoamGaleMinor', 'emberLoamGaleSovereign', 'pyrebarkPhiltre',
  ],
  ignisTerraUmbra: [
    'cinderchalkElixir', 'emberLoamShadeCommon', 'emberLoamShadeGrand', 'emberLoamShadeGreater',
    'emberLoamShadeMinor', 'emberLoamShadeSovereign', 'emberloamDraught',
  ],
  ignisAerUmbra: [
    'coalcloudExtract', 'emberGaleShadeCommon', 'emberGaleShadeGrand', 'emberGaleShadeGreater',
    'emberGaleShadeMinor', 'emberGaleShadeSovereign', 'pyrezephyrInfusion', 'pyrezephyrTincture',
  ],
  aquaTerraAer: [
    'dewchalkTonic', 'tideLoamGaleCommon', 'tideLoamGaleGrand', 'tideLoamGaleGreater',
    'tideLoamGaleMinor', 'tideLoamGaleSovereign', 'verdantAether',
  ],
  aquaTerraUmbra: [
    'rillclayInfusion', 'tideLoamShadeCommon', 'tideLoamShadeGrand', 'tideLoamShadeGreater',
    'tideLoamShadeMinor', 'tideLoamShadeSovereign', 'tideloamExtract',
  ],
  aquaAerUmbra: [
    'dewskyPhiltre', 'tideGaleShadeCommon', 'tideGaleShadeGrand', 'tideGaleShadeGreater',
    'tideGaleShadeMinor', 'tideGaleShadeSovereign', 'tidegaleElixir', 'veilmireCordial',
  ],
  terraAerUmbra: [
    'claydriftCordial', 'loamGaleShadeCommon', 'loamGaleShadeGrand', 'loamGaleShadeGreater',
    'loamGaleShadeMinor', 'loamGaleShadeSovereign', 'loamgaleTincture',
  ],
  ignisAquaTerraAer: [
    'embertideExtract', 'scaldrillInfusion',
  ],
  ignisAquaTerraUmbra: [
    'coalbrineTincture', 'pyremireCordial',
  ],
  ignisAquaAerUmbra: [
    'cinderdewPhiltre', 'embertideElixir',
  ],
  ignisTerraAerUmbra: [
    'cinderchalkTonic', 'coalflintTonic', 'driftscaldDraught', 'pyrebarkExtract',
  ],
  aquaTerraAerUmbra: [
    'clayrillCordial', 'cloudbrinePhiltre', 'dewchalkDraught', 'dewchalkInfusion',
    'loamtideTincture', 'tideloamTonic', 'veilmireElixir',
  ],
  ignisAquaTerraAerUmbra: [

  ],
};

/** Old recipe id → the potion it became. */
export const LEGACY_RECIPES: ReadonlyMap<string, string> = new Map(
  Object.entries(BY_NEW_RECIPE).flatMap(([next, olds]) => olds.map((old) => [old, next] as const)),
);
