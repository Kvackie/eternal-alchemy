/**
 * Brewing: ratio, temperature, method.
 *
 * The three-way match is the whole system, so most of these tests hold two of
 * the three right and break the remaining one.
 */

import { describe, expect, it } from 'vitest';
import {
  assessOutcome,
  brewDurationFor,
  clampTemperature,
  degreesOutside,
  driftTemperature,
  nudgeTemperature,
} from '@/sim/brewing';
import { config, getRecipe } from '@/sim/config';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { countOf } from '@/sim/inventory';
import type { EssenceVector } from '@/sim/types';

const TONIC = getRecipe('healthTonic');
const DRAUGHT = getRecipe('emberDraught');

/** Sits exactly on the Health Tonic ratio. */
const tonicBlend: EssenceVector = { ignis: 0, aqua: 36, terra: 18, aer: 0, umbra: 0 };
/** Sits exactly on the Ember Draught ratio. */
const draughtBlend: EssenceVector = { ignis: 45, aqua: 0, terra: 15, aer: 0, umbra: 0 };

const inBand = (r: typeof TONIC) => (r.temperature.min + r.temperature.max) / 2;

describe('the temperature gauge', () => {
  it('clamps to what the pot can physically reach', () => {
    expect(clampTemperature(-500)).toBe(config.brewing.minTemperature);
    expect(clampTemperature(9000)).toBe(config.brewing.maxTemperature);
  });

  it('drifts back toward the room from both directions', () => {
    const ambient = config.brewing.ambientTemperature;
    expect(driftTemperature(200, 1000)).toBeLessThan(200);
    expect(driftTemperature(200, 1000)).toBeGreaterThan(ambient);
    // Nothing in M1 goes below ambient, but the drift must not run away if it does.
    expect(driftTemperature(ambient, 1000)).toBe(ambient);
  });

  it('never drifts past the room', () => {
    expect(driftTemperature(21, 60_000)).toBe(config.brewing.ambientTemperature);
  });

  it('moves one step per tap, in both directions', () => {
    const step = config.brewing.tapStepDegrees;
    expect(nudgeTemperature(100, 'heat')).toBe(100 + step);
    expect(nudgeTemperature(100, 'chill')).toBe(100 - step);
  });

  it('measures how far outside a band it sits', () => {
    expect(degreesOutside(160, TONIC.temperature)).toBe(0);
    expect(degreesOutside(TONIC.temperature.min - 12, TONIC.temperature)).toBe(12);
    expect(degreesOutside(TONIC.temperature.max + 30, TONIC.temperature)).toBe(30);
  });
});

describe('identifying a brew', () => {
  const capacity = 60;

  it('makes nothing from an empty pot', () => {
    const empty: EssenceVector = { ignis: 0, aqua: 0, terra: 0, aer: 0, umbra: 0 };
    expect(assessOutcome({ blend: empty, temperature: 160, method: 'stirred', capacity })).toBeNull();
  });

  it('matches ratio, temperature and method together', () => {
    const outcome = assessOutcome({
      blend: tonicBlend,
      temperature: inBand(TONIC),
      method: 'stirred',
      capacity,
    })!;
    expect(outcome.recipeId).toBe('healthTonic');
    expect(outcome.isFallback).toBe(false);
    /*
     * A perfect ratio inside the recipe's own essence window scores full marks.
     *
     * This used to top out at A, because potency capped the grade — a guard
     * against direction-only matching handing an S to a single ingredient that
     * could not miss its own ratio. A recipe that names an essence window has
     * its own skill check, so the cap no longer applies to it and a precisely
     * hit signature can reach S at any size.
     */
    expect(outcome.grade).toBe('S');
  });

  it('will not call a trivial brew a Health Tonic at all', () => {
    /*
     * Size is part of the recipe now, not a modifier applied after it.
     *
     * A perfect ratio in trivial quantity used to be a Health Tonic that merely
     * scored badly, held down by the potency grade cap. The tonic names an
     * essence window instead, so eighteen essence of the right ratio is not a
     * poor tonic — it is not a tonic. That is what "unique recipes need a more
     * exact match" means in practice, and it is a stricter guard than the cap
     * ever was.
     */
    const tiny: EssenceVector = { ignis: 0, aqua: 12, terra: 6, aer: 0, umbra: 0 };
    const big: EssenceVector = { ignis: 0, aqua: 96, terra: 48, aer: 0, umbra: 0 };

    const small = assessOutcome({
      blend: tiny,
      temperature: inBand(TONIC),
      method: 'stirred',
      capacity: 400,
    })!;
    const full = assessOutcome({
      blend: big,
      temperature: inBand(TONIC),
      method: 'stirred',
      capacity: 400,
    })!;

    expect(small.recipeId).not.toBe('healthTonic');
    expect(small.potencyTier).toBe('minor');

    // The full cauldron is the tonic, and a clean ratio earns the top grade.
    expect(full.recipeId).toBe('healthTonic');
    expect(full.grade).toBe('S');
  });

  it('makes Murk with no method chosen, however good the blend', () => {
    const outcome = assessOutcome({
      blend: tonicBlend,
      temperature: inBand(TONIC),
      method: null,
      capacity,
    })!;
    expect(outcome.isFallback).toBe(true);
    expect(outcome.recipeId).toBe('murk');
  });

  it('makes something else on the wrong method — simmering a tonic is a different preparation', () => {
    const outcome = assessOutcome({
      blend: tonicBlend,
      temperature: inBand(TONIC),
      method: 'simmered',
      capacity,
    })!;
    /*
     * Not the tonic. Whether it is Murk depends on whether the generated grid
     * happens to cover this direction under the other method — which is a fact
     * about content, not about the rule. The rule is that method is part of a
     * recipe's identity, and that is what this asserts.
     */
    expect(outcome.recipeId).not.toBe('healthTonic');
  });

  it('still makes the right potion at the wrong temperature, just badly', () => {
    const cold = assessOutcome({
      blend: tonicBlend,
      temperature: TONIC.temperature.min - 40,
      method: 'stirred',
      capacity,
    })!;
    const right = assessOutcome({
      blend: tonicBlend,
      temperature: inBand(TONIC),
      method: 'stirred',
      capacity,
    })!;

    // Temperature is the one of the three that degrades rather than failing.
    expect(cold.recipeId).toBe('healthTonic');
    expect(cold.isFallback).toBe(false);
    expect(cold.purity).toBeLessThan(right.purity);
    expect(cold.degreesOutsideBand).toBe(40);
  });

  it('penalises temperature in proportion to the miss', () => {
    const near = assessOutcome({
      blend: tonicBlend,
      temperature: TONIC.temperature.min - 10,
      method: 'stirred',
      capacity,
    })!;
    const far = assessOutcome({
      blend: tonicBlend,
      temperature: TONIC.temperature.min - 60,
      method: 'stirred',
      capacity,
    })!;
    expect(far.purity).toBeLessThan(near.purity);
  });

  it('keeps the two recipes apart by method and band', () => {
    const draught = assessOutcome({
      blend: draughtBlend,
      temperature: inBand(DRAUGHT),
      method: 'simmered',
      capacity,
    })!;
    expect(draught.recipeId).toBe('emberDraught');

    /*
     * The draught's own blend, stirred, is not the draught.
     *
     * It is no longer Murk either: the generated grid covers plain Ember at
     * every size, so a well-made blend prepared the wrong way now lands on the
     * generic line rather than being thrown away. Method still decides WHICH
     * recipe you made, which is what this test is about.
     */
    const confused = assessOutcome({
      blend: draughtBlend,
      temperature: inBand(TONIC),
      method: 'stirred',
      capacity,
    })!;
    expect(confused.recipeId).not.toBe('emberDraught');
  });

  it('caps an over-capacity brew whatever else is right', () => {
    const huge: EssenceVector = { ignis: 0, aqua: 200, terra: 100, aer: 0, umbra: 0 };
    const outcome = assessOutcome({
      blend: huge,
      temperature: inBand(TONIC),
      method: 'stirred',
      capacity,
    })!;
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
    sim.grant({ ingredient: { id: 'dewcap', count: 6 } });
    sim.addToCauldron('dewcap');
    sim.addToCauldron('dewcap');
    sim.addToCauldron('dewcap');
    return sim;
  }

  it('rejecting returns every ingredient, so experimenting is free', () => {
    const sim = loadedPot();
    const before = countOf(sim.world, 'dewcap');

    sim.nudge('heat');
    sim.setMethod('simmered');
    expect(sim.rejectBrew()).toBe(true);

    expect(countOf(sim.world, 'dewcap')).toBe(before + 3);
    expect(sim.cauldron.contents.units).toHaveLength(0);
    expect(sim.method).toBeNull();
  });

  it('accepting spends the ingredients and starts the timer', () => {
    const sim = loadedPot();
    const before = countOf(sim.world, 'dewcap');
    sim.setMethod('stirred');

    expect(sim.acceptBrew()).toBe(true);
    expect(countOf(sim.world, 'dewcap')).toBe(before);
    expect(sim.cauldron.contents.units).toHaveLength(0);
    expect(sim.brewing).not.toBeNull();
    expect(sim.brewing!.readyAt).toBeGreaterThan(sim.now);
  });

  it('will not accept an empty pot', () => {
    const sim = new Simulation(createWorld(4));
    expect(sim.acceptBrew()).toBe(false);
  });

  it('locks the pot while a brew is running', () => {
    const sim = loadedPot();
    sim.setMethod('stirred');
    sim.acceptBrew();

    expect(sim.addToCauldron('dewcap')).toBe(false);
    expect(sim.rejectBrew()).toBe(false);
    sim.nudge('heat');
    expect(sim.temperature).toBe(config.brewing.ambientTemperature);
  });

  it('delivers the brew to the bench when its time is up', () => {
    const sim = loadedPot();
    sim.setMethod('stirred');
    sim.acceptBrew();
    const readyAt = sim.brewing!.readyAt;

    sim.advanceTo(readyAt - 1);
    expect(sim.pendingBrew).toBeNull();

    sim.advanceTo(readyAt + 1);
    expect(sim.brewing).toBeNull();
    expect(sim.pendingBrew).not.toBeNull();
    expect(sim.pendingBrew!.recipeId).toBe('healthTonic');
  });

  it('finishes a brew that completed while the player was away', () => {
    const sim = loadedPot();
    sim.setMethod('stirred');
    sim.acceptBrew();

    sim.markSeen(Date.now() - 6 * 3_600_000);
    const summary = sim.resume();

    expect(summary.brewReady).toBe(true);
    expect(sim.pendingBrew).not.toBeNull();
  });

  it('holds the temperature steady across an absence rather than cooling it away', () => {
    const sim = loadedPot();
    sim.nudge('heat');
    sim.nudge('heat');
    const held = sim.temperature;

    sim.advanceBy(8 * 3_600_000, false);
    expect(sim.temperature).toBe(held);
  });

  it('drifts the temperature down while the player is present and not heating', () => {
    const sim = loadedPot();
    for (let i = 0; i < 8; i += 1) sim.nudge('heat');
    const hot = sim.temperature;

    sim.advanceBy(5000, true);
    expect(sim.temperature).toBeLessThan(hot);
  });
});
