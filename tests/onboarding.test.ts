/**
 * The opening checklist, walked the way a new player would walk it.
 *
 * Its seven steps tick themselves off by reading the world, which means any
 * change to how the world records an action can quietly orphan one — a step
 * that can no longer be completed is a checklist that never finishes and a
 * first session that never stops being told what to do next. This is the whole
 * loop, in order, asserting that each step lands when the act that earns it
 * happens and not before.
 */

import { describe, expect, it } from 'vitest';
import { has } from '@/i18n';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';

const HOUR = 3_600_000;

function ticked(sim: Simulation): string[] {
  return sim.onboarding.steps.filter((step) => step.done).map((step) => step.id);
}

describe('the opening checklist', () => {
  it('can be completed by playing one loop, a step at a time', () => {
    const sim = new Simulation(createWorld(2024));
    expect(ticked(sim)).toEqual([]);
    expect(sim.onboarding.visible).toBe(true);

    const plot = sim.world.plots[0]!;
    sim.plant(plot.id, 'dewcap');
    expect(ticked(sim)).toEqual(['plant']);

    sim.advanceBy(HOUR);
    sim.harvest(plot.id);
    expect(ticked(sim)).toEqual(['plant', 'harvest']);

    while (sim.addToCauldron('dewcap')) {
      if (sim.cauldron.contents.units.length >= 3) break;
    }
    expect(ticked(sim)).toContain('fill');
    expect(ticked(sim)).not.toContain('brew');

    sim.acceptBrew();
    expect(ticked(sim)).toContain('brew');
    expect(ticked(sim)).not.toContain('bottle');

    sim.advanceBy(HOUR);
    const item = sim.bottlePending({ formId: 'potion', vesselId: 'clayVial', sealId: 'cork' });
    expect(item).not.toBeNull();
    expect(ticked(sim)).toContain('bottle');
    expect(ticked(sim)).not.toContain('stock');

    expect(sim.stockMany(item!.uid, 1)).toBe(1);
    expect(ticked(sim)).toContain('stock');
    expect(ticked(sim)).not.toContain('sell');

    // Someone comes in and buys it, which is the one step the player waits for.
    sim.advanceBy(HOUR * 24);
    expect(sim.world.statistics.itemsSold).toBeGreaterThan(0);
    expect(ticked(sim)).toHaveLength(7);
    expect(sim.onboarding.visible).toBe(false);
  });

  it('points at the first thing still undone', () => {
    const sim = new Simulation(createWorld(2024));
    expect(sim.onboarding.current?.id).toBe('plant');

    sim.plant(sim.world.plots[0]!.id, 'dewcap');
    expect(sim.onboarding.current?.id).toBe('harvest');
  });

  it('every step names a screen that exists and a line that is translated', () => {
    const sim = new Simulation(createWorld(1));
    const screens = ['shop', 'board', 'market', 'grounds', 'cauldron', 'roster', 'ledger', 'settings'];

    for (const step of sim.onboarding.steps) {
      expect(screens, `${step.id} points at ${step.screen}`).toContain(step.screen);
      // `t()` renders an unknown key as itself, so a missing line is invisible
      // in the UI and only catchable here.
      expect(has(`onboarding.step.${step.id}`), `${step.id} has no wording`).toBe(true);
    }
  });
});
