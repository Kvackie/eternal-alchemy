/**
 * The simulation facade.
 *
 * Everything outside `src/sim` talks to the game through this object. It owns
 * the world, the RNG, and the single function that moves time — `advanceTo` —
 * which is used identically by the render loop and by the offline catch-up on
 * resume. There is no second code path for "while you were away".
 */

import {
  cauldronTiers,
  config,
  equipment,
  getCrop,
  getDecor,
  getEquipment,
  getSeal,
  ranks,
  realRecipes,
  type RecipeDef,
} from './config';
import {
  canBuyDecor,
  clearSpot,
  grantDecor,
  placeDecor,
  spotViews,
  type SpotView,
} from './decor';
import { cauldronComposition, cauldronVector } from './essences';
import {
  activeCauldron,
  brewSpeedOf,
  buyCauldron,
  capacityOf,
  cauldronById,
  makeCauldron,
  maxIngredientsOf,
  setCauldronStored,
  storedCauldrons,
  workshopCauldrons,
} from './cauldrons';
import type { Cauldron } from './types';
import { dayStateAt } from './clock';
import { harvest, harvestAllReady, isReady, makePlots, plant } from './garden';
import { addIngredient, returnUnit, takeUnit } from './inventory';
import { record } from './log';
import {
  fairValue,
  fitBoard,
  makeShelf,
  moveShelfStock,
  placeableCount,
  runMarket,
  stockGoods,
  stockShelf,
  unstockShelf,
} from './market';
import {
  addRelationship,
  markBought,
  packArrivals,
  presentMerchants,
  upcomingMerchants,
  type MerchantVisit,
  type StockEntry,
} from './merchants';
import {
  canBuyEquipment,
  derivedStats,
  grantEquipment,
  rankIdFor,
  rankIndexFor,
} from './progression';
import {
  harvestAllMature,
  harvestTile,
  makeCaveTiles,
  matureCount,
  runCave,
  seedTile,
  toggleLantern,
  toggleTray,
} from './cave';
import { canDeepen, deepen, runShaft, startWorking, stopWorking } from './shaft';
import {
  claimMission as claim,
  dismiss,
  estimateMission,
  healHero,
  recruit,
  resolveMissions,
  sendMission,
} from './heroes';
import { abandon, deliver, runContracts } from './contracts';
import {
  abandonHaggle,
  beginHaggle,
  clearStrandedHaggle,
  close,
  pitch,
  previewPitch,
  suggestedAsk,
  walkInsToday,
} from './haggle';
import { cross, crossCandidates, hasGreenhouse, type CrossCandidate } from './greenhouse';
import { buyCodex, canRetire, masteryFor, retire } from './prestige';
import {
  bandHint,
  discoveredRecipes,
  learnFrom,
  verdictFor,
  type TemperatureVerdict,
} from './discovery';
import {
  currentStep,
  dismissOnboarding,
  onboardingSteps,
  shouldShowOnboarding,
} from './onboarding';
import { agingRateFor, freshnessOf } from './essences';
import { Rng } from './rng';
import { createWorld } from './state';
import {
  applyBurner,
  assessOutcome,
  brewDurationFor,
  driftTemperature,
  nudgeTemperature,
} from './brewing';
import { bottle, type BottleRequest } from './bottling';
import type {
  BottledItem,
  BrewMethod,
  BrewOutcome,
  Freshness,
  Grade,
  SaleRecord,
  World,
} from './types';

/** Grades run S..F, best first. */
const GRADE_ORDER: Grade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

function gradeAtLeast(grade: Grade, minimum: Grade): boolean {
  return GRADE_ORDER.indexOf(grade) <= GRADE_ORDER.indexOf(minimum);
}

export interface AwaySummary {
  awayMs: number;
  sales: SaleRecord[];
  goldEarned: number;
  cropsReady: number;
  brewReady: boolean;
  /** Parties standing in the doorway, waiting to be greeted. */
  partiesHome: number;
}

export class Simulation {
  world: World;
  private rng: Rng;

  /** Which burner the player is holding, if any. Not persisted — it's an input. */
  burner: 'heat' | 'chill' | null = null;

  constructor(world: World = createWorld()) {
    this.world = world;
    this.rng = new Rng(world.rngSeed);
    // A save made while the counter existed can carry a negotiation there is
    // now no screen to finish. See `clearStrandedHaggle`.
    clearStrandedHaggle(world);
  }

  get now(): number {
    return this.world.now;
  }

  get day() {
    return dayStateAt(this.world.now);
  }

  /**
   * Move world time forward. The only mutator of `world.now`.
   *
   * `online` lowers footfall for stretches the player wasn't watching; it does
   * not change which code runs.
   */
  advanceTo(target: number, online = true): SaleRecord[] {
    // Time never runs backwards, whatever the device clock claims.
    if (target <= this.world.now) return [];
    const delta = target - this.world.now;
    this.world.now = target;

    this.settleBrew();

    // Whoever has just arrived is packed before anything reads their stock, so
    // the pack is a fact about the visit rather than about when it was looked
    // at. See `packArrivals`.
    packArrivals(this.world);

    const { sales } = runMarket(this.world, this.rng, online);
    for (const sale of sales) {
      record(this.world, 'sold', { recipe: sale.recipeId, grade: sale.grade, gold: sale.gold });
    }

    this.runGrounds();
    this.runExpeditions();
    this.runBoard(delta, online);

    this.advanceTemperature(delta, online);
    this.noticeRankUp();
    this.world.rngSeed = this.rng.seed;
    return sales;
  }

  /**
   * Log a rank-up once, when renown crosses a threshold.
   *
   * Rank itself is derived from renown, so this is purely about noticing — the
   * acknowledged index exists so the same promotion isn't announced on every
   * tick of a catch-up that spanned it.
   *
   * Called from every place renown can move, not just from `advanceTo`. Relying
   * on "a tick will happen eventually" leaves rank and renown disagreeing in the
   * meantime, and a backgrounded tab makes that meantime arbitrarily long.
   */
  private noticeRankUp(): void {
    const current = rankIndexFor(this.world.renown);
    while (this.world.acknowledgedRank < current) {
      this.world.acknowledgedRank += 1;
      record(this.world, 'rankUp', { rank: ranks[this.world.acknowledgedRank]?.id ?? '' });
    }
  }

  advanceBy(deltaMs: number, online = true): SaleRecord[] {
    return this.advanceTo(this.world.now + Math.max(0, deltaMs), online);
  }

  /**
   * Catch up after the app was closed, then hand back what happened.
   *
   * Offline progress is uncapped by design: closing the game for three weeks
   * should return a full garden and a full till, not a truncated one.
   */
  resume(realNow: number = Date.now()): AwaySummary {
    const delta = Math.max(0, realNow - this.world.lastSeenRealTime);
    const before = this.world.gold;
    const sales = delta > 0 ? this.advanceBy(delta, false) : [];
    this.world.lastSeenRealTime = realNow;

    return {
      awayMs: delta,
      sales,
      goldEarned: this.world.gold - before,
      cropsReady: this.world.plots.filter((plot) => isReady(plot, this.world.now)).length,
      // Any pot, not just the visible one — coming back to a finished brew in
      // the second cauldron is exactly what the resume summary is for.
      brewReady: this.world.cauldrons.some((pot) => pot.pendingBrew !== null),
      // The longest thing in the game to wait for, and the only one that was
      // missing from the one screen that reports what happened while you were
      // gone — a party could come home unmentioned and stay unclaimed.
      partiesHome: this.world.pendingClaims.length,
    };
  }

  /** Called on save and on visibilitychange, so the next resume has a real anchor. */
  markSeen(realNow: number = Date.now()): void {
    this.world.lastSeenRealTime = realNow;
  }

  // -- Garden ---------------------------------------------------------------

  plant(plotId: string, cropId: string): boolean {
    const ok = plant(this.world, plotId, cropId);
    if (ok) record(this.world, 'planted', { crop: cropId });
    return ok;
  }


  harvest(plotId: string) {
    const result = harvest(this.world, plotId, this.rng);
    if (result) this.recordHarvest(result);
    this.world.rngSeed = this.rng.seed;
    return result;
  }

  harvestAll() {
    const results = harvestAllReady(this.world, this.rng);
    for (const result of results) this.recordHarvest(result);
    this.world.rngSeed = this.rng.seed;
    return results;
  }

  private recordHarvest(result: { ingredientId: string; count: number; seeds: number }): void {
    record(this.world, 'harvested', { ingredient: result.ingredientId, count: result.count });
    if (result.seeds > 0) {
      record(this.world, 'seedFound', { crop: result.ingredientId, count: result.seeds });
    }
  }

  // -- Cauldron: step 1, ingredients ---------------------------------------

  /** Derived from owned equipment on every read, never stored. */
  get stats() {
    return derivedStats(this.world);
  }

  /** The capacity of the pot on screen. Each has its own. */
  get cauldronCapacity(): number {
    return capacityOf(this.cauldron);
  }

  /** How many separate ingredients the pot on screen will take. */
  get cauldronMaxIngredients(): number {
    return maxIngredientsOf(this.cauldron, this.stats.maxIngredients);
  }

  get rankIndex(): number {
    return rankIndexFor(this.world.renown);
  }

  get rankId(): string {
    return rankIdFor(this.world.renown);
  }

  /**
   * Ingredients stay the player's until a brew is accepted, so trying costs
   * nothing.
   *
   * `freshness` selects which batch to spend. The stores show one tile per
   * stage, so an unqualified add would take a different batch from the one the
   * player pointed at.
   */
  /*
   * Every cauldron method takes an optional pot and defaults to the active one.
   *
   * The shop owns several now, but almost every caller means "the one on
   * screen" — so the common case stays a bare call and only code that genuinely
   * juggles pots has to say which.
   */
  private pot(cauldronId?: string): Cauldron {
    return (cauldronId ? cauldronById(this.world, cauldronId) : undefined) ?? activeCauldron(this.world);
  }

  /**
   * The pots on the bench, in the order they were bought.
   *
   * Not every pot owned: a stored one is out of play, and everything that
   * brews, draws or picks a pot reads this — so putting one away takes it out
   * of every one of those places at once.
   */
  get cauldrons(): Cauldron[] {
    return workshopCauldrons(this.world);
  }

  /** Pots put away. Owned, and doing nothing. */
  get storedCauldrons(): Cauldron[] {
    return storedCauldrons(this.world);
  }

  /** Move a pot between the bench and storage. */
  setCauldronStored(cauldronId: string, stored: boolean): boolean {
    return setCauldronStored(this.world, cauldronId, stored);
  }

  get activeCauldronId(): string {
    return activeCauldron(this.world).id;
  }

  setActiveCauldron(cauldronId: string): boolean {
    const pot = cauldronById(this.world, cauldronId);
    if (!pot || pot.stored) return false;
    this.world.activeCauldronId = cauldronId;
    return true;
  }

  /** The pot the workbench is showing. */
  get cauldron(): Cauldron {
    return activeCauldron(this.world);
  }

  buyCauldron(tierId: string): Cauldron | null {
    const pot = buyCauldron(this.world, tierId, config.brewing.ambientTemperature);
    if (pot) record(this.world, 'cauldronBought', { tier: tierId });
    return pot;
  }

  addToCauldron(
    ingredientId: string,
    freshness?: Freshness,
    strainId: string | null = null,
    cauldronId?: string,
  ): boolean {
    const pot = this.pot(cauldronId);
    if (pot.brewing || pot.pendingBrew) return false;
    if (pot.contents.units.length >= maxIngredientsOf(pot, this.stats.maxIngredients)) return false;
    const unit = takeUnit(this.world, ingredientId, freshness, strainId);
    if (!unit) return false;
    pot.contents.units.push(unit);
    return true;
  }

  /** A crossbred unit brings its strain's essence, not the wild plant's. */
  private strainEssence = (strainId: string) =>
    this.world.strains.find((entry) => entry.id === strainId)?.essence ?? null;

  removeFromCauldron(index: number, cauldronId?: string): boolean {
    const pot = this.pot(cauldronId);
    if (pot.brewing || pot.pendingBrew) return false;
    const [unit] = pot.contents.units.splice(index, 1);
    if (!unit) return false;
    returnUnit(this.world, unit);
    return true;
  }

  emptyCauldron(cauldronId?: string): void {
    const pot = this.pot(cauldronId);
    while (pot.contents.units.length > 0) this.removeFromCauldron(0, pot.id);
  }

  // -- Cauldron: step 2, temperature and method -----------------------------

  get temperature(): number {
    return this.cauldron.temperature;
  }

  get method(): BrewMethod | null {
    return this.cauldron.method;
  }

  setMethod(method: BrewMethod | null, cauldronId?: string): void {
    const pot = this.pot(cauldronId);
    if (pot.brewing || pot.pendingBrew) return;
    pot.method = pot.method === method ? null : method;
  }

  /**
   * A single tap of the burner, for players who would rather not hold a button.
   *
   * `degrees` is the fine control: a recipe band can be a handful of degrees
   * wide, and landing on one by holding a ramp is a reflex test rather than a
   * decision.
   */
  nudge(burner: 'heat' | 'chill', degrees?: number, cauldronId?: string): void {
    const pot = this.pot(cauldronId);
    if (pot.brewing || pot.pendingBrew) return;
    pot.temperature = nudgeTemperature(pot.temperature, burner, degrees);
  }

  /**
   * Temperature only moves while the player is present.
   *
   * A pot cannot be left heating overnight and found still hot, but neither
   * should twelve hours away silently cost the heat someone was holding when
   * they got interrupted — so offline stretches leave it exactly as it was.
   */
  private advanceTemperature(deltaMs: number, online: boolean): void {
    if (!online) return;
    /*
     * The burner is held over ONE pot — the one on screen — but every idle pot
     * still drifts back toward the room. A shop of six cauldrons should not keep
     * five of them at temperature for free.
     */
    for (const pot of this.world.cauldrons) {
      if (pot.brewing || pot.pendingBrew) continue;
      const active = pot.id === this.world.activeCauldronId;
      let temperature = applyBurner(pot.temperature, active ? this.burner : null, deltaMs);
      if (!active || !this.burner) {
        temperature = driftTemperature(temperature, deltaMs, this.stats.driftMultiplier);
      }
      pot.temperature = temperature;
    }
  }

  // -- Cauldron: step 3, outcome -------------------------------------------

  /** What the pot would make right now. Recomputed on demand; nothing is cached. */
  assess(cauldronId?: string): BrewOutcome | null {
    const pot = this.pot(cauldronId);
    if (pot.contents.units.length === 0) return null;
    return assessOutcome({
      blend: cauldronVector(pot.contents, this.world.now, this.strainEssence),
      temperature: pot.temperature,
      method: pot.method,
      // This pot's own capacity, not the shop's best: brewing a heavy blend in
      // the starter bowl should boil over even when a great pot sits beside it.
      capacity: capacityOf(pot),
      composition: cauldronComposition(pot.contents, this.world.now),
    });
  }

  /** Accept the outcome: ingredients are spent and the brew starts its timer. */
  acceptBrew(cauldronId?: string): boolean {
    const pot = this.pot(cauldronId);
    if (pot.brewing || pot.pendingBrew) return false;
    const outcome = this.assess(pot.id);
    if (!outcome) return false;

    // A better pot works faster as well as bigger.
    const duration = Math.round(brewDurationFor(outcome.potencyTier) * brewSpeedOf(pot));
    pot.brewing = {
      outcome,
      startedAt: this.world.now,
      readyAt: this.world.now + duration,
    };
    pot.contents.units = [];
    this.world.statistics.brewsStarted += 1;
    record(this.world, 'brewStarted', { recipe: outcome.recipeId, grade: outcome.grade });

    // Only *accepting* teaches. Rejecting is free so that experimenting is free;
    // letting a rejected pot leak the answer would make the free option
    // strictly better than committing to one.
    if (!outcome.isFallback) {
      const learned = learnFrom(this.world, outcome.recipeId, pot.temperature);
      if (learned.newlyDiscovered) {
        record(this.world, 'recipeFound', { recipe: outcome.recipeId });
      }
      if (learned.bandLearned) {
        record(this.world, 'bandLearned', { recipe: outcome.recipeId });
      }
    }
    return true;
  }

  /** What the book can honestly print about a recipe's temperature. */
  bandHint(recipeId: string) {
    return bandHint(this.world, recipeId);
  }

  /** Too cold, too hot, or right — without leaking the band itself. */
  temperatureVerdict(recipeId: string, cauldronId?: string): TemperatureVerdict {
    return verdictFor(this.world, recipeId, this.pot(cauldronId).temperature);
  }

  /**
   * Reject the outcome: every ingredient goes back to stores, unchanged.
   *
   * This is what makes a hidden temperature band fair to hunt for. Experimenting
   * has to be free or nobody experiments.
   */
  rejectBrew(cauldronId?: string): boolean {
    const pot = this.pot(cauldronId);
    if (pot.brewing || pot.pendingBrew) return false;
    if (pot.contents.units.length === 0) return false;
    const returned = pot.contents.units.length;
    this.emptyCauldron(pot.id);
    pot.method = null;
    record(this.world, 'brewRejected', { count: returned });
    return true;
  }

  get brewing() {
    return this.cauldron.brewing;
  }

  /**
   * Move finished brews out of their pots and onto the bench.
   *
   * Every pot, not just the one on screen — a brew you started in the second
   * cauldron and walked away from must be waiting when you come back to it.
   */
  private settleBrew(): void {
    for (const pot of this.world.cauldrons) {
      const brewing = pot.brewing;
      if (!brewing || this.world.now < brewing.readyAt) continue;
      // A pot already holding a finished brew keeps it: the bench is one bottle
      // deep per cauldron, so the timer simply waits.
      if (pot.pendingBrew) continue;

      pot.pendingBrew = brewing.outcome;
      pot.brewing = null;
      this.world.statistics.brewsFinished += 1;
      record(this.world, 'brewReady', {
        recipe: brewing.outcome.recipeId,
        grade: brewing.outcome.grade,
      });
    }
  }

  // -- Bench: bottling ------------------------------------------------------

  get pendingBrew(): BrewOutcome | null {
    return this.cauldron.pendingBrew;
  }

  bottlePending(req: BottleRequest, cauldronId?: string): BottledItem | null {
    const pot = this.pot(cauldronId);
    const brew = pot.pendingBrew;
    if (!brew) return null;
    const item = bottle(this.world, brew, req, this.rankIndex);
    if (item) {
      pot.pendingBrew = null;
      pot.method = null;
      record(this.world, 'bottled', {
        recipe: item.recipeId,
        grade: item.grade,
        vessel: item.vesselId,
      });
    }
    return item;
  }

  discardPending(cauldronId?: string): void {
    const pot = this.pot(cauldronId);
    pot.pendingBrew = null;
    pot.method = null;
  }

  // -- Cave, shaft, missions, board -----------------------------------------

  /** Cave spread and ore extraction. Both tick like the market. */
  private runGrounds(): void {
    runCave(this.world, this.rng);

    const batches = runShaft(this.world, this.world.now);
    for (const batch of batches) {
      record(this.world, 'oreFound', {
        ingredient: batch.ingredientId,
        count: batch.count,
      });
    }
  }

  private runExpeditions(): void {
    for (const outcome of resolveMissions(this.world, this.rng)) {
      record(this.world, 'missionReturned', {
        biome: outcome.biomeId,
        quality: outcome.quality,
        count: outcome.found.reduce((sum, entry) => sum + entry.count, 0),
      });
    }
    // The injuries are rolled above but logged on claim, where they actually
    // start — a hero cannot be resting in the ledger and still out on the board.
  }

  /**
   * Tick the contract board.
   *
   * Deadlines are given only the *online* portion of the delta, so a weekend
   * away pauses every contract rather than running them out.
   */
  private runBoard(deltaMs: number, online: boolean): void {
    const update = runContracts(
      this.world,
      this.rng,
      online ? deltaMs : 0,
      config.clock.dayLengthMs,
    );

    for (const contract of update.expired) {
      record(this.world, 'contractFailed', { contract: contract.templateId });
    }
    for (const contract of update.posted) {
      record(this.world, 'contractPosted', { contract: contract.templateId });
    }
  }

  // -- Cave -----------------------------------------------------------------

  get cave() {
    return this.world.cave;
  }

  seedCaveTile(index: number, speciesId: string): boolean {
    return seedTile(this.world, index, speciesId);
  }

  toggleCaveLantern(index: number): boolean {
    return toggleLantern(this.world, index);
  }

  toggleCaveTray(index: number): boolean {
    return toggleTray(this.world, index);
  }

  harvestCaveTile(index: number) {
    const result = harvestTile(this.world, index);
    if (result) {
      record(this.world, 'caveHarvest', {
        ingredient: result.ingredientId,
        count: result.count,
      });
    }
    return result;
  }

  /** Plots and cave beds waiting on the player, for the nav badge. */
  readyToHarvest(): number {
    const plots = this.world.plots.filter((plot) => isReady(plot, this.world.now)).length;
    return plots + matureCount(this.world);
  }

  harvestCave() {
    const results = harvestAllMature(this.world);
    for (const result of results) {
      record(this.world, 'caveHarvest', {
        ingredient: result.ingredientId,
        count: result.count,
      });
    }
    return results;
  }

  // -- Shaft ----------------------------------------------------------------

  get shaft() {
    return this.world.shaft;
  }

  workVein(veinId: string): boolean {
    return startWorking(this.world, veinId);
  }

  stopVein(): void {
    stopWorking(this.world);
  }

  canDeepenShaft(): boolean {
    return canDeepen(this.world);
  }

  deepenShaft(): boolean {
    const ok = deepen(this.world, this.rng);
    this.world.rngSeed = this.rng.seed;
    return ok;
  }

  // -- Heroes ---------------------------------------------------------------

  get heroSlots(): number {
    return this.stats.heroSlots;
  }

  recruitHero(heroId: string): boolean {
    if (this.world.heroes.length >= this.heroSlots) return false;
    const ok = recruit(this.world, heroId);
    if (ok) record(this.world, 'heroRecruited', { hero: heroId });
    return ok;
  }

  dismissHero(heroId: string): boolean {
    const ok = dismiss(this.world, heroId);
    if (ok) record(this.world, 'heroDismissed', { hero: heroId });
    return ok;
  }

  estimate(biomeId: string, heroIds: string[], supplyUids: string[]) {
    return estimateMission(this.world, biomeId, heroIds, supplyUids);
  }

  send(biomeId: string, heroIds: string[], supplyUids: string[]): boolean {
    const mission = sendMission(this.world, biomeId, heroIds, supplyUids);
    if (mission) record(this.world, 'missionSent', { biome: biomeId, count: heroIds.length });
    return mission !== null;
  }

  heal(heroId: string, itemUid: string): boolean {
    const ok = healHero(this.world, heroId, itemUid);
    if (ok) record(this.world, 'heroHealed', { hero: heroId });
    return ok;
  }

  /** Parties standing in the doorway, waiting to hand over what they found. */
  get pendingClaims() {
    return this.world.pendingClaims;
  }

  /**
   * Take a returned party's haul.
   *
   * Returns the outcome so the caller can show it, and null if it was already
   * claimed — the guard that stops a double tap from paying twice.
   */
  claimMission(missionId: string) {
    const outcome = claim(this.world, missionId);
    if (!outcome) return null;
    for (const heroId of outcome.injured) {
      record(this.world, 'heroInjured', { hero: heroId });
    }
    return outcome;
  }

  // -- Contracts ------------------------------------------------------------

  deliverContract(contractId: string) {
    const result = deliver(this.world, contractId);
    if (result) {
      record(this.world, 'contractDelivered', {
        count: result.delivered,
        gold: result.gold,
      });
      this.noticeRankUp();
    }
    return result;
  }

  abandonContract(contractId: string): boolean {
    const ok = abandon(this.world, contractId);
    if (ok) record(this.world, 'contractFailed', { contract: contractId });
    return ok;
  }

  // -- Haggling -------------------------------------------------------------

  /** Named customers in the shop today who want something you actually have. */
  walkIns() {
    const day = dayStateAt(this.world.now).dayNumber;
    const served =
      this.world.servedToday.dayNumber === day ? this.world.servedToday.customerIds : [];
    return walkInsToday(this.world).filter((walkIn) => !served.includes(walkIn.customerId));
  }

  get haggle() {
    return this.world.haggle;
  }

  beginHaggle(customerId: string, itemUid: string) {
    return beginHaggle(this.world, customerId, itemUid);
  }

  pitch(actionId: string) {
    return pitch(this.world, actionId);
  }

  /** What an action would do against the current stance, for the button labels. */
  previewPitch(actionId: string) {
    return this.world.haggle ? previewPitch(this.world.haggle.stance, actionId) : null;
  }

  closeHaggle(askingPrice: number) {
    const customerId = this.world.haggle?.customerId;
    const result = close(this.world, askingPrice);
    if (result && customerId) {
      this.markServed(customerId);
      record(this.world, result.sold ? 'haggleWon' : 'haggleLost', {
        customer: customerId,
        gold: result.gold,
      });
      this.noticeRankUp();
    }
    return result;
  }

  abandonHaggle(): void {
    const customerId = this.world.haggle?.customerId;
    abandonHaggle(this.world);
    if (customerId) this.markServed(customerId);
  }

  /** One visit is one sale; a customer served does not come straight back. */
  private markServed(customerId: string): void {
    const day = dayStateAt(this.world.now).dayNumber;
    if (this.world.servedToday.dayNumber !== day) {
      this.world.servedToday = { dayNumber: day, customerIds: [customerId] };
    } else if (!this.world.servedToday.customerIds.includes(customerId)) {
      this.world.servedToday.customerIds.push(customerId);
    }
  }

  suggestedAsk(): number {
    return suggestedAsk(this.world);
  }

  // -- Greenhouse -----------------------------------------------------------

  get hasGreenhouse(): boolean {
    return hasGreenhouse(this.world);
  }

  crossCandidates() {
    return crossCandidates(this.world);
  }

  crossStrains(a: CrossCandidate, b: CrossCandidate) {
    if (!this.hasGreenhouse) return null;
    const result = cross(this.world, this.rng, a, b);
    this.world.rngSeed = this.rng.seed;
    if (result) {
      record(this.world, 'strainBred', {
        strain: result.strain.id,
        mutation: result.mutation ?? '',
      });
    }
    return result;
  }

  // -- Prestige -------------------------------------------------------------

  get canRetire(): boolean {
    return canRetire(this.world);
  }

  /** What retiring right now would pay in Mastery. */
  masteryOnRetire(): number {
    return masteryFor(this.world.lifetimeRenown + this.world.renown);
  }

  buyCodex(nodeId: string): boolean {
    return buyCodex(this.world, nodeId);
  }

  /**
   * Retire and open a new shop.
   *
   * Returns the replacement world rather than mutating in place — swapping a
   * world is the caller's job, and doing it here would leave every existing
   * reference pointing at the old one.
   */
  retire(townId: string, seed: number) {
    return retire(this.world, townId, seed);
  }

  // -- Merchants ------------------------------------------------------------

  /** Who is in town right now, with this visit's stock. Derived from the clock. */
  merchants(): MerchantVisit[] {
    return presentMerchants(this.world);
  }

  /** Who isn't, and when they're next due. */
  upcoming() {
    return upcomingMerchants(this.world);
  }

  /**
   * Buy one entry from a merchant who is present.
   *
   * Rechecks presence and stock rather than trusting the caller: the UI is
   * rebuilt on a timer, and a merchant can leave between a panel rendering and
   * a button being pressed.
   */
  buy(merchantId: string, index: number): { ok: boolean; reasonKey?: string } {
    const entry = this.stockAt(merchantId, index);
    if (!entry) return { ok: false, reasonKey: 'market.error.gone' };
    if (entry.remaining <= 0) return { ok: false, reasonKey: 'market.error.soldOut' };

    const gate = this.purchaseGate(entry);
    if (gate) return { ok: false, reasonKey: gate };

    return this.settle(entry, merchantId);
  }

  /**
   * Buy several of one entry in a single pass.
   *
   * The entry is resolved once and then held, which is the whole point. Buying
   * N by calling `buy` N times re-derived every merchant's stock on every unit
   * — and a purchase that pushes a relationship past a tier boundary
   * regenerates that list, so the same index pointed at different goods half
   * way through. The player was shown one basket and charged for another.
   *
   * `remaining` is derived from what has been bought, so it does not move
   * underneath us within this loop; a local count stands in for the
   * recomputation that happens on the next generation.
   */
  buyQuantity(
    merchantId: string,
    index: number,
    quantity: number,
  ): { bought: number; reasonKey?: string } {
    const entry = this.stockAt(merchantId, index);
    if (!entry) return { bought: 0, reasonKey: 'market.error.gone' };

    const gate = this.purchaseGate(entry);
    if (gate) return { bought: 0, reasonKey: gate };

    // A tool is installed and a furnishing stands in one spot, so a second copy
    // of either is not a thing the world can hold.
    const once = entry.kind === 'equipment' || entry.kind === 'decor';
    const wanted = Math.max(1, Math.floor(once ? 1 : quantity));

    let left = entry.remaining;
    let bought = 0;
    let reasonKey: string | undefined;

    for (let i = 0; i < wanted; i += 1) {
      if (left <= 0) {
        reasonKey = 'market.error.soldOut';
        break;
      }
      const result = this.settle(entry, merchantId);
      if (!result.ok) {
        reasonKey = result.reasonKey;
        break;
      }
      left -= 1;
      bought += 1;
    }

    // A partial fill is a success that stopped; only a fill of nothing needs to
    // say why.
    return bought > 0 ? { bought } : { bought: 0, reasonKey };
  }

  /** The entry a merchant is offering at this position, if they are still here. */
  private stockAt(merchantId: string, index: number): StockEntry | null {
    const visit = this.merchants().find((entry) => entry.merchantId === merchantId);
    return visit?.entries[index] ?? null;
  }

  /** What stops this being bought at all, as opposed to not being affordable. */
  private purchaseGate(entry: StockEntry): string | undefined {
    if (entry.kind === 'equipment' && !canBuyEquipment(this.world, getEquipment(entry.id))) {
      return 'market.reason.rank';
    }
    if (entry.kind === 'decor' && !canBuyDecor(this.world, getDecor(entry.id))) {
      return 'market.reason.rank';
    }
    return undefined;
  }

  /** Pay for one unit and hand it over. */
  private settle(entry: StockEntry, merchantId: string): { ok: boolean; reasonKey?: string } {
    const paid = entry.barter ? this.payInPotions(entry.barter) : this.payInGold(entry, merchantId);
    if (!paid.ok) return paid;

    this.deliver(entry);
    markBought(this.world, merchantId, entry.id);
    return { ok: true };
  }

  private payInGold(
    entry: StockEntry,
    merchantId: string,
  ): { ok: boolean; reasonKey?: string } {
    // The entry's price is the single truth — catalogue cost, relationship
    // discount and the town's price level are all already folded into it, so
    // what is charged is always what was shown.
    const price = entry.price ?? 0;
    if (this.world.gold < price) return { ok: false, reasonKey: 'market.error.gold' };

    this.world.gold -= price;
    addRelationship(this.world, merchantId, price * config.economy.relationshipPerGold);
    record(this.world, 'bought', { item: entry.id, gold: price });
    return { ok: true };
  }

  /**
   * Hand over sealed potions instead of gold.
   *
   * Spends the *cheapest* qualifying bottles first — the player asked to trade
   * some potions, not to lose their best one to a rounding decision.
   */
  private payInPotions(barter: {
    potions: number;
    minGrade: Grade;
  }): { ok: boolean; reasonKey?: string } {
    const qualifying = this.world.bottled
      .filter((item) => gradeAtLeast(item.grade, barter.minGrade))
      .sort((a, b) => a.fairValue - b.fairValue);

    /*
     * The Ashwalker's own mark doubles what a bottle is worth to him, so a
     * marked potion settles two of whatever he asked for. That is the only thing
     * the mark is good for — villagers refuse it outright.
     */
    const worthOf = (item: BottledItem) => getSeal(item.sealId).barterMultiplier ?? 1;

    const handing: BottledItem[] = [];
    let value = 0;
    for (const item of qualifying) {
      if (value >= barter.potions) break;
      handing.push(item);
      value += worthOf(item);
    }

    if (value < barter.potions) {
      return { ok: false, reasonKey: 'market.error.potions' };
    }

    for (const item of handing) {
      const at = this.world.bottled.findIndex((entry) => entry.uid === item.uid);
      if (at >= 0) this.world.bottled.splice(at, 1);
    }

    addRelationship(
      this.world,
      'ashwalker',
      barter.potions * config.economy.relationshipPerPotion,
    );
    record(this.world, 'bartered', { count: barter.potions });
    return { ok: true };
  }

  /** Put a bought entry where it belongs. */
  private deliver(entry: StockEntry): void {
    switch (entry.kind) {
      case 'seed':
        this.world.seeds[entry.id] = (this.world.seeds[entry.id] ?? 0) + 1;
        break;
      case 'spore':
        // Without this the cave was stuck on its two starting Dewcap clusters,
        // which made two of three species unobtainable and left the lantern
        // with nothing to steer.
        this.world.spores[entry.id] = (this.world.spores[entry.id] ?? 0) + 1;
        break;
      case 'ingredient':
        addIngredient(this.world, entry.id, 1, this.world.now);
        break;
      case 'vessel':
        this.world.vessels[entry.id] = (this.world.vessels[entry.id] ?? 0) + 1;
        break;
      case 'seal':
        this.world.seals[entry.id] = (this.world.seals[entry.id] ?? 0) + 1;
        break;
      case 'equipment':
        grantEquipment(
          this.world,
          entry.id,
          (i) => makePlots(i + 1)[i]!,
          (i) => makeShelf(i + 1)[i]!,
          (i) => makeCaveTiles(i + 1)[i]!,
        );
        record(this.world, 'installed', { item: entry.id });
        break;
      case 'decor':
        grantDecor(this.world, entry.id);
        record(this.world, 'furnished', { item: entry.id });
        break;
      case 'board':
        this.world.boards[entry.id] = (this.world.boards[entry.id] ?? 0) + 1;
        break;
    }
  }

  // -- Shelf ----------------------------------------------------------------

  stock(slotId: string, itemUid: string): boolean {
    const item = this.world.bottled.find((entry) => entry.uid === itemUid);
    const ok = stockShelf(this.world, slotId, itemUid);
    if (ok && item) record(this.world, 'stocked', { recipe: item.recipeId, grade: item.grade });
    return ok;
  }

  /**
   * Put several out in one go — see `stockGoods`.
   *
   * Returns how many went out, so the caller can say "4 of 6" rather than
   * claiming it did what was asked.
   */
  stockMany(itemUid: string, quantity: number): number {
    const item = this.world.bottled.find((entry) => entry.uid === itemUid);
    const placed = stockGoods(this.world, itemUid, quantity);
    if (placed > 0 && item) record(this.world, 'stocked', { recipe: item.recipeId, grade: item.grade });
    return placed;
  }

  /**
   * How many of these could go out right now, shelf room included.
   *
   * `inStore` is for a caller that has already counted its matching bottles —
   * see `placeableCount`.
   */
  placeable(item: BottledItem, inStore?: number): number {
    return placeableCount(this.world, item, inStore);
  }

  /** Rearrange the floor: move or swap what two shelves are holding. */
  moveStock(fromId: string, toId: string): boolean {
    return moveShelfStock(this.world, fromId, toId);
  }

  unstock(slotId: string): boolean {
    return unstockShelf(this.world, slotId);
  }

  /** Fit a board you own to a shelf. Only ever an upgrade — see `fitBoard`. */
  fitShelfBoard(slotId: string, tierId: string): boolean {
    const ok = fitBoard(this.world, slotId, tierId);
    if (ok) record(this.world, 'furnished', { item: tierId });
    return ok;
  }

  setPrice(slotId: string, ratio: number): void {
    const slot = this.world.shelf.find((s) => s.id === slotId);
    if (slot) slot.priceRatio = Math.max(0.4, Math.min(2, ratio));
  }

  acknowledgeSales(): SaleRecord[] {
    const sales = this.world.unreadSales;
    this.world.unreadSales = [];
    return sales;
  }

  // -- Décor ----------------------------------------------------------------

  /** Every shop spot, what is in it, and what else could go there. */
  decorSpots(): SpotView[] {
    return spotViews(this.world);
  }

  /** Put an owned piece out. Whatever shared the spot goes back into storage. */
  place(decorId: string): boolean {
    const ok = placeDecor(this.world, decorId);
    if (ok) record(this.world, 'furnished', { item: decorId });
    return ok;
  }

  clearSpot(spot: string): boolean {
    return clearSpot(this.world, spot);
  }

  /**
   * The recipe book, for the cauldron's reference panel.
   *
   * M1 knows everything from the start; recipe discovery arrives with merchants
   * in M2, at which point this filters on what the player has actually learned.
   */
  knownRecipes(): RecipeDef[] {
    return discoveredRecipes(this.world);
  }

  // -- Onboarding -----------------------------------------------------------

  get onboarding() {
    return {
      visible: shouldShowOnboarding(this.world),
      steps: onboardingSteps(this.world),
      current: currentStep(this.world),
    };
  }

  dismissOnboarding(): void {
    dismissOnboarding(this.world);
  }

  // -- Drying rack ----------------------------------------------------------

  /**
   * Force a batch to Dried without waiting two days.
   *
   * Turns freshness from something that happens to you into something you can
   * choose, which is what makes Powder and the Terra-leaning recipes reachable
   * on purpose rather than by accident.
   */
  forceDry(ingredientId: string, strainId: string | null = null): boolean {
    if (!this.stats.canForceDry) return false;
    const target = this.world.inventory.find(
      (stack) =>
        stack.ingredientId === ingredientId &&
        (stack.strainId ?? null) === strainId &&
        stack.harvestedAt !== null &&
        freshnessOf(stack.ingredientId, stack.harvestedAt, this.world.now) !== 'dried',
    );
    if (!target) return false;

    /*
     * Backdate past the drying threshold rather than adding a "dried" flag, so
     * there is only ever one way freshness is decided.
     *
     * The threshold is per category: fungus keeps twice as long, so a fixed
     * `freshUntilMs` would leave a cave crop still Fresh and the rack would
     * report that it had done nothing. A category that never ages has no
     * threshold to cross at all, so drying it is refused outright.
     */
    const rate = agingRateFor(target.ingredientId);
    if (rate <= 0) return false;
    target.harvestedAt = this.world.now - config.freshness.freshUntilMs * rate - 1000;
    return true;
  }

  // -- Debug ----------------------------------------------------------------

  /** Used only by the debug panel. Grants without spending. */
  grant(patch: {
    gold?: number;
    renown?: number;
    mastery?: number;
    ingredient?: { id: string; count: number };
    seed?: { id: string; count: number };
  }): void {
    if (patch.gold) this.world.gold += patch.gold;
    if (patch.renown) this.world.renown += patch.renown;
    // Renown feeds `masteryOnRetire` through `lifetimeRenown + renown`, so a
    // granted run pays out like an earned one; Mastery is granted separately
    // because the Codex has to be testable without retiring first.
    if (patch.mastery) this.world.mastery += patch.mastery;
    if (patch.ingredient) {
      addIngredient(this.world, patch.ingredient.id, patch.ingredient.count, this.world.now);
    }
    if (patch.seed) {
      getCrop(patch.seed.id);
      this.world.seeds[patch.seed.id] = (this.world.seeds[patch.seed.id] ?? 0) + patch.seed.count;
    }
    this.noticeRankUp();
  }

  /**
   * Used only by the debug panel. A shop with everything already built.
   *
   * The gold grant buys nothing on its own — every upgrade still has to be found
   * on a merchant's shelf across several in-game days, which makes testing a
   * late-game screen a chore rather than a check. This installs the end state
   * directly: every pot, the full wall of shelves, a bunk for every hero, and
   * five bottles of every recipe to fill them with.
   */
  stockEverything(): void {
    for (const tier of cauldronTiers) {
      if (!this.world.cauldrons.some((pot) => pot.tierId === tier.id)) {
        this.world.cauldrons.push(
          makeCauldron(
            `cauldron-${this.world.nextCauldronId}`,
            tier.id,
            config.brewing.ambientTemperature,
          ),
        );
        this.world.nextCauldronId += 1;
      }
    }

    /*
     * Set the count one short, then grant the last one properly.
     *
     * `repeatable` is the ceiling the shop screen enforces, so that is the
     * target — but shelves are objects, not a number, and only `grantEquipment`
     * grows the array to match. Going through it for the final purchase means
     * the wall is built by the same code a real purchase uses.
     */
    for (const def of equipment) {
      if (def.effect.addShelves === undefined && def.effect.addHeroSlots === undefined) continue;
      this.world.equipment[def.id] = Math.max(0, (def.repeatable ?? 1) - 1);
      grantEquipment(
        this.world,
        def.id,
        (i) => makePlots(i + 1)[i]!,
        (i) => makeShelf(i + 1)[i]!,
        (i) => makeCaveTiles(i + 1)[i]!,
      );
    }

    for (const recipe of realRecipes()) {
      for (let i = 0; i < 5; i += 1) {
        const item: BottledItem = {
          uid: `debug-${recipe.id}-${i}`,
          recipeId: recipe.id,
          formId: 'potion',
          vesselId: 'clayVial',
          sealId: 'cork',
          grade: 'A',
          purity: 90,
          potencyTier: 'common',
          totalEssence: 60,
          dosesLeft: 1,
          fairValue: 0,
          bottledAt: this.world.now,
        };
        item.fairValue = fairValue(item);
        this.world.bottled.push(item);

        // Bottling normally discovers a recipe; a shelf full of potions the
        // book has never heard of would break every screen that names them.
        this.world.recipes[recipe.id] ??= {
          discovered: true,
          coldestKnownTooCold: null,
          hottestKnownTooHot: null,
          bandKnown: true,
          timesBrewed: 0,
        };
        this.world.recipes[recipe.id]!.discovered = true;
      }
    }
  }

  /** Finish every running timer immediately. */
  finishAllTimers(): void {
    for (const plot of this.world.plots) {
      if (plot.crop) plot.crop.readyAt = this.world.now;
    }
    for (const pot of this.world.cauldrons) {
      if (pot.brewing) pot.brewing.readyAt = this.world.now;
    }
    this.settleBrew();
  }

  reseed(seed: number): void {
    this.world.rngSeed = seed;
    this.rng = new Rng(seed);
  }
}

