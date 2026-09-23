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
 * Patience hitting zero ends the haggle at the customer's last standing offer.
 * You never walk away with nothing; the worst outcome is a shelf-price sale.
 */

import { config, customersConfig, getCustomer, getRecipe } from './config';
import type { CustomerActionDef, CustomerDef } from './config';
import { dayStateAt } from './clock';
import { angleBetween } from './essences';
import { rankOf } from './progression';
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

/**
 * Nobody comes to the counter while there is no counter.
 *
 * The haggle is a whole system — stances, pitches, patience, a session that
 * lives in the save — and the screen it was played on has been taken off the
 * Shop while customers move to a scene of their own. Left running it would put
 * a customer in a shop with no way to serve them, and a half-finished haggle
 * into every save made in the meantime.
 *
 * Paused rather than deleted, because none of it is wrong — it is early. One
 * line to bring back, and `clearStrandedHaggle` below tidies the sessions this
 * pause would otherwise abandon.
 */
export const WALK_INS_PAUSED = true;

export interface WalkIn {
  customerId: string;
  /** Bottled items in storage this customer would actually buy. */
  wantedUids: string[];
}

/**
 * Who is in the shop today.
 *
 * Derived from the day counter like everything else, so a customer cannot be
 * missed by closing the app — and a reload brings the same person back.
 */
export function walkInsToday(world: World): WalkIn[] {
  return WALK_INS_PAUSED ? [] : scheduledWalkIns(world);
}

/**
 * Who the day would bring, pause or no pause.
 *
 * Separate from the door being shut, so the haggle's own tests keep exercising
 * the schedule rather than passing because nobody turns up. A paused system
 * whose tests quietly stop testing anything is how a system comes back broken.
 */
export function scheduledWalkIns(world: World): WalkIn[] {
  const day = dayStateAt(world.now);
  const rank = rankOf(world);
  const night = day.phase === 'night';

  return customersConfig.roster
    .filter((def) => rank >= def.requiresRank)
    .filter((def) => (def.nightOnly ? night : true))
    .filter((def) => {
      // Fixed per day, so who is in town is a fact about the day rather than
      // something that reshuffles on every re-render.
      const rng = new Rng(visitSeed(def.id, day.dayNumber));
      return rng.next() < customersConfig.visitChance;
    })
    .map((def) => ({
      customerId: def.id,
      wantedUids: world.bottled.filter((item) => buys(def, item.recipeId)).map((item) => item.uid),
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
  const item = world.bottled.find((entry) => entry.uid === itemUid);
  if (!item || !buys(def, item.recipeId)) return null;
  if (world.haggle) return null;

  const day = dayStateAt(world.now);
  const rng = new Rng(visitSeed(customerId, day.dayNumber) ^ 0x9e37);

  // Stance first, so adding the purse draw does not reshuffle which stance a
  // given day produces.
  const stance = pickStance(def, rng);
  const ceiling = Math.round(ceilingFor(item, def, budgetVariance(rng)));

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

export function pitch(world: World, actionId: string): PitchResult | null {
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

  if (session.patience <= 0 || session.roundsLeft <= 0) session.finished = true;
  return result;
}

export interface HaggleClose {
  sold: boolean;
  gold: number;
  askedFor: number;
}

/**
 * Name a price and close.
 *
 * At or under the ceiling it sells. Over it, the customer declines — but the
 * item stays yours, so a failed haggle costs a walk-in, never stock.
 */
export function close(world: World, askingPrice: number): HaggleClose | null {
  const session = world.haggle;
  if (!session) return null;

  const index = world.bottled.findIndex((entry) => entry.uid === session.itemUid);
  if (index < 0) {
    world.haggle = null;
    return { sold: false, gold: 0, askedFor: askingPrice };
  }

  const asked = Math.max(1, Math.round(askingPrice));
  const sold = asked <= session.ceiling;

  if (sold) {
    const [item] = world.bottled.splice(index, 1);
    world.gold += asked;
    world.statistics.itemsSold += 1;
    world.statistics.goldEarned += asked;
    world.statistics.hagglesWon += 1;
    if (item) {
      world.renown +=
        config.economy.renownPerSale + (config.economy.renownPerGradeBonus[item.grade] ?? 0);
    }
  }

  world.haggle = null;
  return { sold, gold: sold ? asked : 0, askedFor: asked };
}

export function abandonHaggle(world: World): void {
  world.haggle = null;
}

/** Suggested opening ask, so the price stepper starts somewhere sensible. */
export function suggestedAsk(world: World): number {
  const session = world.haggle;
  if (!session) return 0;
  const item = world.bottled.find((entry) => entry.uid === session.itemUid);
  return Math.round(item?.fairValue ?? session.baseCeiling);
}

/**
 * Drop a haggle nothing can finish.
 *
 * A session saved before the counter came off the Shop would sit in the world
 * for ever: the customer is mid-negotiation, the bottle is spoken for, and
 * there is no screen on which to answer them. Called once when a world is
 * loaded, and a no-op the moment walk-ins are running again.
 */
export function clearStrandedHaggle(world: World): void {
  if (WALK_INS_PAUSED) world.haggle = null;
}
