/**
 * The opening checklist.
 *
 * A new player lands on eight screens, a five-essence system and a three-part
 * recipe. This is the shortest thing that gets them through one full loop
 * without a tutorial that takes the controls away.
 *
 * Every step is checked by observing the world, not by intercepting an action —
 * so a player who does things out of order, or already did them before opening
 * the list, is never told to do something they have done. It dismisses itself
 * once the loop is closed, and can be dismissed early.
 */

import { isReady } from './garden';
import type { World } from './types';

export interface OnboardingStep {
  id: string;
  done: boolean;
  /** The screen this step happens on, so the list can point at it. */
  screen: string;
}

/**
 * Steps in the order a first session naturally hits them.
 *
 * Each predicate is a *lasting* fact about the world where possible — "you have
 * harvested at least once" rather than "there is something in your bag" — so a
 * step cannot un-tick itself when the player spends what it was watching.
 */
export function onboardingSteps(world: World): OnboardingStep[] {
  const stats = world.statistics;
  const planted = world.plots.some((plot) => plot.crop !== null);
  const somethingReady = world.plots.some((plot) => isReady(plot, world.now));

  return [
    {
      id: 'plant',
      screen: 'grounds',
      done: planted || stats.cropsHarvested > 0,
    },
    {
      id: 'harvest',
      screen: 'grounds',
      // Ready-and-unpicked counts as "you got here", so the hint can change.
      done: stats.cropsHarvested > 0 || somethingReady,
    },
    {
      id: 'fill',
      screen: 'cauldron',
      // Any pot counts: the lesson is "put something in a cauldron", not "put
      // something in the first one".
      done: world.cauldrons.some((pot) => pot.contents.units.length > 0) || stats.brewsStarted > 0,
    },
    {
      id: 'brew',
      screen: 'cauldron',
      done: stats.brewsStarted > 0,
    },
    {
      id: 'bottle',
      screen: 'cauldron',
      done: world.bottled.length > 0 || stats.itemsSold > 0 || world.shelf.some((s) => s.item),
    },
    {
      id: 'stock',
      screen: 'shop',
      done: world.shelf.some((slot) => slot.item !== null) || stats.itemsSold > 0,
    },
    {
      id: 'sell',
      screen: 'shop',
      done: stats.itemsSold > 0,
    },
  ];
}

export function onboardingComplete(world: World): boolean {
  return onboardingSteps(world).every((step) => step.done);
}

/**
 * What the checklist shows: whether it is up, every step, and the first one
 * still outstanding — the step it should be pointing at.
 *
 * One pass over the steps for all three, since each step's predicate walks the
 * plots and the shelves and the getter behind it is read on every render.
 */
export function onboardingView(world: World): {
  visible: boolean;
  steps: OnboardingStep[];
  current: OnboardingStep | null;
} {
  const steps = onboardingSteps(world);
  const current = steps.find((step) => !step.done) ?? null;
  return { visible: !world.onboardingDismissed && current !== null, steps, current };
}

export function dismissOnboarding(world: World): void {
  world.onboardingDismissed = true;
}
