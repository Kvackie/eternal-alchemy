/**
 * Shop décor.
 *
 * The distinction from equipment is the whole point of the system. Equipment is
 * bought and forgotten: it works the moment it is owned and there is no reason
 * not to own all of it. Décor has to be **placed**, and the shop has five spots,
 * so owning everything still leaves you choosing which five are out. That turns
 * a shopping list into a decision.
 *
 * Effects are derived from what is placed, never stored — same rule as
 * equipment, for the same reason. A stored total drifts the moment a migration
 * moves a piece; a derived one cannot.
 */

import { decorConfig, decorForSpot, findDecor, getDecor } from './config';
import type { DecorDef } from './config';
import { rankIndexFor } from './progression';
import type { World } from './types';

export const decorSpots = decorConfig.spots;

export function ownsDecor(world: World, decorId: string): boolean {
  return (world.decorOwned[decorId] ?? 0) > 0;
}

/** What is standing in each spot right now, skipping empties. */
export function placedDecor(world: World): DecorDef[] {
  const placed: DecorDef[] = [];
  for (const spot of decorSpots) {
    const id = world.decor[spot];
    if (!id) continue;
    // A piece removed from the data file leaves the spot empty rather than
    // throwing — a save should survive its content being edited.
    const def = findDecor(id);
    if (def) placed.push(def);
  }
  return placed;
}

export function placedIn(world: World, spot: string): DecorDef | null {
  const id = world.decor[spot];
  return id ? (findDecor(id) ?? null) : null;
}

/**
 * Whether a piece can appear in a merchant's stock.
 *
 * Mirrors `equipmentAvailability`: a locked piece still shows, with the reason
 * attached, because seeing the gilded sign you cannot afford is how a player
 * learns what the next rank is for.
 */
export function decorAvailability(
  world: World,
  def: DecorDef,
): { visible: boolean; reasonKey?: string } {
  if (ownsDecor(world, def.id)) return { visible: false };
  if (rankIndexFor(world.renown) < def.requiresRank) {
    return { visible: true, reasonKey: 'market.reason.rank' };
  }
  return { visible: true };
}

export function canBuyDecor(world: World, def: DecorDef): boolean {
  return decorAvailability(world, def).reasonKey === undefined;
}

/**
 * Take delivery of a piece.
 *
 * Placed straight away if its spot is free. Buying a rug and then having to go
 * and put the rug down is a chore, not a decision — the decision only exists
 * once two pieces want the same spot, and that is when we leave it alone.
 */
export function grantDecor(world: World, decorId: string): void {
  const def = getDecor(decorId);
  world.decorOwned[decorId] = (world.decorOwned[decorId] ?? 0) + 1;
  if (!world.decor[def.spot]) world.decor[def.spot] = decorId;
}

/** Put an owned piece out, displacing whatever shared its spot. */
export function placeDecor(world: World, decorId: string): boolean {
  const def = findDecor(decorId);
  if (!def || !ownsDecor(world, decorId)) return false;
  // The displaced piece is not lost — it stays owned and can go back out later.
  world.decor[def.spot] = decorId;
  return true;
}

export function clearSpot(world: World, spot: string): boolean {
  if (!world.decor[spot]) return false;
  world.decor[spot] = null;
  return true;
}

/**
 * Everything the shop panel needs to draw one spot: what is in it, and what
 * else could be, including pieces not yet bought so the spot advertises itself.
 */
export interface SpotView {
  spot: string;
  placed: DecorDef | null;
  options: Array<{ def: DecorDef; owned: boolean }>;
}

export function spotViews(world: World): SpotView[] {
  return decorSpots.map((spot) => ({
    spot,
    placed: placedIn(world, spot),
    options: decorForSpot(spot).map((def) => ({ def, owned: ownsDecor(world, def.id) })),
  }));
}

/** A fresh, empty shop floor. */
export function emptySpots(): Record<string, string | null> {
  const spots: Record<string, string | null> = {};
  for (const spot of decorSpots) spots[spot] = null;
  return spots;
}
