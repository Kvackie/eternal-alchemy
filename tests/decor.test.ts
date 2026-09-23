/**
 * Shop décor.
 *
 * The property that matters is that placement, not ownership, is what pays.
 * If owning a piece were enough, décor would be equipment with a nicer name and
 * the five spots would be decoration in the worst sense.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { SaveManager, memoryAdapter } from '@/platform/save';
import {
  baseShelfTier,
  config,
  decorConfig,
  decorPieces,
  equipment,
  getDecor,
  merchants,
  shelfTiers,
} from '@/sim/config';
import { clearSpot, grantDecor, ownsDecor, placeDecor, placedIn, spotViews } from '@/sim/decor';
import { derivedStats } from '@/sim/progression';
import { appealOf, fitBoard, footfallAt, saleChance } from '@/sim/market';
import type { World } from '@/sim/types';

describe('the data holds together', () => {
  it('puts every piece in a declared spot', () => {
    for (const piece of decorPieces) {
      expect(decorConfig.spots, `${piece.id} has no spot`).toContain(piece.spot);
    }
  });

  it('offers at least two pieces per spot, or the spot is not a decision', () => {
    for (const spot of decorConfig.spots) {
      const pieces = decorPieces.filter((piece) => piece.spot === spot);
      expect(pieces.length, `only one piece can go in the ${spot}`).toBeGreaterThan(1);
    }
  });

  it('declares an effect on every piece', () => {
    for (const piece of decorPieces) {
      const values = Object.values(piece.effect).filter((value) => value !== undefined);
      expect(values.length, `${piece.id} does nothing`).toBeGreaterThan(0);
    }
  });

  it('no longer carries the moved pieces as equipment', () => {
    // Counted twice — once as equipment, once as décor — a rug would silently
    // double its own footfall bonus.
    const equipmentIds = new Set(equipment.map((def) => def.id));
    for (const piece of decorPieces) {
      expect(equipmentIds.has(piece.id), `${piece.id} is both equipment and décor`).toBe(false);
    }
  });
});

describe('placement is what pays', () => {
  it('does nothing while a piece sits unplaced', () => {
    const world = createWorld(1);
    const before = derivedStats(world).footfallBonus;

    // Owned but deliberately not placed.
    world.decorOwned.goldBanner = 1;
    expect(derivedStats(world).footfallBonus).toBe(before);

    placeDecor(world, 'goldBanner');
    const expected = before + (getDecor('goldBanner').effect.footfallBonus ?? 0);
    expect(derivedStats(world).footfallBonus).toBeCloseTo(expected, 5);
  });

  it('refuses to place a piece that was never bought', () => {
    const world = createWorld(1);
    expect(placeDecor(world, 'coinStack')).toBe(false);
    expect(placedIn(world, 'floor')).toBeNull();
  });

  it('lets one spot hold only one piece', () => {
    const world = createWorld(1);
    grantDecor(world, 'coinSacks');
    grantDecor(world, 'coinStack');

    // Both stand on the floor, so the second displaces the first rather than
    // stacking — and only the placed one's bonus is ever counted.
    placeDecor(world, 'coinStack');
    expect(placedIn(world, 'floor')?.id).toBe('coinStack');
    expect(derivedStats(world).appealBonus).toBeCloseTo(
      getDecor('coinStack').effect.appealBonus ?? 0,
      5,
    );

    // And the displaced piece is still owned, so the swap is reversible.
    expect(ownsDecor(world, 'coinSacks')).toBe(true);
    placeDecor(world, 'coinSacks');
    expect(derivedStats(world).appealBonus).toBeCloseTo(
      getDecor('coinSacks').effect.appealBonus ?? 0,
      5,
    );
  });

  it('places a new piece straight away when its spot is free', () => {
    const world = createWorld(1);
    grantDecor(world, 'mortarAndPestle');
    // Buying a counter and then having to go and put the counter down is a
    // chore, not a decision.
    expect(placedIn(world, 'counter')?.id).toBe('mortarAndPestle');
  });

  it('leaves a spot alone when something is already in it', () => {
    const world = createWorld(1);
    grantDecor(world, 'goldGoblet');
    grantDecor(world, 'mortarAndPestle');
    // The cheaper piece arriving second must not quietly downgrade the shop.
    expect(placedIn(world, 'counter')?.id).toBe('goldGoblet');
  });

  it('empties a spot on request', () => {
    const world = createWorld(1);
    grantDecor(world, 'coinSacks');
    expect(clearSpot(world, 'floor')).toBe(true);
    expect(placedIn(world, 'floor')).toBeNull();
    expect(derivedStats(world).appealBonus).toBe(0);
    // Clearing an empty spot is a no-op, not an error.
    expect(clearSpot(world, 'floor')).toBe(false);
  });
});

describe('décor reaches the things it claims to change', () => {
  it('raises what a bottle looks worth', () => {
    const world = createWorld(1);
    const plain = appealOf(derivedStats(world).appealBonus);

    grantDecor(world, 'pottedFern');
    const dressed = appealOf(derivedStats(world).appealBonus);
    expect(dressed).toBeGreaterThan(plain);
  });

  it('raises footfall by day', () => {
    const world = createWorld(1);
    const noon = config.clock.dayLengthMs * 0.4;
    const before = footfallAt(world, noon, true);

    grantDecor(world, 'crimsonBanner');
    expect(footfallAt(world, noon, true)).toBeGreaterThan(before);
  });

  it('raises footfall only after dark for a lantern', () => {
    const world = createWorld(1);
    const noon = config.clock.dayLengthMs * 0.4;
    const midnight = config.clock.dayLengthMs * 0.9;

    const dayBefore = footfallAt(world, noon, true);
    const nightBefore = footfallAt(world, midnight, true);

    grantDecor(world, 'sproutingUrn');
    // The whole reason to choose it over the display case.
    expect(footfallAt(world, noon, true)).toBeCloseTo(dayBefore, 5);
    expect(footfallAt(world, midnight, true)).toBeGreaterThan(nightBefore);
  });

  it('raises the haggle ceiling', () => {
    const world = createWorld(1);
    expect(derivedStats(world).haggleCeilingBonus).toBe(0);
    grantDecor(world, 'skullChalice');
    expect(derivedStats(world).haggleCeilingBonus).toBeCloseTo(
      getDecor('skullChalice').effect.haggleCeilingBonus ?? 0,
      5,
    );
  });
});

describe('buying décor', () => {
  it('takes gold, records ownership and puts the piece out', () => {
    const sim = new Simulation(createWorld(4));
    sim.world.gold = 5000;
    sim.world.renown = 400;
    sim.world.bottledKinds['S|5|sovereign'] = true;

    // Find whichever merchant is currently carrying a furnishing.
    let bought = false;
    for (let day = 0; day < 12 && !bought; day += 1) {
      for (const visit of sim.merchants()) {
        const index = visit.entries.findIndex((entry) => entry.kind === 'decor');
        if (index < 0) continue;
        const entry = visit.entries[index]!;
        const before = sim.world.gold;

        const result = sim.buy(visit.merchantId, index);
        if (!result.ok) continue;

        // Charged exactly what was shown — the entry's price is the one truth,
        // and it already carries the town's price level.
        expect(sim.world.gold).toBe(before - entry.price!);
        expect(entry.price).toBeGreaterThanOrEqual(getDecor(entry.id).cost);
        expect(ownsDecor(sim.world, entry.id)).toBe(true);
        expect(placedIn(sim.world, getDecor(entry.id).spot)?.id).toBe(entry.id);
        bought = true;
        break;
      }
      sim.advanceBy(config.clock.dayLengthMs);
    }

    expect(bought, 'no merchant stocked a furnishing in twelve days').toBe(true);
  });

  it('stops offering a piece once it is owned', () => {
    const sim = new Simulation(createWorld(4));
    sim.world.gold = 5000;
    sim.world.decorOwned.mortarAndPestle = 1;

    for (let day = 0; day < 8; day += 1) {
      for (const visit of sim.merchants()) {
        const ids = visit.entries.map((entry) => entry.id);
        expect(ids).not.toContain('mortarAndPestle');
      }
      sim.advanceBy(config.clock.dayLengthMs);
    }
  });
});

describe('a visit remembers what was bought, not where it sat', () => {
  it('marks the bought item sold out and leaves its neighbours alone', () => {
    const sim = new Simulation(createWorld(11));
    sim.world.gold = 5000;

    const visit = sim.merchants()[0];
    if (!visit) return;
    // A restockable consumable, so the remaining count can actually go down by
    // one rather than straight to zero.
    const index = visit.entries.findIndex(
      (entry) =>
        entry.remaining > 1 &&
        entry.price !== null &&
        entry.kind !== 'equipment' &&
        entry.kind !== 'decor',
    );
    const target = visit.entries[index]!;

    expect(sim.buy(visit.merchantId, index).ok).toBe(true);

    const after = sim.merchants().find((v) => v.merchantId === visit.merchantId)!;
    const same = after.entries.find((entry) => entry.id === target.id)!;
    expect(same.remaining).toBe(target.remaining - 1);

    // Every other entry is untouched — the bug was one purchase marking a
    // different item as gone.
    for (const entry of after.entries) {
      if (entry.id === target.id) continue;
      const before = visit.entries.find((e) => e.id === entry.id)!;
      expect(entry.remaining, `${entry.id} lost stock it never sold`).toBe(before.remaining);
    }
  });

  it('survives a merchant pool being edited under an existing save', () => {
    const sim = new Simulation(createWorld(11));

    /*
     * Simulates exactly what shipping new content does: a purchase recorded
     * before the edit, read back after the entry list has shifted. Under the old
     * positional key this marked an unrelated item sold out.
     */
    sim.world.merchantVisits = {
      bramm: { dayNumber: 0, bought: { somethingRemoved: 1 } },
    };

    for (const visit of sim.merchants()) {
      for (const entry of visit.entries) {
        expect(entry.remaining, `${entry.id} is sold out on a fresh visit`).toBeGreaterThan(0);
      }
    }
  });
});

describe('the shop panel has something to draw', () => {
  it('lists every spot with its options, owned or not', () => {
    const world = createWorld(1);
    const views = spotViews(world);

    expect(views).toHaveLength(decorConfig.spots.length);
    for (const view of views) {
      expect(view.placed).toBeNull();
      // Unowned options still appear — an empty window has to advertise itself.
      expect(view.options.length).toBeGreaterThan(1);
      expect(view.options.every((option) => !option.owned)).toBe(true);
    }
  });
});

describe('an older save keeps its fittings', () => {
  it('converts bought shop upgrades into placed décor', () => {
    const save = new SaveManager(memoryAdapter());

    /*
     * A v8 shop that had paid for four of the seven shop upgrades, under the ids
     * they had then. Those pieces were later replaced outright when painted art
     * arrived, so the migration has to hand over their successors rather than
     * quietly dropping a purchase.
     */
    const legacy = createWorld(7) as World & { equipment: Record<string, number> };
    legacy.equipment = {
      polishedCounter: 1,
      alchemistsBench: 0,
      gildedSign: 1,
      paintedSign: 1,
      wovenRug: 1,
      shelfFive: 1,
    };
    delete (legacy as Partial<World>).decorOwned;
    delete (legacy as Partial<World>).decor;

    const text = JSON.stringify({ schemaVersion: 8, savedAt: Date.now(), world: legacy });
    const loaded = save.import(text)!;

    expect(loaded).not.toBeNull();

    // Everything paid for still owns its successor.
    expect(ownsDecor(loaded, 'mortarAndPestle')).toBe(true);
    expect(ownsDecor(loaded, 'goldBanner')).toBe(true);
    expect(ownsDecor(loaded, 'crimsonBanner')).toBe(true);
    // The woven rug became the Iron Pot, which has since gone and been paid back.
    expect(ownsDecor(loaded, 'ironPot')).toBe(false);

    // And the best of each contested spot is out, so nobody logs in to a shop
    // with its fittings switched off.
    expect(placedIn(loaded, 'counter')?.id).toBe('mortarAndPestle');
    expect(placedIn(loaded, 'floor')).toBeNull();
    expect(placedIn(loaded, 'wall')?.id).toBe('goldBanner');

    // The retired equipment entries are gone, so nothing is counted twice.
    expect(loaded.equipment.polishedCounter).toBeUndefined();
    expect(loaded.equipment.gildedSign).toBeUndefined();
    // Real equipment is untouched.
    expect(loaded.equipment.shelfFive).toBe(1);

    // The bonus is applied exactly once: the banner's, with the floor now empty.
    expect(derivedStats(loaded).footfallBonus).toBeCloseTo(
      getDecor('goldBanner').effect.footfallBonus ?? 0,
      5,
    );
  });

  it('gives a save with no décor at all an empty floor rather than a crash', () => {
    const save = new SaveManager(memoryAdapter());
    const legacy = createWorld(7);
    delete (legacy as Partial<World>).decorOwned;
    delete (legacy as Partial<World>).decor;

    const loaded = save.import(
      JSON.stringify({ schemaVersion: 8, savedAt: Date.now(), world: legacy }),
    )!;

    expect(loaded.decor).toBeDefined();
    for (const spot of decorConfig.spots) expect(loaded.decor[spot]).toBeNull();
    expect(derivedStats(loaded).appealBonus).toBe(0);
  });
});

/**
 * Shelf boards.
 *
 * Quality belongs to the shelf rather than the shop, so the mechanic is only
 * real if two shelves in the same shop can differ — and if the difference shows
 * up in what actually sells.
 */
describe('shelf boards', () => {
  const bottled = () => ({
    uid: 'x',
    recipeId: 'aquaTerra',
    grade: 'C' as const,
    purity: 80,
    potencyTier: 'common' as const,
    totalEssence: 57,
    fairValue: 60,
    bottledAt: 0,
  });

  it('starts every shelf on the free salvaged board', () => {
    const world = createWorld(1);
    for (const slot of world.shelf) expect(slot.quality).toBe(baseShelfTier.id);
    expect(baseShelfTier.cost).toBe(0);
    expect(baseShelfTier.appealBonus).toBe(0);
  });

  it('improves as it gets better, and is worth more each step', () => {
    // A tier that costs more must be better, or the ladder has a dead rung.
    for (let i = 1; i < shelfTiers.length; i += 1) {
      expect(shelfTiers[i]!.appealBonus).toBeGreaterThan(shelfTiers[i - 1]!.appealBonus);
      expect(shelfTiers[i]!.cost).toBeGreaterThan(shelfTiers[i - 1]!.cost);
    }
  });

  it('fits a board you own and spends it', () => {
    const world = createWorld(1);
    world.boards.planedBoard = 1;

    expect(fitBoard(world, 'shelf-1', 'planedBoard')).toBe(true);
    expect(world.shelf[0]!.quality).toBe('planedBoard');
    expect(world.boards.planedBoard).toBe(0);

    // And only the shelf it was fitted to.
    expect(world.shelf[1]!.quality).toBe(baseShelfTier.id);
  });

  it('refuses a board you do not own', () => {
    const world = createWorld(1);
    expect(fitBoard(world, 'shelf-1', 'lacqueredShelf')).toBe(false);
    expect(world.shelf[0]!.quality).toBe(baseShelfTier.id);
  });

  it('refuses a downgrade rather than wasting the board', () => {
    const world = createWorld(1);
    world.boards.lacqueredShelf = 1;
    world.boards.roughPine = 1;
    fitBoard(world, 'shelf-1', 'lacqueredShelf');

    // Fitting consumes the board and does not return the old one, so going
    // backwards is pure loss — refused rather than offered as a mistake.
    expect(fitBoard(world, 'shelf-1', 'roughPine')).toBe(false);
    expect(world.shelf[0]!.quality).toBe('lacqueredShelf');
    expect(world.boards.roughPine).toBe(1);
  });

  it('sells better off a better board', () => {
    const world = createWorld(1);
    world.shelf[0]!.item = bottled();
    world.shelf[0]!.quantity = 1;
    world.shelf[1]!.item = { ...bottled(), uid: 'y' };
    world.shelf[1]!.quantity = 1;

    const noon = config.clock.dayLengthMs * 0.4;
    const before = saleChance(world, world.shelf[0]!, noon, true);

    world.boards.lacqueredShelf = 1;
    fitBoard(world, 'shelf-1', 'lacqueredShelf');

    expect(saleChance(world, world.shelf[0]!, noon, true)).toBeGreaterThan(before);
    // The shelf next to it is untouched, which is what makes it a choice.
    expect(saleChance(world, world.shelf[1]!, noon, true)).toBeCloseTo(before, 10);
  });

  it('gives an older save salvaged boards and no free bonus', () => {
    const save = new SaveManager(memoryAdapter());
    const legacy = createWorld(3);
    for (const slot of legacy.shelf) delete (slot as Partial<typeof slot>).quality;
    delete (legacy as Partial<World>).boards;

    const loaded = save.import(
      JSON.stringify({ schemaVersion: 11, savedAt: Date.now(), world: legacy }),
    )!;

    for (const slot of loaded.shelf) expect(slot.quality).toBe(baseShelfTier.id);
    expect(loaded.boards).toEqual({});
  });

  it('sells every board somebody can buy', () => {
    // A board with no seller is an upgrade nobody can reach — the bug this
    // project keeps re-learning.
    const sold = new Set<string>();
    for (const merchant of merchants) {
      for (const entry of merchant.pool) if (entry.kind === 'board') sold.add(entry.id);
    }
    for (const tier of shelfTiers) {
      if (tier.cost === 0) continue; // the one you start on
      expect(sold.has(tier.id), `no merchant stocks ${tier.id}`).toBe(true);
    }
  });
});
