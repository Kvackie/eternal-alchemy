/**
 * Typed access to the game's data files.
 *
 * The JSON is the source of truth so every number stays diffable in git and
 * tunable at runtime from the debug panel. This module gives it types and a
 * few derived lookups; it holds no rules of its own.
 */

import rawConfig from '@/data/config.json';
import rawIngredients from '@/data/ingredients.json';
import rawCrops from '@/data/crops.json';
import rawRecipes from '@/data/recipes.json';
import rawVessels from '@/data/vessels.json';
import rawSeals from '@/data/seals.json';
import rawRanks from '@/data/ranks.json';
import rawEquipment from '@/data/equipment.json';
import rawDecor from '@/data/decor.json';
import rawShelves from '@/data/shelves.json';
import rawMerchants from '@/data/merchants.json';
import rawCave from '@/data/cave.json';
import rawShaft from '@/data/shaft.json';
import rawHeroes from '@/data/heroes.json';
import rawCauldrons from '@/data/cauldrons.json';
import rawContracts from '@/data/contracts.json';
import rawCustomers from '@/data/customers.json';
import rawPrestige from '@/data/prestige.json';

import type {
  Essence,
  EssenceVector,
  FindKind,
  Grade,
  HaggleStance,
  IngredientCategory,
  PotencyTierId,
  SoilId,
} from './types';

export interface IngredientDef {
  id: string;
  category: IngredientCategory;
  essence: EssenceVector;
  traits: string[];
  baseValue: number;
  glyph: string;
}

export interface CropDef {
  id: string;
  yields: string;
  growMs: number;
  yieldCount: number;
  soil: SoilId;
}

/** A recipe as written in `recipes.json`: which essences, in equal measure. */
interface RawRecipe {
  id: string;
  elements: Essence[];
  baseValue: number;
  knownFromStart: boolean;
  /** The potion picture this recipe borrows, by its art id. */
  art: string;
}

/**
 * A recipe is a set of essences in equal measure — one to all five, 31 in all.
 *
 * `target` and `toleranceDeg` are worked out from `elements` when the book
 * loads rather than written down, because both follow from the set and a
 * hand-typed copy could only ever disagree with it.
 */
export interface RecipeDef extends RawRecipe {
  /** One of each essence the recipe asks for, none of the rest. */
  target: EssenceVector;
  /**
   * How far off the ratio a blend may sit and still be this recipe: half the
   * angle to its nearest neighbour, so no two recipes ever claim one blend.
   * Purity runs from 100 at the exact ratio down to 0 at this edge.
   */
  toleranceDeg: number;
}

export interface VesselDef {
  id: string;
  cost: number;
  potencyCap: PotencyTierId;
  valueMultiplier: number;
  appealBonus: number;
  startingStock: number;
  /** How many shelf-slot units one of these occupies when stacked. */
  shelfStack?: number;
  /** Counts as this many units toward a contract. */
  contractUnits?: number;
  /** The only vessel that will hold a Volatile brew. */
  requiredForVolatile?: boolean;
  /** Raises the effective grade when supplied to a hero. */
  supplyGradeBonus?: number;
}

export interface SealDef {
  id: string;
  cost: number;
  appealBonus: number;
  valueMultiplier: number;
  requiresRank?: number;
  /** Renown earned each time an item with this seal sells. */
  renownPerSale?: number;
  /** Fraction added to a contract's payout. */
  contractPayoutBonus?: number;
  supplyGradeBonus?: number;
  /** Fraction added to a haggling customer's ceiling. */
  haggleCeilingBonus?: number;
  /** Only applies to brews with real Umbra in them. */
  umbraOnly?: boolean;
  /** Replaces shelf appeal outright — villagers refuse some marks. */
  shelfAppealOverride?: number;
  /** Multiplies what a barter merchant will give. */
  barterMultiplier?: number;
}

export interface RankDef {
  id: string;
  renown: number;
}

/** What one piece of equipment does. Every field is optional and folded in `progression.ts`. */
export interface EquipmentEffect {
  cauldronCapacity?: number;
  maxIngredients?: number;
  addPlots?: number;
  addShelves?: number;
  seedDropBonus?: number;
  footfallBonus?: number;
  nightFootfallBonus?: number;
  addCaveTiles?: number;
  caveSpreadBonus?: number;
  oreBatchBonus?: number;
  addSupportedDepth?: number;
  addHeroSlots?: number;
  appealBonus?: number;
  haggleCeilingBonus?: number;
  canForceDry?: boolean;
  craftsVessels?: boolean;
  craftsSeals?: boolean;
}

export interface EquipmentDef {
  id: string;
  tree: string;
  cost: number;
  /** Zero-based rank index required before this can be bought. */
  requiresRank: number;
  /** Other equipment that must be owned first. */
  requires?: string[];
  /** How many may be owned. Defaults to 1. */
  repeatable?: number;
  effect: EquipmentEffect;
}

/**
 * What one furnishing does while it is placed.
 *
 * Deliberately a strict subset of `EquipmentEffect`: décor may only ever change
 * how the shop *sells*. A rug that added cauldron capacity would be equipment
 * wearing a rug's name.
 */
export interface DecorEffect {
  appealBonus?: number;
  footfallBonus?: number;
  nightFootfallBonus?: number;
  haggleCeilingBonus?: number;
}

export interface DecorDef {
  id: string;
  /** Which of the shop's spots this occupies. One piece per spot. */
  spot: string;
  cost: number;
  /** Zero-based rank index required before this can be bought. */
  requiresRank: number;
  effect: DecorEffect;
}

export interface DecorConfig {
  /** Back-to-front, which is also the order the world view draws them in. */
  spots: string[];
  pieces: DecorDef[];
}

/**
 * A shelf board.
 *
 * Quality is a property of the shelf, not of the shop: boards are fitted one at
 * a time, so a shop with a single good board decides which shelf deserves it.
 */
export interface ShelfTierDef {
  id: string;
  /** Zero means "what you already have" rather than "free to buy". */
  cost: number;
  requiresRank: number;
  /** Added to the appeal of everything standing on this shelf. */
  appealBonus: number;
}

export interface MerchantStockDef {
  kind: 'seed' | 'spore' | 'ingredient' | 'vessel' | 'seal' | 'equipment' | 'decor' | 'board';
  id: string;
  /** Gold price. Absent on a barter merchant. */
  price?: number;
  stock?: number;
  weight: number;
  /** Relationship tier this entry unlocks at. */
  tier: number;
  /** Price in sealed potions, for merchants who take no gold. */
  barter?: { potions: number; minGrade: Grade };
}

export interface MerchantDef {
  id: string;
  cycleDays: number;
  offsetDays: number;
  phase: 'day' | 'night';
  currency: 'gold' | 'potions';
  picks: number;
  relationshipTiers: number[];
  discountPerTier: number;
  pool: MerchantStockDef[];
}

export interface CaveSpeciesDef {
  id: string;
  growMs: number;
  spreadChance: number;
  light: 'any' | 'lit' | 'dark';
  clusterCost: number;
}

export interface CaveConfig {
  width: number;
  height: number;
  startingTiles: number;
  spreadTickMs: number;
  yieldPerTile: number;
  species: CaveSpeciesDef[];
  wrongLightSpreadMultiplier: number;
}

export interface ShaftStratumDef {
  id: string;
  minDepth: number;
  veins: Array<{ ingredientId: string; size: number; batch: number; weight: number }>;
}

export interface ShaftConfig {
  startingDepth: number;
  depthStep: number;
  batchTickMs: number;
  veinRefillMs: number;
  strata: ShaftStratumDef[];
}

export interface HeroDef {
  id: string;
  affinity: string;
  traits: string[];
  favourite: string;
  baseLevel: number;
}

export interface BiomeDef {
  id: string;
  durationMs: number;
  baseSuccess: number;
  baseInjury: number;
  baseRareFind: number;
  requiresRank: number;
  loot: LootEntry[];
  rare: LootEntry[];
}

/**
 * One line of a loot table. A seed or spore find names its crop or cave
 * species by `ingredientId`, which is the id of what it grows into.
 */
export interface LootEntry {
  kind?: FindKind;
  ingredientId: string;
  min: number;
  max: number;
  weight: number;
}

export interface HeroesConfig {
  /** Multiplied by the hero's level — see `recruitCostOf`. */
  recruitCostPerLevel: number;
  /** How many can go on one expedition. Not a limit on expeditions. */
  partySize: number;
  startingSlots: number;
  restMsPerInjury: number;
  favourBands: Array<{
    id: string;
    min: number;
    levelBonus: number;
    injuryModifier: number;
    rareFindBonus: number;
  }>;
  favour: {
    perReturn: number;
    perSupplySlotFilled: number;
    perFavouritePotion: number;
    perHealed: number;
    sentUnsupplied: number;
  };
  roster: HeroDef[];
  biomes: BiomeDef[];
  supplies: {
    slots: number;
    successPerGradePoint: number;
    rareFindPerGradePoint: number;
    injuryPerGradePoint: number;
  };
}

export interface ContractTemplateDef {
  id: string;
  faction: string;
  recipeId: string;
  quantityMin: number;
  quantityMax: number;
  minGrade: Grade;
  requiresSeal?: string;
  requiresVessel?: string;
  requiresRank: number;
}

/**
 * A buyer's taste, as a direction in essence space.
 *
 * This is what lets demand cover the whole recipe book without a hand-authored
 * entry per recipe: anything pointing near the palate is something this buyer
 * would plausibly want.
 */
/**
 * A pot you can buy.
 *
 * Capacity is the headline, but owning several is the other half: a second
 * cauldron brews a second thing at the same time, so the ladder is not purely
 * vertical.
 */
export interface CauldronTierDef {
  id: string;
  cost: number;
  requiresRank: number;
  capacity: number;
  maxIngredients: number;
  /** Below 1 finishes sooner. A better pot works faster as well as bigger. */
  brewSpeedMultiplier: number;
}

export interface CauldronsConfig {
  maxOwned: number;
  tiers: CauldronTierDef[];
}

export interface PalateDef {
  palate: EssenceVector;
  spreadDeg: number;
}

export interface FactionDef extends PalateDef {
  id: string;
  requiresRank: number;
}

export interface DerivedContractConfig {
  derivedShare: number;
  gradeByRank: Grade[];
  quantityAtLowValue: number;
  quantityAtHighValue: number;
  lowValue: number;
  highValue: number;
  quantitySpread: number;
  sealChance: number;
  vesselChance: number;
}

export interface ContractsConfig {
  boardSize: number;
  refreshDays: number;
  deadlineDaysMin: number;
  deadlineDaysMax: number;
  goldPerUnitValue: number;
  renownPerContract: number;
  reputationOnDeliver: number;
  reputationOnFail: number;
  factions: FactionDef[];
  derived: DerivedContractConfig;
  templates: ContractTemplateDef[];
}

export interface CodexEffect {
  timerMultiplier?: number;
  oreBatchBonus?: number;
  startingDepthBonus?: number;
  startingMerchantTier?: number;
  keptRecipes?: number;
  keptHeroes?: number;
  startingGold?: number;
  startingRenown?: number;
}

export interface CodexNodeDef {
  id: string;
  tiers: number;
  costPerTier: number;
  effect: CodexEffect;
}

export interface TownDef {
  id: string;
  effects: {
    cropGrowthMultiplier?: number;
    oreBatchMultiplier?: number;
    caveSpreadMultiplier?: number;
    caveTilesBonus?: number;
    merchantPriceMultiplier?: number;
    contractPayoutMultiplier?: number;
    footfallMultiplier?: number;
    startingDepthBonus?: number;
  };
}

export interface PrestigeConfig {
  requiresRank: number;
  masteryPerRenownRoot: number;
  codex: CodexNodeDef[];
  towns: TownDef[];
}

export interface CustomerActionDef {
  id: string;
  family: string;
  counters: HaggleStance;
  backfiresAgainst: HaggleStance;
}

export interface CustomerDef extends PalateDef {
  id: string;
  archetype: string;
  /** Always bought by name, whatever the palate says. */
  wants: string[];
  budgetMultiplier: number;
  stanceWeights: Record<string, number>;
  requiresRank: number;
  nightOnly?: boolean;
}

export interface CustomersConfig {
  rounds: number;
  startingPatience: number;
  startingInterest: number;
  visitChance: number;
  budgetSpread: number;
  stances: HaggleStance[];
  actions: CustomerActionDef[];
  outcomes: Record<
    'counter' | 'neutral' | 'backfire',
    { interest: number; ceiling: number; patience: number }
  >;
  holdFirm: { patience: number; interestToCeiling: number };
  roster: CustomerDef[];
}

export interface GameConfig {
  clock: {
    dayLengthMs: number;
    phases: Array<{ id: string; startFraction: number }>;
    weekdays: string[];
  };
  garden: {
    startingPlots: number;
    maxPlots: number;
    yieldMultiplier: number;
    seedDropChance: number;
    /** Extra units harvested when a crop sits in the soil it wants. */
    suitedSoilBonus: number;
  };
  freshness: {
    dewfreshUntilMs: number;
    freshUntilMs: number;
    dewfreshEssenceMultiplier: number;
    freshEssenceMultiplier: number;
    driedEssenceMultiplier: number;
    /** Categories that never age: their stock is Fresh for ever. */
    agelessCategories: IngredientCategory[];
    /** Multiplies how long each stage lasts, per category. Absent means 1. */
    categoryAgeMultiplier: Partial<Record<IngredientCategory, number>>;
  };
  cauldron: { unstableGrade: Grade };
  brewing: {
    brewDuration: Record<PotencyTierId, number>;
  };
  grading: {
    bands: Array<{ grade: Grade; minPurity: number }>;
  };
  potency: { tiers: Array<{ id: PotencyTierId; minEssence: number; valueMultiplier: number }> };
  market: {
    tickMs: number;
    baseFootfall: number;
    offlineFootfallMultiplier: number;
    priceCurveSteepness: number;
    priceCurveMidpoint: number;
    renownPerFootfall: number;
    gradeValueExponent: number;
    phaseFootfall: Record<string, number>;
    weekdayFootfall: Record<string, number>;
  };
  shop: { startingShelves: number };
  economy: {
    startingGold: number;
    startingRenown: number;
    /** Seeds a new shop opens with, by crop id. */
    startingSeeds: Array<{ id: string; count: number }>;
    /** Spore clusters a new shop opens with, by cave species. */
    startingSpores: Array<{ id: string; count: number }>;
    renownPerSale: number;
    renownPerGradeBonus: Record<string, number>;
    /** Fraction of gold spent that becomes merchant relationship. */
    relationshipPerGold: number;
    /** Relationship a barter merchant gains per potion handed over. */
    relationshipPerPotion: number;
  };
  save: { slots: number; autosaveDebounceMs: number; schemaVersion: number };
}

/**
 * Live config. The debug panel mutates this in place (see `overrideConfig`), which
 * is safe because nothing caches derived values across a frame.
 */
export const config: GameConfig = structuredClone(rawConfig) as unknown as GameConfig;

/** Replace a config subtree at runtime. Used only by the debug panel. */
export function overrideConfig(patch: Partial<GameConfig>): void {
  Object.assign(config, patch);
}

/** Restore the values shipped in config.json. */
export function resetConfig(): void {
  Object.assign(config, structuredClone(rawConfig) as unknown as GameConfig);
}

export const ingredients = rawIngredients as unknown as IngredientDef[];
export const crops = rawCrops as unknown as CropDef[];
export const recipes = buildRecipes(rawRecipes as unknown as RawRecipe[]);
export const vessels = rawVessels as unknown as VesselDef[];
export const seals = rawSeals as unknown as SealDef[];
export const ranks = rawRanks as unknown as RankDef[];
export const equipment = rawEquipment as unknown as EquipmentDef[];
export const decorConfig = rawDecor as unknown as DecorConfig;
export const decorPieces = decorConfig.pieces;
export const shelfTiers = (rawShelves as unknown as { tiers: ShelfTierDef[] }).tiers;

/** The board every shop starts on — the first tier, and the only free one. */
export const baseShelfTier = shelfTiers[0]!;
export const merchants = rawMerchants as unknown as MerchantDef[];
export const caveConfig = rawCave as unknown as CaveConfig;
export const shaftConfig = rawShaft as unknown as ShaftConfig;
export const heroesConfig = rawHeroes as unknown as HeroesConfig;
export const cauldronsConfig = rawCauldrons as unknown as CauldronsConfig;
export const cauldronTiers = cauldronsConfig.tiers;
/** The pot every shop opens with, and the only free one. */
export const baseCauldronTier = cauldronTiers[0]!;
export const contractsConfig = rawContracts as unknown as ContractsConfig;
export const customersConfig = rawCustomers as unknown as CustomersConfig;
export const prestigeConfig = rawPrestige as unknown as PrestigeConfig;

function index<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((entry) => [entry.id, entry]));
}

const ingredientIndex = index(ingredients);
const cropIndex = index(crops);
const recipeIndex = index(recipes);
const vesselIndex = index(vessels);
const sealIndex = index(seals);
const equipmentIndex = index(equipment);
const decorIndex = index(decorPieces);
const shelfTierIndex = index(shelfTiers);
const merchantIndex = index(merchants);

/** Lookups throw rather than returning undefined: a missing id is a data bug, not a game state. */
function require_<T>(map: Map<string, T>, id: string, kind: string): T {
  const found = map.get(id);
  if (!found) throw new Error(`Unknown ${kind} id: ${id}`);
  return found;
}

export const getIngredient = (id: string): IngredientDef =>
  require_(ingredientIndex, id, 'ingredient');
export const getCrop = (id: string): CropDef => require_(cropIndex, id, 'crop');
export const getRecipe = (id: string): RecipeDef => require_(recipeIndex, id, 'recipe');
export const getVessel = (id: string): VesselDef => require_(vesselIndex, id, 'vessel');
export const getSeal = (id: string): SealDef => require_(sealIndex, id, 'seal');
export const getEquipment = (id: string): EquipmentDef =>
  require_(equipmentIndex, id, 'equipment');
export const getDecor = (id: string): DecorDef => require_(decorIndex, id, 'decor');
export const getShelfTier = (id: string): ShelfTierDef =>
  require_(shelfTierIndex, id, 'shelf tier');
export const findShelfTier = (id: string): ShelfTierDef | undefined => shelfTierIndex.get(id);
export const getMerchant = (id: string): MerchantDef => require_(merchantIndex, id, 'merchant');

/** Soft lookups, for places where a missing id is a legitimate answer. */
export const findEquipment = (id: string): EquipmentDef | undefined => equipmentIndex.get(id);
export const findDecor = (id: string): DecorDef | undefined => decorIndex.get(id);

/** Every piece that could go in one spot, cheapest first. */
export const decorForSpot = (spot: string): DecorDef[] =>
  decorPieces.filter((piece) => piece.spot === spot).sort((a, b) => a.cost - b.cost);

const caveSpeciesIndex = index(caveConfig.species);
const heroIndex = index(heroesConfig.roster);
const biomeIndex = index(heroesConfig.biomes);
const contractTemplateIndex = index(contractsConfig.templates);

export const getCaveSpecies = (id: string): CaveSpeciesDef =>
  require_(caveSpeciesIndex, id, 'cave species');
export const getHeroDef = (id: string): HeroDef => require_(heroIndex, id, 'hero');
export const getBiome = (id: string): BiomeDef => require_(biomeIndex, id, 'biome');
export const getContractTemplate = (id: string): ContractTemplateDef =>
  require_(contractTemplateIndex, id, 'contract template');

const factionIndex = index(contractsConfig.factions);
export const getFaction = (id: string): FactionDef => require_(factionIndex, id, 'faction');

const cauldronTierIndex = index(cauldronTiers);
export const getCauldronTier = (id: string): CauldronTierDef =>
  require_(cauldronTierIndex, id, 'cauldron tier');
export const findCauldronTier = (id: string): CauldronTierDef | undefined =>
  cauldronTierIndex.get(id);

const customerIndex = index(customersConfig.roster);
export const getCustomer = (id: string): CustomerDef => require_(customerIndex, id, 'customer');

const codexIndex = index(prestigeConfig.codex);
export const getCodexNode = (id: string): CodexNodeDef => require_(codexIndex, id, 'codex node');

/** The deepest stratum whose floor the given depth has reached. */
export function strataFor(depth: number): ShaftStratumDef {
  let stratum = shaftConfig.strata[0]!;
  for (const candidate of shaftConfig.strata) {
    if (depth >= candidate.minDepth) stratum = candidate;
  }
  return stratum;
}

function buildRecipes(raw: RawRecipe[]): RecipeDef[] {
  const targets = raw.map((recipe) => {
    const target: EssenceVector = { ignis: 0, aqua: 0, terra: 0, aer: 0, umbra: 0 };
    for (const essence of recipe.elements) target[essence] = 1;
    return target;
  });

  // Every target is a set of ones, so the cosine between two of them is the
  // shared count over the root of both sizes.
  const angleDeg = (a: EssenceVector, b: EssenceVector) => {
    let shared = 0;
    let sizeA = 0;
    let sizeB = 0;
    for (const essence of Object.keys(a) as Essence[]) {
      shared += a[essence] * b[essence];
      sizeA += a[essence];
      sizeB += b[essence];
    }
    return (Math.acos(Math.min(1, shared / Math.sqrt(sizeA * sizeB))) * 180) / Math.PI;
  };

  return raw.map((recipe, i) => {
    let nearest = 90;
    targets.forEach((other, j) => {
      if (j !== i) nearest = Math.min(nearest, angleDeg(targets[i]!, other));
    });
    return { ...recipe, target: targets[i]!, toleranceDeg: nearest / 2 };
  });
}
