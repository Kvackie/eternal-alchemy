/**
 * Throwaway harness for judging cauldron art.
 *
 *   TIER=cauldronOne  — five pots of that tier, one per brew effect
 *   TIER=all          — one pot of every tier, all brewing
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { cauldronTiers, config, getRecipe, ingredients, vessels } from '@/sim/config';
import { addVectors, angleBetween, zeroVector } from '@/sim/essences';
import { makeCauldron } from '@/sim/cauldrons';
import type { EssenceVector } from '@/sim/types';

const OUT = process.env.ALLPOTS_OUT;
const TIER = process.env.TIER || 'cauldronOne';

/** One recipe per essence, so all five effects appear. */
const BY_ESSENCE = ['ignis', 'aqua', 'terra', 'aer', 'umbra'];

function blendFor(target: EssenceVector, cap: number): string[] {
  const chosen: string[] = [];
  let sum = zeroVector();
  let best = Infinity;
  for (let s = 0; s < cap; s += 1) {
    let pick: string | null = null;
    let pickSum = sum;
    for (const ing of ingredients) {
      const trial = addVectors(sum, ing.essence);
      const a = angleBetween(trial, target);
      if (a < best - 1e-9) {
        best = a;
        pick = ing.id;
        pickSum = trial;
      }
    }
    if (!pick) break;
    chosen.push(pick);
    sum = pickSum;
  }
  return chosen;
}

describe('cauldron art harness', () => {
  // A tool, not a test: it only runs when asked for an output path.
  it.skipIf(!OUT)('writes a save', () => {
    const world = createWorld(404);
    world.gold = 500_000;
    world.renown = 300_000;
    world.onboardingDismissed = true;
    for (const v of vessels) world.vessels[v.id] = 99;

    // One of every tier, or five of one tier.
    const tiers =
      TIER === 'all' ? cauldronTiers.map((t) => t.id) : BY_ESSENCE.map(() => TIER);

    world.cauldrons = tiers.map((id, i) => makeCauldron(`cauldron-${i + 1}`, id));
    world.activeCauldronId = 'cauldron-1';
    world.nextCauldronId = tiers.length + 1;

    const sim = new Simulation(world);
    sim.cauldrons.forEach((pot, i) => {
      const recipe = getRecipe(BY_ESSENCE[i % BY_ESSENCE.length]!);
      for (const id of blendFor(recipe.target, 3)) {
        sim.grant({ ingredient: { id, count: 2 } });
        sim.addToCauldron(id, undefined, pot.id);
        sim.addToCauldron(id, undefined, pot.id);
      }
      sim.acceptBrew(pot.id);
    });

    sim.advanceBy(1000, false);

    writeFileSync(
      OUT!,
      JSON.stringify({ schemaVersion: config.save.schemaVersion, savedAt: Date.now() + 60000, world: sim.world }),
      'utf8',
    );
    // eslint-disable-next-line no-console
    console.log(
      sim.cauldrons
        .map((p) => `${p.tierId}=${p.brewing?.outcome.recipeId}`)
        .join('  '),
    );
  });
});
