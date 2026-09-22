/**
 * Recipe discovery, learning a band by hand, standing orders, and the checklist.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config, getRecipe, realRecipes } from '@/sim/config';
import { bandHint, isDiscovered, knowledgeFor } from '@/sim/discovery';
import { onboardingSteps, onboardingComplete } from '@/sim/onboarding';
import { SaveManager, memoryAdapter } from '@/platform/save';
import type { BrewMethod } from '@/sim/types';

const HOUR = 3_600_000;
const DAY = config.clock.dayLengthMs;

/** Load the pot with something that makes a Wind Draught, at a chosen heat. */
function windPot(temperature: number, seed = 5): Simulation {
  const sim = new Simulation(createWorld(seed));
  sim.grant({ ingredient: { id: 'galeThistle', count: 4 } });
  sim.addToCauldron('galeThistle', 'dewfresh');
  sim.addToCauldron('galeThistle', 'dewfresh');
  sim.cauldron.temperature = temperature;
  sim.setMethod('stirred');
  return sim;
}

describe('what a new shop knows', () => {
  it('starts with only the starter recipes in the book', () => {
    const sim = new Simulation(createWorld(1));
    const known = sim.knownRecipes().map((r) => r.id);

    expect(known).toContain('healthTonic');
    expect(known).toContain('emberDraught');
    expect(known.length).toBeLessThan(realRecipes().length);
    expect(isDiscovered(sim.world, 'windDraught')).toBe(false);
  });

  it('prints the band for a recipe it starts knowing', () => {
    const sim = new Simulation(createWorld(1));
    const hint = bandHint(sim.world, 'healthTonic');
    expect(hint.known).toBe(true);
    expect(hint.min).toBe(getRecipe('healthTonic').temperature.min);
  });
});

describe('discovering a recipe', () => {
  it('happens by accepting a brew that matches it, even at the wrong heat', () => {
    const sim = windPot(280);
    expect(isDiscovered(sim.world, 'windDraught')).toBe(false);

    expect(sim.acceptBrew()).toBe(true);
    expect(isDiscovered(sim.world, 'windDraught')).toBe(true);
    expect(sim.world.log.some((e) => e.kind === 'recipeFound')).toBe(true);
  });

  it('does not happen from rejecting — trying stays free', () => {
    // If a rejected pot leaked the answer, rejecting would be strictly better
    // than committing, and accepting would never be worth doing.
    const sim = windPot(280);
    sim.rejectBrew();
    expect(isDiscovered(sim.world, 'windDraught')).toBe(false);
  });

  it('adds it to the book without giving away the temperature', () => {
    const sim = windPot(280);
    sim.acceptBrew();

    const hint = bandHint(sim.world, 'windDraught');
    expect(hint.known).toBe(false);
    expect(hint.min).toBeNull();
    // 280 was above the band, so that is now a known upper bound.
    expect(hint.upperBound).toBe(280);
  });
});

describe('narrowing a band by hand', () => {
  it('records a bound from each side, keeping the tightest', () => {
    const band = getRecipe('windDraught').temperature;

    const sim = windPot(band.min - 40);
    sim.acceptBrew();
    expect(bandHint(sim.world, 'windDraught').lowerBound).toBe(band.min - 40);

    // A closer cold attempt should tighten the bound, not loosen it.
    const closer = windPot(band.min - 5, 6);
    closer.world.recipes = sim.world.recipes;
    closer.acceptBrew();
    expect(bandHint(closer.world, 'windDraught').lowerBound).toBe(band.min - 5);

    // A worse cold attempt must not undo what was learned.
    const worse = windPot(band.min - 60, 7);
    worse.world.recipes = closer.world.recipes;
    worse.acceptBrew();
    expect(bandHint(worse.world, 'windDraught').lowerBound).toBe(band.min - 5);
  });

  it('closes the gap from both sides into a range', () => {
    const band = getRecipe('windDraught').temperature;

    const cold = windPot(band.min - 30);
    cold.acceptBrew();
    const hot = windPot(band.max + 30, 9);
    hot.world.recipes = cold.world.recipes;
    hot.acceptBrew();

    const hint = bandHint(hot.world, 'windDraught');
    expect(hint.known).toBe(false);
    expect(hint.lowerBound).toBe(band.min - 30);
    expect(hint.upperBound).toBe(band.max + 30);
  });

  it('is settled for good the first time the band is hit', () => {
    const band = getRecipe('windDraught').temperature;
    const sim = windPot((band.min + band.max) / 2);

    sim.acceptBrew();
    const hint = bandHint(sim.world, 'windDraught');
    expect(hint.known).toBe(true);
    expect(hint.min).toBe(band.min);
    expect(sim.world.log.some((e) => e.kind === 'bandLearned')).toBe(true);
  });

  it('never offers another recipe’s band as this one’s target', () => {
    // The gauge once marked the first known recipe that shared a method, which
    // showed the Health Tonic's range while a Wind Draught was in the pot.
    const sim = windPot(216);
    const outcome = sim.assess()!;
    expect(outcome.recipeId).toBe('windDraught');

    // Wind Draught is undiscovered, so there is no honest band to show at all.
    expect(sim.bandHint(outcome.recipeId).known).toBe(false);
    // And the Health Tonic's band must not be what gets consulted.
    expect(sim.bandHint('healthTonic').min).not.toBe(getRecipe('windDraught').temperature.min);
  });

  it('reports only a direction while the band is still unknown', () => {
    const band = getRecipe('windDraught').temperature;
    const cold = windPot(band.min - 30);
    expect(cold.temperatureVerdict('windDraught')).toBe('tooCold');

    const hot = windPot(band.max + 30);
    expect(hot.temperatureVerdict('windDraught')).toBe('tooHot');

    const right = windPot((band.min + band.max) / 2);
    expect(right.temperatureVerdict('windDraught')).toBe('inRange');
  });

  it('widens the band a steady hand has to hit', () => {
    const band = getRecipe('windDraught').temperature;
    const steady = windPot(band.max + 6);
    steady.world.codex.deftHands = 1;
    // 8 degrees of slack per tier puts +6 back inside.
    expect(steady.temperatureVerdict('windDraught')).toBe('inRange');
  });
});

describe('the opening checklist', () => {
  it('starts with everything undone and nothing dismissed', () => {
    const sim = new Simulation(createWorld(1));
    expect(sim.onboarding.visible).toBe(true);
    expect(sim.onboarding.steps.every((s) => !s.done)).toBe(true);
    expect(sim.onboarding.current?.id).toBe('plant');
  });

  it('ticks steps off as the world changes, in any order', () => {
    const sim = new Simulation(createWorld(1));
    // Do something from the middle of the list first.
    sim.grant({ ingredient: { id: 'dewcap', count: 2 } });
    sim.addToCauldron('dewcap', 'dewfresh');

    const steps = onboardingSteps(sim.world);
    expect(steps.find((s) => s.id === 'fill')!.done).toBe(true);
    expect(steps.find((s) => s.id === 'plant')!.done).toBe(false);
  });

  it('does not un-tick a step when what it watched is spent', () => {
    const sim = new Simulation(createWorld(1));
    const plot = sim.world.plots[0]!;
    sim.plant(plot.id, 'dewcap');
    sim.advanceBy(HOUR);
    sim.harvest(plot.id);

    // The crop is gone, but "you have harvested" stays true.
    expect(onboardingSteps(sim.world).find((s) => s.id === 'harvest')!.done).toBe(true);
  });

  it('completes and hides itself once a full loop has been closed', () => {
    const sim = new Simulation(createWorld(1));
    sim.world.statistics.cropsHarvested = 3;
    sim.world.statistics.brewsStarted = 1;
    sim.world.statistics.itemsSold = 1;
    sim.cauldron.method = 'stirred' as BrewMethod;
    sim.world.plots[0]!.crop = null;

    expect(onboardingComplete(sim.world)).toBe(true);
    expect(sim.onboarding.visible).toBe(false);
  });

  it('can be dismissed early and stays dismissed', () => {
    const sim = new Simulation(createWorld(1));
    sim.dismissOnboarding();
    expect(sim.onboarding.visible).toBe(false);

    const reloaded = new Simulation(JSON.parse(JSON.stringify(sim.world)));
    expect(reloaded.onboarding.visible).toBe(false);
  });
});

describe('an existing shop upgraded into discovery', () => {
  it('keeps every recipe it was already brewing, band and all', () => {
    // Retroactively hiding what someone has been making for hours would be
    // taking a thing away, not adding a system.
    const world = createWorld(1) as unknown as Record<string, unknown>;
    delete world.recipes;
    delete world.standingOrders;
    delete world.onboardingDismissed;

    const raw = JSON.stringify({ schemaVersion: 6, savedAt: Date.now(), world });
    const migrated = new SaveManager(memoryAdapter()).import(raw)!;

    expect(migrated).not.toBeNull();
    for (const recipe of realRecipes()) {
      expect(knowledgeFor(migrated, recipe.id).discovered).toBe(true);
      expect(knowledgeFor(migrated, recipe.id).bandKnown).toBe(true);
    }
    // An established shop should not be handed a beginner's checklist.
    expect(migrated.onboardingDismissed).toBe(true);
  });
});
