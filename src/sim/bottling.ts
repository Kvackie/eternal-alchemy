/**
 * The workbench: form, vessel, seal.
 *
 * Three independent choices made on one finished brew. Bottling is instant and
 * irreversible, and once sealed an item never degrades — freshness lives on raw
 * ingredients only, so a stockpile built for a big order stays worth building.
 */

import { forms, getForm, getSeal, getVessel, vessels, seals } from './config';
import { emptyComposition, essenceShare, potencyRank, type BrewComposition } from './essences';
import { fairValue } from './market';
import type { BottledItem, EssenceVector, Grade, PotencyTierId, World } from './types';

/** The subset of a finished brew that bottling actually reads. */
export interface PendingBrew {
  recipeId: string;
  total: EssenceVector;
  grade: Grade;
  purity: number;
  totalEssence: number;
  potencyTier: PotencyTierId;
  composition?: BrewComposition;
}

export interface FormAvailability {
  formId: string;
  available: boolean;
  /** i18n key explaining why not, when unavailable. */
  reasonKey?: string;
}

/**
 * Which forms this brew qualifies for, and why the others don't.
 *
 * Checked in the order a player would ask: is it strong enough, is the balance
 * right, is it made of the right stuff. Only the first failure is reported — a
 * list of five reasons teaches nothing.
 */
export function availableForms(brew: PendingBrew): FormAvailability[] {
  const composition = brew.composition ?? emptyComposition();

  return forms.map((form) => {
    const req = form.requires;

    if (req.minPotencyTier && potencyRank(brew.potencyTier) < potencyRank(req.minPotencyTier)) {
      return { formId: form.id, available: false, reasonKey: 'workbench.reason.potency' };
    }

    if (req.minEssenceShare) {
      const share = essenceShare(brew.total, req.minEssenceShare.essence);
      if (share < req.minEssenceShare.share) {
        return { formId: form.id, available: false, reasonKey: 'workbench.reason.essenceShare' };
      }
    }

    // Grinding needs dry material — this is what makes a drying rack worth owning.
    if (req.driedOnly && composition.driedShare < 1) {
      return { formId: form.id, available: false, reasonKey: 'workbench.reason.dried' };
    }

    if (req.minMineralShare !== undefined && composition.mineralShare < req.minMineralShare) {
      return { formId: form.id, available: false, reasonKey: 'workbench.reason.mineral' };
    }

    if (req.requiresTrait && !composition.traits.includes(req.requiresTrait)) {
      return { formId: form.id, available: false, reasonKey: 'workbench.reason.trait' };
    }

    return { formId: form.id, available: true };
  });
}

export interface VesselAvailability {
  vesselId: string;
  available: boolean;
  inStock: number;
  reasonKey?: string;
}

/**
 * A vessel that can't hold the brew's potency isn't hidden — it's shown as
 * blocked, so the player learns the cap exists before they need it.
 */
export function availableVessels(
  world: World,
  brew: PendingBrew,
  formId?: string,
): VesselAvailability[] {
  return vessels.map((vessel) => {
    const inStock = world.vessels[vessel.id] ?? 0;
    if (inStock <= 0) {
      return { vesselId: vessel.id, available: false, inStock, reasonKey: 'workbench.reason.stock' };
    }
    if (potencyRank(brew.potencyTier) > potencyRank(vessel.potencyCap)) {
      return {
        vesselId: vessel.id,
        available: false,
        inStock,
        reasonKey: 'workbench.reason.vesselCap',
      };
    }
    // A pouch will not hold a liquid; the form decides which vessels apply.
    if (vessel.onlyForms && formId && !vessel.onlyForms.includes(formId)) {
      return {
        vesselId: vessel.id,
        available: false,
        inStock,
        reasonKey: 'workbench.reason.vesselForm',
      };
    }
    /*
     * Something unstable needs iron around it.
     *
     * This used to be checked only in `canBottle`, on the reasoning that
     * containment is a property of the choice rather than of the vessel. The
     * effect was that a volatile brew listed six vessels as available and
     * `canBottle` then refused all six: the workbench auto-selected the first,
     * the Bottle button did nothing when pressed, and nothing on screen said
     * why. A list that says "available" about a vessel that cannot be used is
     * simply wrong, whatever the reasoning behind it.
     */
    if (volatileNeedsContainment(brew, vessel.id)) {
      return {
        vesselId: vessel.id,
        available: false,
        inStock,
        reasonKey: 'workbench.reason.volatile',
      };
    }
    return { vesselId: vessel.id, available: true, inStock };
  });
}

/**
 * A volatile brew needs containment.
 *
 * Checked separately from `availableVessels` because it is a property of the
 * *choice*, not of the vessel: every vessel is fine until you try to put
 * something unstable in one that isn't iron-bound.
 */
export function volatileNeedsContainment(brew: PendingBrew, vesselId: string): boolean {
  const composition = brew.composition ?? emptyComposition();
  if (!composition.traits.includes('volatile')) return false;
  return getVessel(vesselId).requiredForVolatile !== true;
}

export interface SealAvailability {
  sealId: string;
  available: boolean;
  inStock: number;
  reasonKey?: string;
}

export function availableSeals(
  world: World,
  brew?: PendingBrew,
  rankIndex = 99,
): SealAvailability[] {
  const umbraShare = brew ? essenceShare(brew.total, 'umbra') : 1;

  return seals.map((seal) => {
    const inStock = world.seals[seal.id] ?? 0;

    if ((seal.requiresRank ?? 0) > rankIndex) {
      return { sealId: seal.id, available: false, inStock, reasonKey: 'market.reason.rank' };
    }
    // The Ashwalker's mark means nothing on a brew with no shadow in it.
    if (seal.umbraOnly && umbraShare < 0.25) {
      return { sealId: seal.id, available: false, inStock, reasonKey: 'workbench.reason.umbra' };
    }
    // Cork is free and never runs out; it's the guarantee that bottling is always possible.
    const available = seal.cost === 0 || inStock > 0;
    return {
      sealId: seal.id,
      available,
      inStock,
      ...(available ? {} : { reasonKey: 'workbench.reason.stock' }),
    };
  });
}

export interface BottleRequest {
  formId: string;
  vesselId: string;
  sealId: string;
}

export function canBottle(
  world: World,
  brew: PendingBrew,
  req: BottleRequest,
  rankIndex = 99,
): boolean {
  const form = availableForms(brew).find((f) => f.formId === req.formId);
  const vessel = availableVessels(world, brew, req.formId).find((v) => v.vesselId === req.vesselId);
  const seal = availableSeals(world, brew, rankIndex).find((s) => s.sealId === req.sealId);
  if (!form?.available || !vessel?.available || !seal?.available) return false;
  return !volatileNeedsContainment(brew, req.vesselId);
}

let uidCounter = 0;

/** Deterministic enough for a save file, unique enough for a session. */
export function nextUid(now: number): string {
  uidCounter += 1;
  return `item-${now.toString(36)}-${uidCounter.toString(36)}`;
}

export function bottle(
  world: World,
  brew: PendingBrew,
  req: BottleRequest,
  rankIndex = 99,
): BottledItem | null {
  if (!canBottle(world, brew, req, rankIndex)) return null;

  const vessel = getVessel(req.vesselId);
  const seal = getSeal(req.sealId);
  const form = getForm(req.formId);

  world.vessels[req.vesselId] = (world.vessels[req.vesselId] ?? 0) - 1;
  if (seal.cost > 0) world.seals[req.sealId] = (world.seals[req.sealId] ?? 0) - 1;

  const item: BottledItem = {
    uid: nextUid(world.now),
    recipeId: brew.recipeId,
    formId: req.formId,
    vesselId: req.vesselId,
    sealId: req.sealId,
    grade: brew.grade,
    purity: Math.round(brew.purity),
    potencyTier: brew.potencyTier,
    totalEssence: Math.round(brew.totalEssence),
    // A copper bottle or an amphora holds more of a multi-dose form; a single
    // dose stays a single dose whatever you put it in.
    dosesLeft: form.doses > 1 ? form.doses + (vessel.bonusDoses ?? 0) : form.doses,
    fairValue: 0,
    bottledAt: world.now,
  };

  item.fairValue = fairValue(item);
  world.bottled.push(item);
  return item;
}

/** Restock helper used by the starting loadout and, later, by merchants. */
export function grantVessels(world: World, vesselId: string, count: number): void {
  getVessel(vesselId);
  world.vessels[vesselId] = (world.vessels[vesselId] ?? 0) + count;
}

export function grantSeals(world: World, sealId: string, count: number): void {
  getSeal(sealId);
  world.seals[sealId] = (world.seals[sealId] ?? 0) + count;
}
