/**
 * Haggling — rock-paper-scissors against a stance the customer telegraphs.
 *
 * Each pitch family counters exactly one stance and backfires against exactly
 * one other, and the backfires are thematic rather than arbitrary: lecturing a
 * noble, flattering someone in a hurry, offering a freebie to a sceptic. A
 * player can reason their way to the right move the first time instead of
 * memorising a grid.
 *
 * Landing a counter *forces* a stance change — nobody holds a position they have
 * just been beaten in — so you are reading a moving target and can never mash
 * one button.
 *
 * Patience hitting zero ends the haggle as a sale at the customer's last
 * standing offer: their ceiling as it stands, and never under the potion's
 * shelf price. You never walk away with nothing; the worst outcome is a
 * shelf-price sale. A haggle is only lost when you let the customer go, name a
 * price they refuse, or the bottle has already sold off the shelf.
 *
 * A customer wants what the shop owns, wherever it stands: the store room and
 * the shelves alike. A bottle sold at the counter leaves whichever it was in.
 */

import { config, customersConfig, getCustomer, getRecipe } from './config';
import type { CustomerActionDef, CustomerDef } from './config';
import { dayStateAt } from './clock';
import { angleBetween } from './essences';
import { derivedStats, rankOf } from './progression';
import { hashKey, Rng } from './rng';
import type { BottledItem, HaggleSession, HaggleStance, World } from './types';

/** A stable per-day seed, so the same day always brings the same customer. */
function visitSeed(customerId: string, dayNumber: number): number {
  return hashKey(`haggle:${customerId}:${dayNumber}`);
}

function pickStance(def: CustomerDef, rng: Rng): HaggleStance {
  const weights = def.stanceWeights;
  const total = customersConfig.stances.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
  let roll = rng.next() * total;
  for (const id of customersConfig.stances) {
    roll -= weights[id] ?? 0;
    if (roll <= 0) return id;
  }
  return customersConfig.stances[0]!;
}

/** A stance other than the one just beaten — a counter always moves them. */
function shiftStance(current: HaggleStance, def: CustomerDef, rng: Rng): HaggleStance {
  const others = customersConfig.stances.filter((id) => id !== current);
  const total = others.reduce((sum, id) => sum + (def.stanceWeights[id] ?? 1), 0);
  let roll = rng.next() * total;
  for (const id of others) {
    roll -= def.stanceWeights[id] ?? 1;
    if (roll <= 0) return id;
  }
  return others[0] ?? current;
}

// ---------------------------------------------------------------------------
// What the shop owns
// ---------------------------------------------------------------------------

/** A bottle and where it stands: on a shelf, or in the store room when null. */
export interface OwnedBottle {
  item: BottledItem;
  shelfId: string | null;
}

/**
 * Every bottle the shop owns, store room first and then the shelves in order.
 *
 * A walk-in used to look only at the store room, which made the shelves — the
 * one place a bottle is actually on display — invisible to the one customer
 * who walked in and asked for it.
 */
export function ownedBottles(world: World): OwnedBottle[] {
  const owned: OwnedBottle[] = world.bottled.map((item) => ({ item, shelfId: null }));
  for (const slot of world.shelf) {
    if (slot.item) owned.push({ item: slot.item, shelfId: slot.id });
  }
  return owned;
}

export function findOwnedBottle(world: World, uid: string): OwnedBottle | null {
  const stored = world.bottled.find((item) => item.uid === uid);
  if (stored) return { item: stored, shelfId: null };
  const slot = world.shelf.find((entry) => entry.item?.uid === uid);
  return slot?.item ? { item: slot.item, shelfId: slot.id } : null;
}

/** Take a bottle out of wherever it stands; a shelf it leaves is emptied. */
function takeBottle(world: World, uid: string): BottledItem | null {
  const index = world.bottled.findIndex((item) => item.uid === uid);
  if (index >= 0) return world.bottled.splice(index, 1)[0] ?? null;

  const slot = world.shelf.find((entry) => entry.item?.uid === uid);
  if (!slot?.item) return null;
  const item = slot.item;
  slot.item = null;
  slot.quantity = 0;
  return item;
}

// ---------------------------------------------------------------------------
// Who is in
// ---------------------------------------------------------------------------

export interface WalkIn {
  customerId: string;
  /** Bottles the shop owns, on a shelf or in the store room, this customer would buy. */
  wantedUids: string[];
}

/**
 * Who is in the shop today.
 *
 * Derived from the day counter like everything else, so a customer cannot be
 * missed by closing the app — and a reload brings the same person back.
 *
 * The roster keeps daylight hours: dawn, day and dusk. The one who would rather
 * not be seen comes after dark instead, and only then.
 */
export function walkInsToday(world: World): WalkIn[] {
  const day = dayStateAt(world.now);
  const rank = rankOf(world);
  const night = day.phase === 'night';
  const owned = ownedBottles(world);

  return customersConfig.roster
    .filter((def) => rank >= def.requiresRank)
    .filter((def) => (def.nightOnly ? night : !night))
    .filter((def) => {
      // Fixed per day, so who is in town is a fact about the day rather than
      // something that reshuffles on every re-render.
      const rng = new Rng(visitSeed(def.id, day.dayNumber));
      return rng.next() < customersConfig.visitChance;
    })
    .map((def) => ({
      customerId: def.id,
      wantedUids: owned.filter(({ item }) => buys(def, item.recipeId)).map(({ item }) => item.uid),
    }))
    .filter((walkIn) => walkIn.wantedUids.length > 0);
}

/**
 * Would this customer buy this potion at all?
 *
 * Named wants first, then taste. The list alone meant a walk-in could only ever
 * be interested in one or two of the 31 recipes, so anything else you
 * brewed had no buyer but the shelf — the palate is what opens the rest of the
 * book to them.
 */
export function buys(def: CustomerDef, recipeId: string): boolean {
  if (def.wants.includes(recipeId)) return true;
  const off = angleBetween(getRecipe(recipeId).target, def.palate);
  return off < (def.spreadDeg * Math.PI) / 180;
}

/** What the customer would pay at most, before any pitching. */
export function ceilingFor(item: BottledItem, def: CustomerDef, variance = 1): number {
  return item.fairValue * def.budgetMultiplier * variance;
}

/**
 * How full this customer's purse happens to be today.
 *
 * Without it every visit from the same customer offered exactly the same
 * ceiling, so a player who once worked out what a Journeyman pays for a given
 * potion never had to judge again — the mini-game became arithmetic they had
 * already done. Centred on 1, so the spread adds uncertainty without moving
 * what a customer is worth on average.
 */
export function budgetVariance(rng: Rng): number {
  return 1 + (rng.next() - 0.5) * customersConfig.budgetSpread;
}

export function beginHaggle(
  world: World,
  customerId: string,
  itemUid: string,
): HaggleSession | null {
  const def = getCustomer(customerId);
  const owned = findOwnedBottle(world, itemUid);
  if (!owned || !buys(def, owned.item.recipeId)) return null;
  if (world.haggle) return null;

  const day = dayStateAt(world.now);
  const rng = new Rng(visitSeed(customerId, day.dayNumber) ^ 0x9e37);

  // Stance first, so adding the purse draw does not reshuffle which stance a
  // given day produces.
  const stance = pickStance(def, rng);
  // Décor that raises what a haggler will go to is applied here, once, to the
  // opening ceiling — pitching then moves it by proportion, so the bonus
  // carries through every round without being counted twice.
  const bonus = 1 + derivedStats(world).haggleCeilingBonus;
  const ceiling = Math.round(ceilingFor(owned.item, def, budgetVariance(rng)) * bonus);

  const session: HaggleSession = {
    customerId,
    itemUid,
    stance,
    interest: customersConfig.startingInterest,
    patience: customersConfig.startingPatience,
    ceiling,
    baseCeiling: ceiling,
    roundsLeft: customersConfig.rounds,
    rngSeed: rng.seed,
    finished: false,
    lastResult: null,
  };

  world.haggle = session;
  return session;
}

export type PitchResult = 'counter' | 'neutral' | 'backfire' | 'holdFirm';

function actionDef(actionId: string): CustomerActionDef | undefined {
  return customersConfig.actions.find((entry) => entry.id === actionId);
}

/** How one action lands against the current stance, before it is applied. */
export function previewPitch(stance: HaggleStance, actionId: string): PitchResult {
  if (actionId === 'holdFirm') return 'holdFirm';
  const action = actionDef(actionId);
  if (!action) return 'neutral';
  if (action.counters === stance) return 'counter';
  if (action.backfiresAgainst === stance) return 'backfire';
  return 'neutral';
}

export interface HaggleClose {
  sold: boolean;
  gold: number;
  askedFor: number;
  /** Their patience ran out and they took it at their own last offer. */
  patienceOut: boolean;
}

/** One pitch, and the sale it ended in when it used up the last of their patience. */
export interface PitchStep {
  result: PitchResult;
  settled: HaggleClose | null;
}

export function pitch(world: World, actionId: string): PitchStep | null {
  const session = world.haggle;
  if (!session || session.finished) return null;

  const def = getCustomer(session.customerId);
  const rng = new Rng(session.rngSeed);
  const result = previewPitch(session.stance, actionId);

  if (result === 'holdFirm') {
    const hold = customersConfig.holdFirm;
    session.patience += hold.patience;
    // The cash-out: everything the pitch has built becomes price.
    session.ceiling = Math.round(session.ceiling * (1 + session.interest * hold.interestToCeiling));
    session.interest = 0;
  } else {
    const outcome = customersConfig.outcomes[result];
    session.interest = Math.max(0, session.interest + outcome.interest);
    session.patience += outcome.patience;
    session.ceiling = Math.max(1, Math.round(session.ceiling * (1 + outcome.ceiling)));

    // Nobody holds a position they have just been beaten in.
    if (result === 'counter') session.stance = shiftStance(session.stance, def, rng);
  }

  session.rngSeed = rng.seed;
  session.roundsLeft -= 1;
  session.lastResult = result;

  // Out of patience, they stop listening and buy at their last standing offer.
  if (session.patience <= 0) return { result, settled: settleAtOffer(world) };

  if (session.roundsLeft <= 0) session.finished = true;
  return { result, settled: null };
}

/** The books, for a bottle sold at the counter however the price was reached. */
function sell(world: World, item: BottledItem, gold: number): void {
  world.gold += gold;
  world.statistics.itemsSold += 1;
  world.statistics.goldEarned += gold;
  world.statistics.hagglesWon += 1;
  world.renown +=
    config.economy.renownPerSale + (config.economy.renownPerGradeBonus[item.grade] ?? 0);
}

/**
 * The sale patience runs out into.
 *
 * At the customer's ceiling as it stands after the last pitch — which backfires
 * may have talked down — but never under the shelf price, because a customer
 * who would pay less than the shelf would have bought from the shelf. Only the
 * bottle having gone in the meantime makes this a loss.
 */
function settleAtOffer(world: World): HaggleClose {
  const session = world.haggle!;
  const item = takeBottle(world, session.itemUid);
  world.haggle = null;
  if (!item) return { sold: false, gold: 0, askedFor: 0, patienceOut: true };

  const gold = Math.max(session.ceiling, item.fairValue);
  sell(world, item, gold);
  return { sold: true, gold, askedFor: gold, patienceOut: true };
}

/**
 * Name a price and close.
 *
 * At or under the ceiling it sells. Over it, the customer declines — but the
 * item stays yours, so a failed haggle costs a walk-in, never stock. A bottle
 * that has gone since the haggle began (sold off the shelf while you talked)
 * closes the same way as a refusal: nothing changes hands.
 */
export function close(world: World, askingPrice: number): HaggleClose | null {
  const session = world.haggle;
  if (!session) return null;

  const asked = Math.max(1, Math.round(askingPrice));
  const owned = findOwnedBottle(world, session.itemUid);
  if (!owned) {
    world.haggle = null;
    return { sold: false, gold: 0, askedFor: asked, patienceOut: false };
  }

  const sold = asked <= session.ceiling;
  if (sold) {
    const item = takeBottle(world, session.itemUid);
    if (item) sell(world, item, asked);
  }

  world.haggle = null;
  return { sold, gold: sold ? asked : 0, askedFor: asked, patienceOut: false };
}

export function abandonHaggle(world: World): void {
  world.haggle = null;
}

/** Suggested opening ask, so the price stepper starts somewhere sensible. */
export function suggestedAsk(world: World): number {
  const session = world.haggle;
  if (!session) return 0;
  const owned = findOwnedBottle(world, session.itemUid);
  return Math.round(owned?.item.fairValue ?? session.baseCeiling);
}

/**
 * Drop a haggle nothing can finish.
 *
 * A session lives in the save so a customer is still at the counter after a
 * reload. The one thing that can leave it unfinishable is its bottle being
 * gone — sold off the shelf, or removed with the data it came from — and a
 * haggle over nothing would stand at the counter for ever. Called once when a
 * world is loaded.
 */
export function dropStaleHaggle(world: World): void {
  if (world.haggle && !findOwnedBottle(world, world.haggle.itemUid)) world.haggle = null;
}
