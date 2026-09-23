/**
 * Brewing: what a blend comes out as.
 *
 * The ratio and the amount decide it; what goes in is the whole decision.
 */

import { describe, expect, it } from 'vitest';
import { assessOutcome, brewDurationFor } from '@/sim/brewing';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { countOf } from '@/sim/inventory';
import type { EssenceVector } from '@/sim/types';

/** Sits exactly on the Aqua–Terra ratio. */
const aquaTerra: EssenceVector = { ignis: 0, aqua: 27, terra: 27, aer: 0, umbra: 0 };
/** Sits exactly on the Ignis–Terra ratio. */
const ignisTerra: EssenceVector = { ignis: 30, aqua: 0, terra: 30, aer: 0, umbra: 0 };

describe('identifying a brew', () => {
  const capacity = 60;

  it('makes nothing from an empty pot', () => {
    const empty: EssenceVector = { ignis: 0, aqua: 0, terra: 0, aer: 0, umbra: 0 };
    expect(assessOutcome({ blend: empty, capacity })).toBeNull();
  });

  it('matches on the ratio alone, and scores an exact one S', () => {
    const outcome = assessOutcome({ blend: aquaTerra, capacity })!;
    expect(outcome.recipeId).toBe('aquaTerra');
    expect(outcome.grade).toBe('S');
  });

  /*
   * Size is potency, never identity. The same ratio in a thimble and in a
   * sovereign pot is the same potion, and equally pure.
   */
  it('makes the same potion at every size', () => {
    const tiny: EssenceVector = { ignis: 0, aqua: 6, terra: 6, aer: 0, umbra: 0 };
    const big: EssenceVector = { ignis: 0, aqua: 200, terra: 200, aer: 0, umbra: 0 };

    const small = assessOutcome({ blend: tiny, capacity: 400 })!;
    const full = assessOutcome({ blend: big, capacity: 400 })!;

    expect(small.recipeId).toBe('aquaTerra');
    expect(small.potencyTier).toBe('minor');
    expect(small.grade).toBe('S');
    expect(full.recipeId).toBe('aquaTerra');
    expect(full.potencyTier).toBe('sovereign');
    expect(full.grade).toBe('S');
  });

  it('keeps two recipes apart by ratio', () => {
    expect(assessOutcome({ blend: aquaTerra, capacity })!.recipeId).toBe('aquaTerra');
    expect(assessOutcome({ blend: ignisTerra, capacity })!.recipeId).toBe('ignisTerra');
  });

  it('caps an over-capacity brew whatever else is right', () => {
    const huge: EssenceVector = { ignis: 0, aqua: 150, terra: 150, aer: 0, umbra: 0 };
    const outcome = assessOutcome({ blend: huge, capacity })!;
    expect(outcome.overCapacity).toBe(true);
    expect(outcome.grade).toBe('D');
  });
});

describe('brew duration', () => {
  it('scales with potency tier', () => {
    expect(brewDurationFor('minor')).toBeLessThan(brewDurationFor('common'));
    expect(brewDurationFor('common')).toBeLessThan(brewDurationFor('greater'));
    expect(brewDurationFor('grand')).toBeLessThan(brewDurationFor('sovereign'));
  });
});

describe('accepting and rejecting', () => {
  function loadedPot(): Simulation {
    const sim = new Simulation(createWorld(4));
    sim.grant({ ingredient: { id: 'bluecone', count: 6 } });
    sim.addToCauldron('bluecone');
    sim.addToCauldron('bluecone');
    sim.addToCauldron('bluecone');
    return sim;
  }

  it('rejecting returns every ingredient, so experimenting is free', () => {
    const sim = loadedPot();
    const before = countOf(sim.world, 'bluecone');

    expect(sim.rejectBrew()).toBe(true);

    expect(countOf(sim.world, 'bluecone')).toBe(before + 3);
    expect(sim.cauldron.contents.units).toHaveLength(0);
  });

  it('accepting spends the ingredients and starts the timer', () => {
    const sim = loadedPot();
    const before = countOf(sim.world, 'bluecone');

    expect(sim.acceptBrew()).toBe(true);
    expect(countOf(sim.world, 'bluecone')).toBe(before);
    expect(sim.cauldron.contents.units).toHaveLength(0);
    expect(sim.brewing).not.toBeNull();
    expect(sim.brewing!.readyAt).toBeGreaterThan(sim.now);
  });

  it('will not accept an empty pot', () => {
    const sim = new Simulation(createWorld(4));
    expect(sim.acceptBrew()).toBe(false);
  });

  it('will not accept a blend that matches no recipe', () => {
    const sim = new Simulation(createWorld(4));
    sim.grant({ ingredient: { id: 'autumnmaple', count: 2 } });
    sim.addToCauldron('autumnmaple');
    sim.addToCauldron('autumnmaple');

    expect(sim.assess()).toBeNull();
    expect(sim.acceptBrew()).toBe(false);
    expect(sim.cauldron.contents.units).toHaveLength(2);
    // It can still be poured back.
    expect(sim.rejectBrew()).toBe(true);
  });

  it('locks the pot while a brew is running', () => {
    const sim = loadedPot();
    sim.acceptBrew();

    expect(sim.addToCauldron('bluecone')).toBe(false);
    expect(sim.rejectBrew()).toBe(false);
  });

  it('delivers the brew to the bench when its time is up', () => {
    const sim = loadedPot();
    sim.acceptBrew();
    const readyAt = sim.brewing!.readyAt;

    sim.advanceTo(readyAt - 1);
    expect(sim.pendingBrew).toBeNull();

    sim.advanceTo(readyAt + 1);
    expect(sim.brewing).toBeNull();
    expect(sim.pendingBrew).not.toBeNull();
    expect(sim.pendingBrew!.recipeId).toBe('aqua');
  });

  it('finishes a brew that completed while the player was away', () => {
    const sim = loadedPot();
    sim.acceptBrew();

    sim.markSeen(Date.now() - 6 * 3_600_000);
    const summary = sim.resume();

    expect(summary.brewReady).toBe(true);
    expect(sim.pendingBrew).not.toBeNull();
  });
});
