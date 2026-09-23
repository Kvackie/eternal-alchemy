/**
 * Putting stock out, and rearranging it once it is out.
 *
 * Both operations exist because doing them one bottle and one shelf at a time
 * was the slowest part of running the shop. The rules they have to keep are
 * the boring ones — nothing is duplicated, nothing is lost, and a count offered
 * to the player is a count that can actually be honoured.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import type { BottledItem, Grade } from '@/sim/types';

/** A shop with `shelves` shelves and a pile of bottles in the store room. */
function shopWith(
  bottles: Array<Partial<BottledItem> & { count: number }>,
  shelves = 4,
): Simulation {
  const sim = new Simulation(createWorld(7));

  while (sim.world.shelf.length < shelves) {
    sim.world.shelf.push({
      id: `shelf-${sim.world.shelf.length + 1}`,
      item: null,
      quantity: 0,
      quality: 'salvagedBoard',
      priceRatio: 1,
    });
  }
  sim.world.shelf.length = shelves;

  sim.world.bottled = [];
  let n = 0;
  for (const spec of bottles) {
    for (let i = 0; i < spec.count; i += 1) {
      sim.world.bottled.push({
        uid: `b${n++}`,
        recipeId: spec.recipeId ?? 'aquaTerra',
        grade: (spec.grade ?? 'C') as Grade,
        purity: 70,
        potencyTier: 'common',
        totalEssence: 16,
        fairValue: 50,
        bottledAt: 0,
      });
    }
  }
  return sim;
}

const onShelves = (sim: Simulation) =>
  sim.world.shelf.reduce((total, slot) => total + (slot.item ? slot.quantity : 0), 0);

describe('putting several out at once', () => {
  it('fills one shelf per bottle', () => {
    const sim = shopWith([{ count: 6 }]);
    const uid = sim.world.bottled[0]!.uid;

    expect(sim.stockMany(uid, 3)).toBe(3);
    expect(sim.world.shelf.filter((slot) => slot.item)).toHaveLength(3);
    expect(sim.world.bottled).toHaveLength(3);
  });

  it('stops at the shelf room there is, and says how many went out', () => {
    const sim = shopWith([{ count: 10 }], 4);
    const uid = sim.world.bottled[0]!.uid;

    // Asked for ten, four shelves: four go out, and the answer is four.
    expect(sim.stockMany(uid, 10)).toBe(4);
    expect(onShelves(sim)).toBe(4);
    expect(sim.world.bottled).toHaveLength(6);
  });

  it('never loses or duplicates a bottle', () => {
    const sim = shopWith([{ count: 9 }]);
    const uid = sim.world.bottled[0]!.uid;

    sim.stockMany(uid, 4);
    expect(onShelves(sim) + sim.world.bottled.length).toBe(9);

    const uids = new Set([
      ...sim.world.bottled.map((item) => item.uid),
      ...sim.world.shelf.flatMap((slot) => (slot.item ? [slot.item.uid] : [])),
    ]);
    expect(uids.size).toBe(sim.world.bottled.length + sim.world.shelf.filter((s) => s.item).length);
  });

  it('only ever puts out bottles that match the one asked for', () => {
    const sim = shopWith([
      { count: 2, recipeId: 'aquaTerra', grade: 'A' },
      { count: 5, recipeId: 'ignisTerra', grade: 'C' },
    ]);
    const ember = sim.world.bottled.find((item) => item.recipeId === 'ignisTerra')!;

    expect(sim.stockMany(ember.uid, 4)).toBe(4);
    for (const slot of sim.world.shelf) {
      if (slot.item) expect(slot.item.recipeId).toBe('ignisTerra');
    }
    expect(sim.world.bottled.filter((item) => item.recipeId === 'aquaTerra')).toHaveLength(2);
  });
});

describe('how many could go out', () => {
  it('is bounded by the stock', () => {
    const sim = shopWith([{ count: 2 }], 6);
    expect(sim.placeable(sim.world.bottled[0]!)).toBe(2);
  });

  it('is bounded by the empty shelves', () => {
    const sim = shopWith([{ count: 9 }], 3);
    expect(sim.placeable(sim.world.bottled[0]!)).toBe(3);
  });

  it('is what stockMany can actually deliver', () => {
    const sim = shopWith([{ count: 20 }], 5);
    const item = sim.world.bottled[0]!;
    const offered = sim.placeable(item);
    expect(sim.stockMany(item.uid, offered)).toBe(offered);
  });

  it('is zero when every shelf is taken', () => {
    const sim = shopWith([{ count: 6 }], 2);
    sim.stockMany(sim.world.bottled[0]!.uid, 2);
    expect(sim.placeable(sim.world.bottled[0]!)).toBe(0);
  });
});

describe('rearranging the floor', () => {
  it('swaps two full shelves, goods and asking price together', () => {
    const sim = shopWith(
      [
        { count: 1, recipeId: 'aquaTerra' },
        { count: 1, recipeId: 'ignisTerra' },
      ],
      2,
    );
    sim.stock('shelf-1', sim.world.bottled.find((i) => i.recipeId === 'aquaTerra')!.uid);
    sim.stock('shelf-2', sim.world.bottled.find((i) => i.recipeId === 'ignisTerra')!.uid);
    sim.setPrice('shelf-1', 1.6);
    sim.setPrice('shelf-2', 0.8);

    expect(sim.moveStock('shelf-1', 'shelf-2')).toBe(true);
    expect(sim.world.shelf[0]!.item?.recipeId).toBe('ignisTerra');
    expect(sim.world.shelf[1]!.item?.recipeId).toBe('aquaTerra');
    expect(sim.world.shelf[0]!.priceRatio).toBeCloseTo(0.8);
    expect(sim.world.shelf[1]!.priceRatio).toBeCloseTo(1.6);
  });

  it('leaves the board where it was fitted', () => {
    const sim = shopWith([{ count: 1 }], 2);
    sim.world.shelf[0]!.quality = 'lacqueredShelf';
    sim.stock('shelf-1', sim.world.bottled[0]!.uid);

    sim.moveStock('shelf-1', 'shelf-2');
    expect(sim.world.shelf[0]!.quality).toBe('lacqueredShelf');
    expect(sim.world.shelf[1]!.quality).toBe('salvagedBoard');
  });

  it('moves onto an empty shelf and leaves the old one empty', () => {
    const sim = shopWith([{ count: 1 }], 2);
    sim.stock('shelf-1', sim.world.bottled[0]!.uid);

    expect(sim.moveStock('shelf-1', 'shelf-2')).toBe(true);
    expect(sim.world.shelf[0]!.item).toBeNull();
    expect(sim.world.shelf[0]!.quantity).toBe(0);
    expect(sim.world.shelf[1]!.item).not.toBeNull();
  });

  it('refuses a move from an empty shelf, or onto itself', () => {
    const sim = shopWith([{ count: 1 }], 2);
    sim.stock('shelf-1', sim.world.bottled[0]!.uid);

    expect(sim.moveStock('shelf-2', 'shelf-1')).toBe(false);
    expect(sim.moveStock('shelf-1', 'shelf-1')).toBe(false);
    expect(sim.moveStock('shelf-1', 'nowhere')).toBe(false);
    expect(sim.world.shelf[0]!.item).not.toBeNull();
  });
});

describe('the count a caller already has', () => {
  it('agrees with counting the bottles again', () => {
    const sim = shopWith(
      [
        { count: 7, recipeId: 'aquaTerra' },
        { count: 3, recipeId: 'ignisTerra' },
      ],
      6,
    );

    for (const item of sim.world.bottled) {
      const counted = sim.world.bottled.filter(
        (entry) =>
          entry.recipeId === item.recipeId &&
          entry.grade === item.grade &&
          entry.potencyTier === item.potencyTier,
      ).length;
      expect(sim.placeable(item, counted)).toBe(sim.placeable(item));
    }
  });

  it('still honours the shelf room when handed a count', () => {
    const sim = shopWith([{ count: 20 }], 3);
    expect(sim.placeable(sim.world.bottled[0]!, 20)).toBe(3);
  });
});
