/**
 * Haggling — rock-paper-scissors against a moving stance.
 *
 * The properties that matter: a counter always forces a stance change (so you
 * cannot mash one button), backfires are thematic and symmetrical, and you never
 * walk away with nothing.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config, customersConfig, getCustomer } from '@/sim/config';
import { ceilingFor, previewPitch } from '@/sim/haggle';
import type { BottledItem, Grade, HaggleStance } from '@/sim/types';

const DAY = config.clock.dayLengthMs;

function bottle(uid: string, recipeId = 'healthTonic', grade: Grade = 'B', sealId = 'cork'): BottledItem {
  return {
    uid,
    recipeId,
    formId: 'potion',
    vesselId: 'clayVial',
    sealId,
    grade,
    purity: 80,
    potencyTier: 'common',
    totalEssence: 57,
    dosesLeft: 1,
    fairValue: 100,
    bottledAt: 0,
  };
}

/** A shop with stock a villager would want, on a day she turns up. */
function shopWithCustomer(): { sim: Simulation; customerId: string } {
  for (let day = 0; day < 40; day += 1) {
    const sim = new Simulation(createWorld(77));
    sim.advanceTo(day * DAY + DAY * 0.4);
    sim.world.bottled.push(bottle('a'), bottle('b'));
    const walkIns = sim.walkIns();
    if (walkIns.length > 0) return { sim, customerId: walkIns[0]!.customerId };
  }
  throw new Error('no customer turned up in 40 days');
}

describe('the pitch triangle', () => {
  it('gives every action exactly one counter and one backfire', () => {
    for (const action of customersConfig.actions) {
      expect(customersConfig.stances).toContain(action.counters);
      expect(customersConfig.stances).toContain(action.backfiresAgainst);
      expect(action.counters).not.toBe(action.backfiresAgainst);
    }
  });

  it('covers every stance with a counter, so no stance is unbeatable', () => {
    const countered = new Set(customersConfig.actions.map((a) => a.counters));
    for (const stance of customersConfig.stances) expect(countered.has(stance)).toBe(true);
  });

  it('reads the matrix the way the design describes it', () => {
    // Proof beats a sceptic and insults a noble.
    expect(previewPitch('sceptical', 'demonstrate')).toBe('counter');
    expect(previewPitch('haughty', 'demonstrate')).toBe('backfire');
    expect(previewPitch('impatient', 'demonstrate')).toBe('neutral');

    // Deference beats a noble and wastes an impatient buyer's time.
    expect(previewPitch('haughty', 'flatter')).toBe('counter');
    expect(previewPitch('impatient', 'flatter')).toBe('backfire');

    // Sweetening beats impatience and reads as desperation to a sceptic.
    expect(previewPitch('impatient', 'sweeten')).toBe('counter');
    expect(previewPitch('sceptical', 'sweeten')).toBe('backfire');
  });
});

describe('a haggle', () => {
  it('starts from the customer’s own budget, give or take today’s purse', () => {
    const { sim, customerId } = shopWithCustomer();
    const def = getCustomer(customerId);
    const session = sim.beginHaggle(customerId, 'a')!;

    // The ceiling varies within the declared spread rather than landing on the
    // nominal figure every time — otherwise a customer's limit is arithmetic
    // the player only has to do once.
    const nominal = ceilingFor(bottle('a'), def);
    const halfSpread = customersConfig.budgetSpread / 2;
    expect(session.ceiling).toBeGreaterThanOrEqual(Math.round(nominal * (1 - halfSpread)));
    expect(session.ceiling).toBeLessThanOrEqual(Math.round(nominal * (1 + halfSpread)));
    expect(session.roundsLeft).toBe(customersConfig.rounds);
  });

  it('offers a different purse on different days', () => {
    // Same customer, same bottle, different day — the ceiling has to move, or
    // the spread is decoration.
    const seen = new Set<number>();
    for (let day = 0; day < 40; day += 1) {
      const { sim, customerId } = shopWithCustomer();
      sim.world.now = day * DAY;
      const session = sim.beginHaggle(customerId, 'a');
      if (session) seen.add(session.ceiling);
      sim.abandonHaggle();
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('refuses an item the customer does not want', () => {
    const { sim, customerId } = shopWithCustomer();
    sim.world.bottled.push(bottle('unwanted', 'shadowPhiltre'));
    // Villagers want tonics, not philtres.
    const def = getCustomer(customerId);
    if (def.wants.includes('shadowPhiltre')) return;
    expect(sim.beginHaggle(customerId, 'unwanted')).toBeNull();
  });

  it('raises the ceiling on a counter and lowers it on a backfire', () => {
    const { sim, customerId } = shopWithCustomer();

    const up = sim.beginHaggle(customerId, 'a')!;
    const counterAction = customersConfig.actions.find((x) => x.counters === up.stance)!;
    const before = up.ceiling;
    sim.pitch(counterAction.id);
    expect(sim.haggle!.ceiling).toBeGreaterThan(before);

    sim.abandonHaggle();

    const down = sim.beginHaggle(customerId, 'b')!;
    const backfire = customersConfig.actions.find((x) => x.backfiresAgainst === down.stance)!;
    const start = down.ceiling;
    sim.pitch(backfire.id);
    expect(sim.haggle!.ceiling).toBeLessThan(start);
  });

  it('forces a stance change on a counter, so one button cannot be mashed', () => {
    const { sim, customerId } = shopWithCustomer();
    const session = sim.beginHaggle(customerId, 'a')!;
    const before: HaggleStance = session.stance;

    const counterAction = customersConfig.actions.find((x) => x.counters === before)!;
    sim.pitch(counterAction.id);

    expect(sim.haggle!.stance).not.toBe(before);
  });

  it('spends a round on every pitch and finishes when they run out', () => {
    const { sim, customerId } = shopWithCustomer();
    sim.beginHaggle(customerId, 'a');

    for (let i = 0; i < customersConfig.rounds; i += 1) {
      expect(sim.haggle!.finished).toBe(false);
      sim.pitch('demonstrate');
    }
    expect(sim.haggle!.finished).toBe(true);
  });

  it('converts interest into price when you hold firm', () => {
    const { sim, customerId } = shopWithCustomer();
    const session = sim.beginHaggle(customerId, 'a')!;

    const counterAction = customersConfig.actions.find((x) => x.counters === session.stance)!;
    sim.pitch(counterAction.id);
    const built = sim.haggle!.ceiling;
    expect(sim.haggle!.interest).toBeGreaterThan(0);

    sim.pitch('holdFirm');
    expect(sim.haggle!.ceiling).toBeGreaterThan(built);
    expect(sim.haggle!.interest).toBe(0);
  });

  it('sells at or under the ceiling, and declines above it', () => {
    const { sim, customerId } = shopWithCustomer();
    const session = sim.beginHaggle(customerId, 'a')!;
    const ceiling = session.ceiling;

    const goldBefore = sim.world.gold;
    const result = sim.closeHaggle(ceiling)!;

    expect(result.sold).toBe(true);
    expect(sim.world.gold).toBe(goldBefore + ceiling);
    expect(sim.world.bottled.some((i) => i.uid === 'a')).toBe(false);
    expect(sim.world.statistics.hagglesWon).toBe(1);
  });

  it('keeps the item when the ask is refused — a failed haggle costs a visit, not stock', () => {
    const { sim, customerId } = shopWithCustomer();
    const session = sim.beginHaggle(customerId, 'a')!;

    const result = sim.closeHaggle(session.ceiling + 1000)!;

    expect(result.sold).toBe(false);
    expect(sim.world.bottled.some((i) => i.uid === 'a')).toBe(true);
    expect(sim.world.gold).toBe(sim.world.gold);
  });

  it('does not bring the same customer straight back after they are served', () => {
    const { sim, customerId } = shopWithCustomer();
    sim.beginHaggle(customerId, 'a');
    sim.closeHaggle(1);

    expect(sim.walkIns().some((w) => w.customerId === customerId)).toBe(false);
  });

  it('survives a reload mid-negotiation', () => {
    const { sim, customerId } = shopWithCustomer();
    sim.beginHaggle(customerId, 'a');
    sim.pitch('demonstrate');
    const stance = sim.haggle!.stance;
    const ceiling = sim.haggle!.ceiling;

    const clone = new Simulation(JSON.parse(JSON.stringify(sim.world)));
    expect(clone.haggle?.stance).toBe(stance);
    expect(clone.haggle?.ceiling).toBe(ceiling);
  });

  it('pays more for a silver-clasped bottle', () => {
    const { sim, customerId } = shopWithCustomer();
    const def = getCustomer(customerId);

    const plain = ceilingFor(bottle('p'), def);
    const clasped = ceilingFor(bottle('c', 'healthTonic', 'B', 'silverClasp'), def);
    expect(clasped).toBeGreaterThan(plain);
  });

  it('only sends the night customer after dark', () => {
    const night = customersConfig.roster.find((c) => c.nightOnly);
    expect(night).toBeDefined();

    const sim = new Simulation(createWorld(5));
    sim.world.renown = 100000;
    sim.advanceTo(DAY * 0.4);
    sim.world.bottled.push(bottle('x', night!.wants[0]!));
    expect(sim.walkIns().some((w) => w.customerId === night!.id)).toBe(false);
  });
});
