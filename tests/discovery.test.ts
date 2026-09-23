/**
 * Recipe discovery and the opening checklist.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { recipes } from '@/sim/config';
import { isDiscovered, knowledgeFor } from '@/sim/discovery';
import { onboardingSteps, onboardingComplete } from '@/sim/onboarding';
import { SaveManager, memoryAdapter } from '@/platform/save';

const HOUR = 3_600_000;

/** Load the pot with something that makes the Aqua–Terra potion. */
function aquaTerraPot(seed = 5): Simulation {
  const sim = new Simulation(createWorld(seed));
  sim.grant({ ingredient: { id: 'bilberry', count: 2 } });
  sim.grant({ ingredient: { id: 'broadleaf', count: 2 } });
  sim.addToCauldron('bilberry', 'dewfresh');
  sim.addToCauldron('broadleaf', 'dewfresh');
  return sim;
}

describe('what a new shop knows', () => {
  it('starts with the five single-essence potions and nothing else', () => {
    const sim = new Simulation(createWorld(1));
    const known = sim.knownRecipes().map((r) => r.id);

    expect(known.sort()).toEqual(['aer', 'aqua', 'ignis', 'terra', 'umbra']);
    expect(sim.unknownRecipes()).toHaveLength(recipes.length - 5);
    expect(isDiscovered(sim.world, 'aquaTerra')).toBe(false);
  });
});

describe('discovering a recipe', () => {
  it('happens by accepting a brew that matches it', () => {
    const sim = aquaTerraPot();
    expect(isDiscovered(sim.world, 'aquaTerra')).toBe(false);

    expect(sim.acceptBrew()).toBe(true);
    expect(isDiscovered(sim.world, 'aquaTerra')).toBe(true);
    expect(sim.world.log.some((e) => e.kind === 'recipeFound')).toBe(true);
  });

  it('does not happen from rejecting — trying stays free', () => {
    // If a rejected pot leaked the answer, rejecting would be strictly better
    // than committing, and accepting would never be worth doing.
    const sim = aquaTerraPot();
    sim.rejectBrew();
    expect(isDiscovered(sim.world, 'aquaTerra')).toBe(false);
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
    sim.plant(plot.id, 'bluepetal');
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
  it('keeps every recipe it was already brewing', () => {
    // Retroactively hiding what someone has been making for hours would be
    // taking a thing away, not adding a system.
    const world = createWorld(1) as unknown as Record<string, unknown>;
    delete world.recipes;
    delete world.standingOrders;
    delete world.onboardingDismissed;

    const raw = JSON.stringify({ schemaVersion: 6, savedAt: Date.now(), world });
    const migrated = new SaveManager(memoryAdapter()).import(raw)!;

    expect(migrated).not.toBeNull();
    for (const recipe of recipes) {
      expect(knowledgeFor(migrated, recipe.id).discovered).toBe(true);
    }
    // An established shop should not be handed a beginner's checklist.
    expect(migrated.onboardingDismissed).toBe(true);
  });
});
