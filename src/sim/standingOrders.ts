/**
 * Standing orders — the anti-tedium valve.
 *
 * Once you know you need ten Emberroot a day, buying it by hand forever is not
 * a decision, it is a chore. A standing order names a basket and a merchant;
 * every visit they leave it on the step and take the gold.
 *
 * It deliberately does *not* discount. The point is to stop repeating a
 * purchase you have already decided on, not to make it cheaper — a discount
 * would make hand-buying strictly worse and turn this into a mandatory upgrade.
 */

import { dayStateAt } from './clock';
import { getMerchant } from './config';
import { addIngredient } from './inventory';
import { isPresent, relationshipOf, tierOf } from './merchants';
import { derivedStats } from './progression';
import { merchantPriceMultiplier } from './town';
import type { StandingOrder, World } from './types';

export const MAX_ORDER_LINES = 4;

export function ordersFor(world: World, merchantId: string): StandingOrder | undefined {
  return world.standingOrders.find((order) => order.merchantId === merchantId);
}

export function setOrderLine(
  world: World,
  merchantId: string,
  kind: StandingOrder['lines'][number]['kind'],
  id: string,
  count: number,
): boolean {
  if (!derivedStats(world).standingOrders) return false;
  getMerchant(merchantId);

  let order = ordersFor(world, merchantId);
  if (!order) {
    order = { merchantId, lines: [], lastFulfilledDay: -1 };
    world.standingOrders.push(order);
  }

  const existing = order.lines.find((line) => line.kind === kind && line.id === id);
  if (count <= 0) {
    order.lines = order.lines.filter((line) => !(line.kind === kind && line.id === id));
    return true;
  }
  if (existing) {
    existing.count = count;
    return true;
  }
  if (order.lines.length >= MAX_ORDER_LINES) return false;
  order.lines.push({ kind, id, count });
  return true;
}

export interface Fulfilment {
  merchantId: string;
  delivered: Array<{ kind: string; id: string; count: number }>;
  gold: number;
  /** True when the purse ran out partway. */
  partial: boolean;
}

/**
 * Fulfil any standing order whose merchant is in town today.
 *
 * Runs inside `advanceTo`, so an order left running is fulfilled during offline
 * catch-up exactly as it would be live. Anything unaffordable is simply skipped
 * — a standing order must never put the player into debt or block a visit.
 */
export function runStandingOrders(world: World): Fulfilment[] {
  if (!derivedStats(world).standingOrders) return [];

  const today = dayStateAt(world.now).dayNumber;
  const out: Fulfilment[] = [];

  for (const order of world.standingOrders) {
    if (order.lines.length === 0) continue;
    if (order.lastFulfilledDay === today) continue;

    const def = getMerchant(order.merchantId);
    if (!isPresent(def, world.now)) continue;

    const tier = tierOf(def, relationshipOf(world, order.merchantId));
    const discount = tier * def.discountPerTier;

    const delivered: Fulfilment['delivered'] = [];
    let spent = 0;
    let partial = false;

    for (const line of order.lines) {
      /*
       * Priced from the merchant's catalogue, not from whatever this visit
       * happened to roll. An order placed in advance is the merchant sourcing
       * it for you — if it only arrived when the shelf randomly had it, the
       * order book would be a lottery ticket rather than the answer to
       * re-buying the same thing forever.
       */
      const catalogue = def.pool.find(
        (item) => item.kind === line.kind && item.id === line.id && item.tier <= tier,
      );
      if (!catalogue?.price) continue;

      // Same price a visit would have charged, town's price level included —
      // an order that quietly billed the untaxed rate would be a way to dodge
      // Highmarch's prices by never walking to the stall.
      const price = Math.max(
        1,
        Math.round(catalogue.price * (1 - discount) * merchantPriceMultiplier(world)),
      );
      const affordable = Math.floor((world.gold - spent) / price);
      const count = Math.min(line.count, Math.max(0, affordable));
      if (count <= 0) {
        if (line.count > 0) partial = true;
        continue;
      }

      spent += price * count;
      delivered.push({ kind: line.kind, id: line.id, count });
      if (count < line.count) partial = true;
    }

    if (delivered.length === 0) {
      order.lastFulfilledDay = today;
      continue;
    }

    world.gold -= spent;
    for (const item of delivered) deliverLine(world, item.kind, item.id, item.count);
    order.lastFulfilledDay = today;

    out.push({ merchantId: order.merchantId, delivered, gold: spent, partial });
  }

  return out;
}

function deliverLine(world: World, kind: string, id: string, count: number): void {
  switch (kind) {
    case 'seed':
      world.seeds[id] = (world.seeds[id] ?? 0) + count;
      break;
    case 'ingredient':
      addIngredient(world, id, count, world.now);
      break;
    case 'vessel':
      world.vessels[id] = (world.vessels[id] ?? 0) + count;
      break;
    case 'seal':
      world.seals[id] = (world.seals[id] ?? 0) + count;
      break;
    default:
      // Equipment is a one-off decision and is never put on a standing order.
      break;
  }
}
