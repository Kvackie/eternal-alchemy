/**
 * The contract board.
 *
 * Contracts are the planned selling channel: a named quantity at a named grade
 * by a deadline. They are the
 * main gold faucet and the reason to plan a supply chain rather than brewing
 * whatever is to hand.
 *
 * Two mercies are deliberate. **Deadlines only tick while the player is
 * present** — a contract's clock is stored as remaining time and decremented on
 * online ticks only, so a weekend away never costs one. And **partial delivery**
 * pays pro rata with no reputation hit, so a bad week is disappointing rather
 * than punishing.
 */

import { contractsConfig, getContractTemplate, getFaction, getRecipe } from './config';
import { discoveredRecipes } from './discovery';
import { angleBetween, GRADE_ORDER, gradeAtLeast } from './essences';
import { fairValue } from './market';
import { rankOf } from './progression';
import { contractPayoutMultiplier } from './town';
import { Rng } from './rng';
import type { BottledItem, Contract, ContractTerms, Grade, World } from './types';

/**
 * What this contract asks for, whoever wrote it.
 *
 * Derived commissions carry their own terms; ones posted from a template — and
 * every contract in a save written before commissions existed — read them off
 * the template.
 */
export function contractTerms(contract: Contract): ContractTerms {
  if (contract.terms) return contract.terms;
  const template = getContractTemplate(contract.templateId);
  return {
    faction: template.faction,
    recipeId: template.recipeId,
    minGrade: template.minGrade,
  };
}

/** Bottles in storage that would satisfy this contract. */
export function qualifyingItems(world: World, contract: Contract): BottledItem[] {
  const terms = contractTerms(contract);
  return world.bottled.filter((item) => {
    if (item.recipeId !== terms.recipeId) return false;
    return gradeAtLeast(item.grade, terms.minGrade);
  });
}

/**
 * How well a recipe suits a faction's palate, as a weight.
 *
 * Zero past the faction's spread, and falling off smoothly inside it, so a
 * temple commissions breath and water almost always and something earthy only
 * occasionally — rather than the two being equally likely the moment both are
 * inside the cone.
 */
function palateWeight(recipeId: string, factionId: string): number {
  const faction = getFaction(factionId);
  const spread = (faction.spreadDeg * Math.PI) / 180;
  const off = angleBetween(getRecipe(recipeId).target, faction.palate);
  if (off >= spread) return 0;
  const closeness = 1 - off / spread;
  // Squared, so the middle of the palate dominates rather than merely leading.
  return closeness * closeness;
}

/** Weighted draw. Returns null when every weight is zero. */
function pickWeighted<T>(entries: Array<{ value: T; weight: number }>, rng: Rng): T | null {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1]!.value;
}

/**
 * A commission generated from a faction's palate.
 *
 * Only discovered recipes are eligible. A contract for something the player has
 * never brewed is not a goal, it is a taunt — and the hand-authored templates
 * already cover pointing at recipes you have yet to meet.
 *
 * Returns null when nothing the player knows suits anyone, which is the normal
 * state on day one and the reason the template path still exists.
 */
function deriveTerms(world: World, rng: Rng, rank: number): ContractTerms | null {
  const known = discoveredRecipes(world);
  if (known.length === 0) return null;

  const factions = contractsConfig.factions.filter((faction) => faction.requiresRank <= rank);
  if (factions.length === 0) return null;

  // Recipes already spoken for on the board are half as likely, so a board of
  // three is a shopping list rather than the same order three times.
  const onBoard = new Set(world.contracts.map((entry) => contractTerms(entry).recipeId));

  const candidates: Array<{ value: ContractTerms; weight: number }> = [];
  for (const faction of factions) {
    for (const recipe of known) {
      const weight = palateWeight(recipe.id, faction.id);
      if (weight <= 0) continue;
      candidates.push({
        value: {
          faction: faction.id,
          recipeId: recipe.id,
          minGrade: gradeForRank(rank),
        },
        weight: weight * (onBoard.has(recipe.id) ? 0.5 : 1),
      });
    }
  }

  return pickWeighted(candidates, rng);
}

/** The grade floor expected of a shop at this rank. */
function gradeForRank(rank: number): Grade {
  const ladder = contractsConfig.derived.gradeByRank;
  return ladder[Math.min(rank, ladder.length - 1)] ?? 'C';
}

/**
 * How many of a thing an order asks for.
 *
 * Interpolated off base value so cheap potions are ordered by the crate and
 * expensive ones by the pair — and so a recipe added later lands on the curve
 * without anyone tuning a quantity for it.
 */
function quantityFor(recipeId: string, rng: Rng): number {
  const d = contractsConfig.derived;
  const value = getRecipe(recipeId).baseValue;
  const span = Math.max(1, d.highValue - d.lowValue);
  const t = Math.min(1, Math.max(0, (value - d.lowValue) / span));
  const middle = d.quantityAtLowValue + (d.quantityAtHighValue - d.quantityAtLowValue) * t;
  const spread = d.quantitySpread;
  return Math.max(1, Math.round(middle + rng.int(-spread, spread) * 0.5));
}

/**
 * One draw of an order's terms.
 *
 * Most of the board is commissioned from a palate; the rest keeps the
 * hand-authored orders in rotation, for the flavour a generator cannot write.
 */
function drawTerms(
  world: World,
  local: Rng,
  rank: number,
): { terms: ContractTerms | null; templateId: string; quantity: number } {
  let terms: ContractTerms | null = null;
  let templateId = '';
  let quantity = 0;

  if (local.next() < contractsConfig.derived.derivedShare) {
    terms = deriveTerms(world, local, rank);
    if (terms) quantity = quantityFor(terms.recipeId, local);
  }

  if (!terms) {
    const available = contractsConfig.templates.filter((template) => template.requiresRank <= rank);
    if (available.length === 0) return { terms: null, templateId, quantity };
    const template = available[local.int(0, available.length - 1)]!;
    templateId = template.id;
    quantity = local.int(template.quantityMin, template.quantityMax);
    terms = {
      faction: template.faction,
      recipeId: template.recipeId,
      minGrade: template.minGrade,
    };
  }

  return { terms, templateId, quantity };
}

/**
 * Post a new contract.
 *
 * The payout is derived from what the goods are actually worth, so a contract
 * is always a better deal than the shelf — but only if you can meet the grade.
 */
export function generateContract(
  world: World,
  rng: Rng,
  id: number,
  dayLengthMs: number,
): Contract | null {
  const rank = rankOf(world);

  /*
   * One draw from the shared stream; everything else from a private one.
   *
   * The simulation threads a SINGLE Rng through market, cave, shaft, missions
   * and the board, in that order, every tick. A generator that consumes a
   * variable number of draws therefore changes what the cave grows on the next
   * tick — which is exactly what happened when commissions arrived, and it
   * showed up as a watched run and a caught-up run disagreeing about the cave.
   *
   * Taking exactly one value and deriving a local stream from it leaves the
   * commission logic free to draw as much as it likes without reaching into
   * anything else.
   */
  const local = new Rng(rng.int(1, 0x7ffffffe));

  let terms: ContractTerms | null = null;
  let templateId = '';
  let quantity = 0;

  /*
   * Near the same is fine; the same is not.
   *
   * The board is three orders, and two of them asking one faction for the
   * same number of the same potion at the same grade is one order shown twice.
   * A few redraws find something else; if nothing else comes up, the slot
   * stays empty until the next tick tries again.
   */
  for (let attempt = 0; attempt < 8; attempt += 1) {
    ({ terms, templateId, quantity } = drawTerms(world, local, rank));
    if (!terms) return null;
    const drawn = terms;
    const repeats = world.contracts.some((contract) => {
      const other = contractTerms(contract);
      return (
        contract.quantity === quantity &&
        other.faction === drawn.faction &&
        other.recipeId === drawn.recipeId &&
        other.minGrade === drawn.minGrade
      );
    });
    if (!repeats) break;
    if (attempt === 7) return null;
  }
  if (!terms) return null;

  const unitValue = fairValue({
    recipeId: terms.recipeId,
    grade: terms.minGrade,
    potencyTier: 'common',
  });

  const days = local.int(contractsConfig.deadlineDaysMin, contractsConfig.deadlineDaysMax);

  return {
    id: `contract-${id}`,
    templateId,
    ...(templateId ? {} : { terms }),
    quantity,
    delivered: 0,
    payout: Math.max(10, Math.round(unitValue * quantity * contractsConfig.goldPerUnitValue)),
    renown: contractsConfig.renownPerContract,
    // Deadlines are quoted in in-game days, so they scale with the day length.
    msRemaining: days * dayLengthMs,
    deadlineDays: days,
    postedAt: world.now,
  };
}

export interface DeliveryResult {
  delivered: number;
  gold: number;
  renown: number;
  complete: boolean;
}

/**
 * Hand over as many qualifying bottles as the contract still wants.
 *
 * Spends the *worst* qualifying bottles first: a contract asking for grade C
 * should not quietly consume an S you were saving, when a C would have done.
 */
export function deliver(world: World, contractId: string): DeliveryResult | null {
  const contract = world.contracts.find((entry) => entry.id === contractId);
  if (!contract) return null;

  const wanted = contract.quantity - contract.delivered;
  if (wanted <= 0) return null;

  const qualifying = qualifyingItems(world, contract).sort(
    (a, b) => GRADE_ORDER.indexOf(b.grade) - GRADE_ORDER.indexOf(a.grade),
  );

  const handing = qualifying.slice(0, wanted);
  if (handing.length === 0) return null;

  for (const item of handing) {
    const index = world.bottled.findIndex((entry) => entry.uid === item.uid);
    if (index >= 0) world.bottled.splice(index, 1);
  }

  const credited = handing.length;
  contract.delivered += credited;
  const complete = contract.delivered >= contract.quantity;

  // Pro rata on partial delivery, with the remainder still owed.
  const share = credited / contract.quantity;

  // Highmarch has the noble money, and it is the contracts that show it.
  const gold = Math.round(contract.payout * share * contractPayoutMultiplier(world));
  const renown = complete ? contract.renown : 0;

  world.gold += gold;
  world.renown += renown;
  world.statistics.contractsDelivered += complete ? 1 : 0;

  if (complete) {
    const faction = contractTerms(contract).faction;
    world.factionReputation[faction] =
      (world.factionReputation[faction] ?? 0) + contractsConfig.reputationOnDeliver;
    world.contracts = world.contracts.filter((entry) => entry.id !== contract.id);
  }

  return { delivered: credited, gold, renown, complete };
}

export function abandon(world: World, contractId: string): boolean {
  const contract = world.contracts.find((entry) => entry.id === contractId);
  if (!contract) return false;
  failContract(world, contract);
  return true;
}

function failContract(world: World, contract: Contract): void {
  const faction = contractTerms(contract).faction;
  world.factionReputation[faction] =
    (world.factionReputation[faction] ?? 0) + contractsConfig.reputationOnFail;
  world.contracts = world.contracts.filter((entry) => entry.id !== contract.id);
  world.statistics.contractsFailed += 1;
}

export interface BoardUpdate {
  expired: Contract[];
  posted: Contract[];
}

/**
 * Tick the board.
 *
 * `elapsedOnlineMs` is deliberately *not* the full delta — deadlines only run
 * down while the player is present. Being away pauses every contract, which is
 * the whole point.
 */
export function runContracts(
  world: World,
  rng: Rng,
  elapsedOnlineMs: number,
  dayLengthMs: number,
): BoardUpdate {
  const expired: Contract[] = [];

  if (elapsedOnlineMs > 0) {
    for (const contract of [...world.contracts]) {
      contract.msRemaining -= elapsedOnlineMs;
      if (contract.msRemaining <= 0) {
        expired.push(contract);
        failContract(world, contract);
      }
    }
  }

  const posted: Contract[] = [];
  while (world.contracts.length < contractsConfig.boardSize) {
    const contract = generateContract(world, rng, world.nextContractId, dayLengthMs);
    if (!contract) break;
    world.nextContractId += 1;
    world.contracts.push(contract);
    posted.push(contract);
  }

  return { expired, posted };
}

/** Everything the board needs to render a row. */
export function contractSummary(world: World, contract: Contract) {
  const terms = contractTerms(contract);
  return {
    contract,
    // The board reads `.faction`, `.recipeId` and `.minGrade` off this, all of
    // which terms carries, whether the order was written by hand or
    // commissioned from a palate.
    template: terms,
    terms,
    recipe: getRecipe(terms.recipeId),
    ready: qualifyingItems(world, contract).length,
    wanted: contract.quantity - contract.delivered,
  };
}
