/**
 * Shared types for the simulation core.
 *
 * Nothing in `src/sim` may import Phaser, touch the DOM, or read the wall clock
 * directly. Time enters only through `World.now`, randomness only through `Rng`.
 * That is what lets offline catch-up and live play run the same code.
 */

export const ESSENCES = ['ignis', 'aqua', 'terra', 'aer', 'umbra'] as const;
export type Essence = (typeof ESSENCES)[number];

/** A vector across the five essences. Always all five keys, so maths never guards. */
export type EssenceVector = Record<Essence, number>;

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type PotencyTierId = 'minor' | 'common' | 'greater' | 'grand' | 'sovereign';
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type Freshness = 'dewfresh' | 'fresh' | 'dried';
export type IngredientCategory = 'herb' | 'fungus' | 'mineral' | 'reagent' | 'exotic';
export type SoilId = 'loam' | 'ash' | 'silt' | 'graveEarth';

/** A batch of one ingredient harvested at one moment; freshness is derived from `harvestedAt`. */
export interface IngredientStack {
  ingredientId: string;
  count: number;
  /** World time of harvest. Minerals pass `null` — they never age. */
  harvestedAt: number | null;
  /**
   * Set when this came from a crossbred line, whose essence differs from the
   * wild plant's. Without it, a bred strain would look identical to its parent
   * in the pot and breeding would be decorative.
   */
  strainId?: string | null;
}

export interface Plot {
  id: string;
  soil: SoilId;
  /** null when the plot is empty. */
  crop: {
    cropId: string;
    plantedAt: number;
    readyAt: number;
    tended: boolean;
    /** Set when a crossbred seed was planted rather than a wild one. */
    strainId?: string | null;
  } | null;
}

/** The cauldron's contents before distillation. */
export interface CauldronContents {
  /** Parallel to the ingredient list; each entry is one unit added. */
  units: Array<{ ingredientId: string; harvestedAt: number | null; strainId?: string | null }>;
}

/** Stirred melds a blend; simmered boils it. A recipe wants one or the other. */
export type BrewMethod = 'stirred' | 'simmered';

/**
 * One pot, and everything happening in it.
 *
 * Temperature and method live here rather than on the world because two pots
 * can be at different heats doing different things — which is the entire reason
 * to own two.
 */
export interface Cauldron {
  /** Stable per pot, so the UI can keep pointing at the same one. */
  id: string;
  /** Which tier of pot this is, from cauldrons.json. */
  tierId: string;
  contents: CauldronContents;
  /**
   * Live preparation state. Persisted, so a closed tab doesn't reset a pot
   * someone spent a minute bringing up to heat.
   */
  temperature: number;
  method: BrewMethod | null;
  /** An accepted brew, counting down. */
  brewing: BrewInProgress | null;
  /** A finished brew waiting to be bottled. */
  pendingBrew: BrewOutcome | null;
  /**
   * Put away rather than on the bench.
   *
   * A stored pot is owned and nothing else: it cannot brew, cannot be the active
   * pot, and does not clutter the workshop. Somewhere to put the little starter
   * bowl once you have better, without selling it.
   */
  stored: boolean;
}

/** What the cauldron would produce, given its contents, temperature and method. */
export interface BrewOutcome {
  recipeId: string;
  /** True when nothing matched and this is Murk. */
  isFallback: boolean;
  total: EssenceVector;
  totalEssence: number;
  /** Angular distance from the recipe's ideal ratio, in radians. */
  offIdealRad: number;
  contaminantPoints: number;
  temperature: number;
  /** How far outside the recipe's band the temperature sits. Zero when inside. */
  degreesOutsideBand: number;
  method: BrewMethod | null;
  purity: number;
  potencyTier: PotencyTierId;
  overCapacity: boolean;
  grade: Grade;
  /**
   * What physically went in. Some forms read this rather than the blend —
   * Powder wants dry material, Crystal wants stone, a Bomb wants something
   * volatile — and none of that survives into the essence vector.
   */
  composition: {
    driedShare: number;
    mineralShare: number;
    traits: string[];
    unitCount: number;
  };
}

/** An accepted brew, sitting in the pot until it is ready to bottle. */
export interface BrewInProgress {
  outcome: BrewOutcome;
  startedAt: number;
  readyAt: number;
}

/** A finished, bottled, sealed item. Immutable once created. */
export interface BottledItem {
  uid: string;
  recipeId: string;
  formId: string;
  vesselId: string;
  sealId: string;
  grade: Grade;
  purity: number;
  potencyTier: PotencyTierId;
  totalEssence: number;
  dosesLeft: number;
  fairValue: number;
  bottledAt: number;
}

/** One shelf slot: an item and the price the player is asking for it. */
export interface ShelfSlot {
  id: string;
  item: BottledItem | null;
  /**
   * How many identical bottles this slot holds.
   *
   * Almost always 1. A vessel with `shelfStack` — the waxed pouch — lets one
   * slot carry several, which is the whole reason to bottle cheap goods in one:
   * shelf space, not value.
   */
  quantity: number;
  /**
   * Which board this shelf is made of.
   *
   * Fitted per shelf rather than per shop, so one good board is a decision about
   * which goods deserve it.
   */
  quality: string;
  /** Asking price as a fraction of fair value. 1.0 = fair. */
  priceRatio: number;
}

export interface SaleRecord {
  itemName: string;
  recipeId: string;
  grade: Grade;
  gold: number;
  renown: number;
  at: number;
}

/**
 * One line in the shop's log.
 *
 * Stored as a kind plus loose parameters rather than a formatted string, so the
 * log renders in whatever language is loaded — a sentence baked at write time
 * would be frozen in the language it was written in.
 */
export type LogKind =
  | 'planted'
  | 'harvested'
  | 'seedFound'
  | 'brewStarted'
  | 'brewReady'
  | 'brewRejected'
  | 'bottled'
  | 'sold'
  | 'stocked'
  | 'bought'
  | 'bartered'
  | 'installed'
  | 'furnished'
  | 'cauldronBought'
  | 'rankUp'
  | 'caveHarvest'
  | 'oreFound'
  | 'missionSent'
  | 'missionReturned'
  | 'heroInjured'
  | 'heroHealed'
  | 'heroRecruited'
  | 'heroDismissed'
  | 'contractPosted'
  | 'contractDelivered'
  | 'contractFailed'
  | 'haggleWon'
  | 'haggleLost'
  | 'strainBred'
  | 'retired'
  | 'recipeFound'
  | 'bandLearned'
  | 'standingOrder';

export interface LogEntry {
  id: number;
  at: number;
  kind: LogKind;
  params: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Cave, shaft, heroes, contracts
// ---------------------------------------------------------------------------

export interface CaveTile {
  index: number;
  speciesId: string | null;
  /** When this tile was colonised; maturity is derived from it. */
  seededAt: number;
  /** A lantern here. Light steers which species can spread onto it. */
  lit: boolean;
  /** A substrate tray pins the species so spreading neighbours cannot take it. */
  locked: boolean;
}

export interface ShaftVein {
  id: string;
  ingredientId: string;
  depth: number;
  batch: number;
  size: number;
  remaining: number;
  /** When an exhausted vein comes back. Null while it still has ore. */
  refillsAt: number | null;
  /** When the next batch lands. Null unless this vein is being worked. */
  nextBatchAt: number | null;
}

export interface Hero {
  id: string;
  level: number;
  /** 0–100. Never falls below zero; a hero can be disappointed, never lost. */
  favour: number;
  injuredUntil: number | null;
  onMission: boolean;
  missionsCompleted: number;
}

export interface Mission {
  id: string;
  biomeId: string;
  heroIds: string[];
  startedAt: number;
  returnsAt: number;
  /** Odds locked in when the party left, so supplies cannot be second-guessed. */
  success: number;
  rareFind: number;
  injury: number;
  suppliesFilled: number;
  favouriteSupplied: boolean;
}

export interface MissionOutcome {
  missionId: string;
  biomeId: string;
  quality: 'bountiful' | 'successful' | 'meagre';
  found: Array<{ ingredientId: string; count: number }>;
  injured: string[];
  /*
   * Carried over from the mission, which is gone by the time this is claimed.
   * Favour is worked out from what was packed, so the claim has to remember it.
   */
  heroIds: string[];
  suppliesFilled: number;
  favouriteSupplied: boolean;
  returnedAt: number;
}

/**
 * A crossbred plant line.
 *
 * The one kind of content the player makes rather than finds, so it lives on the
 * world rather than in the data files.
 */
export interface Strain {
  id: string;
  baseCropId: string;
  /** How many crosses deep this line is. */
  generation: number;
  essence: EssenceVector;
  traits: string[];
  growMs: number;
  yieldBonus: number;
}

/**
 * What the player has worked out about a recipe.
 *
 * Deliberately not "the recipe is unlocked" — knowledge is a spectrum here. You
 * can know a potion exists and still be hunting its temperature, and the bounds
 * are the record of that hunt.
 */
export interface RecipeKnowledge {
  discovered: boolean;
  /** The hottest temperature proven to be below the band. */
  coldestKnownTooCold: number | null;
  /** The coldest temperature proven to be above the band. */
  hottestKnownTooHot: number | null;
  /** True once the band has been hit; the book then prints it. */
  bandKnown: boolean;
  timesBrewed: number;
}

export interface StandingOrder {
  merchantId: string;
  lines: Array<{ kind: 'seed' | 'ingredient' | 'vessel' | 'seal'; id: string; count: number }>;
  /** Day number of the last delivery, so one visit fulfils once. */
  lastFulfilledDay: number;
}

export type HaggleStance = 'sceptical' | 'haughty' | 'impatient';

/**
 * A haggle in progress.
 *
 * Lives in the world rather than in memory: a customer standing in the shop
 * should still be standing there after a reload, and the odds they have already
 * been talked into must not reset.
 */
export interface HaggleSession {
  customerId: string;
  itemUid: string;
  stance: HaggleStance;
  /** Builds with each pitch; Hold Firm converts it into price. */
  interest: number;
  /** Hits zero and they buy at the last standing offer rather than walking. */
  patience: number;
  ceiling: number;
  baseCeiling: number;
  roundsLeft: number;
  rngSeed: number;
  finished: boolean;
  lastResult: string | null;
}

/**
 * What a contract actually asks for.
 *
 * A hand-authored template is one source of these; a faction's palate is the
 * other. Storing the terms on the contract rather than looking them up by
 * template id is what lets a commission exist for a recipe nobody wrote a
 * template for.
 */
export interface ContractTerms {
  faction: string;
  recipeId: string;
  minGrade: Grade;
  requiresSeal?: string;
  requiresVessel?: string;
}

export interface Contract {
  id: string;
  /**
   * The template this came from, or `''` for a derived commission.
   *
   * Kept for saves written before contracts could be derived, and for the
   * statistics that count by template.
   */
  templateId: string;
  /** Present on derived contracts; absent on ones posted from a template. */
  terms?: ContractTerms;
  quantity: number;
  delivered: number;
  payout: number;
  renown: number;
  /**
   * Time left, in world ms. Stored rather than an absolute deadline because it
   * only runs down while the player is present — being away pauses it.
   */
  msRemaining: number;
  deadlineDays: number;
  postedAt: number;
}

export interface World {
  /** Authoritative world time, ms. Only `advanceTo` moves it. */
  now: number;
  /** Real timestamp the world was last saved at, for offline delta. */
  lastSeenRealTime: number;
  rngSeed: number;

  gold: number;
  renown: number;

  plots: Plot[];
  inventory: IngredientStack[];
  seeds: Record<string, number>;
  vessels: Record<string, number>;
  seals: Record<string, number>;

  /**
   * Every pot the shop owns, each brewing on its own.
   *
   * There used to be exactly one cauldron, held as five loose fields on the
   * world. A second pot is not a bigger pot — it is a second thing happening at
   * once — so the state that was singular had to become a list, and everything
   * that reads it now names which pot it means.
   */
  cauldrons: Cauldron[];

  /** Which pot the workbench is currently showing. */
  activeCauldronId: string;

  /** Next id to hand a newly bought pot, so ids stay unique across sales. */
  nextCauldronId: number;

  bottled: BottledItem[];
  shelf: ShelfSlot[];

  /** Scheduled market ticks are derived, not stored; this is the last one applied. */
  lastMarketTick: number;

  /** Sales that happened since the player last acknowledged them. */
  unreadSales: SaleRecord[];

  /** Newest last. Trimmed to a cap so a long game doesn't bloat the save. */
  log: LogEntry[];
  nextLogId: number;

  /** Equipment owned, by id. Counts, because some pieces are repeatable. */
  equipment: Record<string, number>;

  /**
   * Décor owned, by id. Separate from `decor` because owning a piece and having
   * it out are different things — the shop has fewer spots than there are
   * pieces, so a collection outgrows the floor.
   */
  decorOwned: Record<string, number>;
  /** What stands in each shop spot. An empty spot is null. */
  decor: Record<string, string | null>;

  /** Shelf boards bought and not yet fitted, by tier id. */
  boards: Record<string, number>;

  /** Lifetime standing with each merchant. Never decays. */
  merchantRelations: Record<string, number>;

  /**
   * What has been bought from each merchant during their current visit.
   *
   * Stock itself isn't stored — it regenerates from a seed derived from
   * (merchant, day) — so this only has to remember what's gone.
   */
  merchantVisits: Record<string, { dayNumber: number; bought: Record<string, number> }>;

  /** The rank the player has already been told about, so a rank-up fires once. */
  acknowledgedRank: number;

  cave: { tiles: CaveTile[]; lastTick: number };
  /** Spore clusters in stores, by species. */
  spores: Record<string, number>;

  shaft: {
    depth: number;
    supportedDepth: number;
    workingVeinId: string | null;
    veins: ShaftVein[];
  };

  heroes: Hero[];
  missions: Mission[];
  /**
   * Parties that are home but have not been greeted.
   *
   * The rolls are already made and frozen here; the haul only enters stores when
   * the player claims it. Waiting cannot improve a result, and leaving is safe —
   * an unclaimed party keeps until you come back.
   */
  pendingClaims: MissionOutcome[];
  nextMissionId: number;

  contracts: Contract[];
  nextContractId: number;
  factionReputation: Record<string, number>;
  /** World time the board was last refreshed. */
  lastContractTick: number;

  /** The customer currently being haggled with, if any. */
  haggle: HaggleSession | null;
  /** Walk-ins already served today, so one visit is one sale. */
  servedToday: { dayNumber: number; customerIds: string[] };

  /** Crossbred lines, and the counter that names them. */
  strains: Strain[];
  nextStrainId: number;

  /**
   * Prestige. These four are the only things that survive a retirement, which
   * is what makes them worth spending a whole run to earn.
   */
  mastery: number;
  codex: Record<string, number>;
  lifetimeRenown: number;
  retirements: number;
  townId: string;

  /** What is known about each recipe, keyed by recipe id. */
  recipes: Record<string, RecipeKnowledge>;
  standingOrders: StandingOrder[];
  onboardingDismissed: boolean;

  statistics: {
    itemsSold: number;
    goldEarned: number;
    brewsStarted: number;
    brewsFinished: number;
    cropsHarvested: number;
    seedsRecovered: number;
    fungiHarvested: number;
    oreExtracted: number;
    missionsCompleted: number;
    contractsDelivered: number;
    contractsFailed: number;
    hagglesWon: number;
    strainsBred: number;
  };
}
