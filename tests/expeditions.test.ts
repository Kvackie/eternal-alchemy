/**
 * Heroes and contracts — the two systems that give your own potions somewhere
 * to go besides the shelf.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import {
  config,
  contractsConfig,
  getHeroDef,
  getRecipe,
  heroesConfig,
  recipes,
} from '@/sim/config';
import { effectiveLevel, favourBandOf, isInjured, recruitCostOf } from '@/sim/heroes';
import { contractTerms, generateContract, qualifyingItems } from '@/sim/contracts';
import { isDiscovered } from '@/sim/discovery';
import { angleBetween } from '@/sim/essences';
import { Rng } from '@/sim/rng';
import type { BottledItem, Grade } from '@/sim/types';

const HOUR = 3_600_000;
const DAY = config.clock.dayLengthMs;

function bottle(uid: string, grade: Grade, recipeId = 'aquaTerra'): BottledItem {
  return {
    uid,
    recipeId,
    grade,
    purity: 80,
    potencyTier: 'common',
    totalEssence: 57,
    fairValue: 30,
    bottledAt: 0,
  };
}

function withHero(seed = 5): Simulation {
  const sim = new Simulation(createWorld(seed));
  sim.world.gold = 100000;
  sim.recruitHero('corin');
  return sim;
}

/**
 * Greet everyone who has come home.
 *
 * A returned party holds its haul until it is claimed, so nothing lands in
 * stores and no hero is freed on the tick alone — the tests have to do what a
 * player does.
 */
function claimAll(sim: Simulation): void {
  for (const outcome of [...sim.pendingClaims]) sim.claimMission(outcome.missionId);
}

describe('recruiting', () => {
  it('costs gold and fills a roster slot', () => {
    const sim = new Simulation(createWorld(1));
    sim.world.gold = recruitCostOf('corin');

    expect(sim.recruitHero('corin')).toBe(true);
    expect(sim.world.gold).toBe(0);
    expect(sim.world.heroes).toHaveLength(1);
  });

  // A veteran is not the same bargain as a hopeful.
  it('prices a hero by their level', () => {
    const perLevel = heroesConfig.recruitCostPerLevel;
    expect(recruitCostOf('corin')).toBe(perLevel * getHeroDef('corin').baseLevel);

    const levels = heroesConfig.roster.map((def) => def.baseLevel);
    const cheapest = heroesConfig.roster[levels.indexOf(Math.min(...levels))]!;
    const dearest = heroesConfig.roster[levels.indexOf(Math.max(...levels))]!;
    expect(recruitCostOf(dearest.id)).toBeGreaterThan(recruitCostOf(cheapest.id));
  });

  it('refuses without the gold', () => {
    const sim = new Simulation(createWorld(1));
    sim.world.gold = 0;
    expect(sim.recruitHero('corin')).toBe(false);
  });

  it('respects the roster limit until slots are bought', () => {
    const sim = withHero();
    expect(sim.heroSlots).toBe(heroesConfig.startingSlots);
    expect(sim.recruitHero('ilse')).toBe(false);

    sim.world.equipment.heroSlotTwo = 1;
    expect(sim.recruitHero('ilse')).toBe(true);
  });

  it('will not recruit the same person twice', () => {
    const sim = withHero();
    expect(sim.recruitHero('corin')).toBe(false);
  });
});

describe('favour', () => {
  it('bands by threshold and adds effective levels', () => {
    expect(favourBandOf(0).id).toBe('wary');
    expect(favourBandOf(50).id).toBe('warm');
    expect(favourBandOf(95).id).toBe('sworn');

    const hero = { id: 'corin', level: 2, favour: 95, injuredUntil: null, onMission: false, missionsCompleted: 0 };
    expect(effectiveLevel(hero)).toBe(2 + favourBandOf(95).levelBonus);
  });

  it('rises on a successful return', () => {
    const sim = withHero();
    const before = sim.world.heroes[0]!.favour;

    sim.send('emberwaste', ['corin'], []);
    sim.advanceBy(6 * HOUR);
    claimAll(sim);

    expect(sim.world.heroes[0]!.favour).toBeGreaterThan(before);
  });

  it('rises further when the party was supplied', () => {
    const bare = withHero(7);
    const packed = withHero(7);
    packed.world.bottled.push(bottle('a', 'B'), bottle('b', 'B'));

    bare.send('emberwaste', ['corin'], []);
    packed.send('emberwaste', ['corin'], ['a', 'b']);
    bare.advanceBy(6 * HOUR);
    packed.advanceBy(6 * HOUR);
    claimAll(bare);
    claimAll(packed);

    expect(packed.world.heroes[0]!.favour).toBeGreaterThan(bare.world.heroes[0]!.favour);
  });

  it('still climbs for a player who never supplies, just slowly', () => {
    // Keeping a hero's regard must not require spending potions on them — that
    // would be a toll, not a relationship. Unsupplied returns earn less, never less
    // than nothing.
    const sim = withHero(12);
    for (let i = 0; i < 6; i += 1) {
      sim.send('emberwaste', ['corin'], []);
      sim.advanceBy(6 * HOUR);
      claimAll(sim);
    }
    expect(sim.world.heroes[0]!.favour).toBeGreaterThan(0);
  });

  it('never falls below its floor, however badly it goes', () => {
    const sim = withHero();
    sim.world.heroes[0]!.favour = 0;
    for (let i = 0; i < 20; i += 1) {
      sim.send('emberwaste', ['corin'], []);
      sim.advanceBy(6 * HOUR);
    }
    expect(sim.world.heroes[0]!.favour).toBeGreaterThanOrEqual(0);
  });
});

describe('missions', () => {
  it('improve the odds when supplied with better potions', () => {
    const sim = withHero();
    sim.world.bottled.push(bottle('poor', 'F'), bottle('great', 'S'));

    const bare = sim.estimate('emberwaste', ['corin'], []);
    const good = sim.estimate('emberwaste', ['corin'], ['great']);

    expect(good.success).toBeGreaterThan(bare.success);
    expect(good.injury).toBeLessThan(bare.injury);
    expect(good.rareFind).toBeGreaterThan(bare.rareFind);
  });

  it('spend the supplies when the party leaves', () => {
    const sim = withHero();
    sim.world.bottled.push(bottle('a', 'B'));

    expect(sim.send('emberwaste', ['corin'], ['a'])).toBe(true);
    expect(sim.world.bottled).toHaveLength(0);
  });

  /*
   * The cap is on the party, not on the shop.
   *
   * This went missing once, in the belief that a roster of 45 should be able to
   * walk out as one — the rule is that 45 heroes is fifteen parties, not one
   * party of 45.
   */
  it('take three at most, however many are on the roster', () => {
    const sim = new Simulation(createWorld(3));
    sim.world.gold = 100000;
    sim.world.equipment.heroSlotTwo = 44;
    const ids = heroesConfig.roster.slice(0, 4).map((def) => def.id);
    for (const id of ids) expect(sim.recruitHero(id)).toBe(true);

    expect(sim.send('emberwaste', ids, [])).toBe(false);
    expect(sim.send('emberwaste', ids.slice(0, heroesConfig.partySize), [])).toBe(true);
  });

  it('run as many expeditions at once as there are heroes to fill them', () => {
    const sim = new Simulation(createWorld(4));
    sim.world.gold = 100000;
    sim.world.equipment.heroSlotTwo = 44;
    const ids = heroesConfig.roster.slice(0, 6).map((def) => def.id);
    for (const id of ids) sim.recruitHero(id);

    // Six heroes, six solo expeditions, all out at the same time.
    for (const id of ids) expect(sim.send('emberwaste', [id], [])).toBe(true);
    expect(sim.world.missions).toHaveLength(6);
  });

  it('will not send a hero who is already out', () => {
    const sim = withHero();
    sim.send('emberwaste', ['corin'], []);
    expect(sim.send('mirefen', ['corin'], [])).toBe(false);
  });

  it('will not send a hero who is hurt', () => {
    const sim = withHero();
    sim.world.heroes[0]!.injuredUntil = sim.now + HOUR;
    expect(sim.send('emberwaste', ['corin'], [])).toBe(false);
  });

  it('always bring something back — a bad roll is meagre, not empty-handed', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const sim = withHero(seed);
      sim.send('emberwaste', ['corin'], []);
      sim.advanceBy(6 * HOUR);

      // The haul exists the moment they are due, and moves on the claim.
      expect(sim.pendingClaims[0]!.found.length).toBeGreaterThan(0);
      expect(sim.world.inventory).toHaveLength(0);
      claimAll(sim);

      const carried = sim.world.inventory.reduce((sum, stack) => sum + stack.count, 0);
      expect(carried).toBeGreaterThan(0);
    }
  });

  it('return the hero to the roster once the party is greeted, hurt or not', () => {
    const sim = withHero();
    sim.send('emberwaste', ['corin'], []);
    sim.advanceBy(6 * HOUR);

    // Home, but still standing in the doorway: the mission is over and the
    // hero is not free again until the haul is taken off them.
    expect(sim.world.missions).toHaveLength(0);
    expect(sim.pendingClaims).toHaveLength(1);
    expect(sim.world.heroes[0]!.onMission).toBe(true);

    claimAll(sim);
    expect(sim.world.heroes[0]!.onMission).toBe(false);
    expect(sim.world.statistics.missionsCompleted).toBe(1);
  });

  // The guard against a double tap paying twice.
  it('cannot be claimed a second time', () => {
    const sim = withHero();
    sim.send('emberwaste', ['corin'], []);
    sim.advanceBy(6 * HOUR);

    const missionId = sim.pendingClaims[0]!.missionId;
    expect(sim.claimMission(missionId)).not.toBeNull();
    expect(sim.claimMission(missionId)).toBeNull();

    const carried = sim.world.inventory.reduce((sum, stack) => sum + stack.count, 0);
    claimAll(sim);
    expect(sim.world.inventory.reduce((sum, stack) => sum + stack.count, 0)).toBe(carried);
  });

  it('finish while the player is away', () => {
    const sim = withHero();
    sim.send('emberwaste', ['corin'], []);
    sim.markSeen(Date.now() - 8 * HOUR);
    sim.resume();

    expect(sim.world.missions).toHaveLength(0);
  });

  it('can be healed with a tonic instead of waiting it out', () => {
    const sim = withHero();
    sim.world.heroes[0]!.injuredUntil = sim.now + 5 * HOUR;
    sim.world.bottled.push(bottle('tonic', 'B', 'aquaTerra'));
    const favourBefore = sim.world.heroes[0]!.favour;

    expect(sim.heal('corin', 'tonic')).toBe(true);
    expect(isInjured(sim.world.heroes[0]!, sim.now)).toBe(false);
    expect(sim.world.heroes[0]!.favour).toBeGreaterThan(favourBefore);
    expect(sim.world.bottled).toHaveLength(0);
  });

  it('will not heal with the wrong potion', () => {
    const sim = withHero();
    sim.world.heroes[0]!.injuredUntil = sim.now + 5 * HOUR;
    sim.world.bottled.push(bottle('wrong', 'B', 'ignisTerra'));
    expect(sim.heal('corin', 'wrong')).toBe(false);
  });
});

describe('the contract board', () => {
  function withBoard(seed = 11): Simulation {
    const sim = new Simulation(createWorld(seed));
    sim.advanceBy(1000);
    return sim;
  }

  it('posts contracts up to the board size', () => {
    const sim = withBoard();
    expect(sim.world.contracts).toHaveLength(contractsConfig.boardSize);
  });

  it('never shows the same order twice at once', () => {
    // Near the same is allowed; the same faction, potion, grade and count is
    // one order shown twice. Checked across enough fresh boards and reposts
    // that a repeat would have turned up.
    for (let seed = 1; seed <= 60; seed += 1) {
      const sim = withBoard(seed);
      for (let round = 0; round < 6; round += 1) {
        const keys = sim.world.contracts.map((contract) => {
          const terms = contractTerms(contract);
          return [
            terms.faction,
            terms.recipeId,
            terms.minGrade,
            contract.quantity,
          ].join('|');
        });
        expect(new Set(keys).size).toBe(keys.length);
        sim.world.contracts.splice(0, 1);
        sim.advanceBy(1000);
      }
    }
  });

  it('only offers contracts the current rank has unlocked', () => {
    const sim = withBoard();
    for (const contract of sim.world.contracts) {
      /*
       * Two kinds of contract, one invariant: nothing on the board may be
       * beyond the shop. A template gate is its own requiresRank; a commission
       * is gated by the faction that placed it.
       */
      if (contract.templateId) {
        const template = contractsConfig.templates.find((t) => t.id === contract.templateId)!;
        expect(template.requiresRank).toBe(0);
      } else {
        const faction = contractsConfig.factions.find(
          (f) => f.id === contractTerms(contract).faction,
        )!;
        expect(faction.requiresRank).toBe(0);
      }
    }
  });

  it('commissions recipes the player has actually discovered', () => {
    const sim = withBoard();
    const derived = sim.world.contracts.filter((contract) => !contract.templateId);
    for (const contract of derived) {
      expect(
        isDiscovered(sim.world, contractTerms(contract).recipeId),
        'a commission for an unknown recipe is a taunt, not a goal',
      ).toBe(true);
    }
  });

  it('commissions only what the placing faction would actually drink', () => {
    // Walk a shop up to a full book, so every faction has something to choose.
    const sim = withBoard(5);
    for (const recipe of recipes) {
      sim.world.recipes[recipe.id] = { discovered: true, timesBrewed: 1 };
    }
    sim.world.renown = 100000;
    sim.world.contracts = [];
    sim.advanceBy(1000);

    for (let i = 0; i < 200; i += 1) {
      const contract = generateContract(sim.world, new Rng(i + 1), i, 60_000);
      if (!contract?.terms) continue;
      const faction = contractsConfig.factions.find((f) => f.id === contract.terms!.faction)!;
      const off =
        (angleBetween(getRecipe(contract.terms.recipeId).target, faction.palate) * 180) / Math.PI;
      expect(
        off,
        `${faction.id} commissioned ${contract.terms.recipeId} at ${off.toFixed(0)}deg`,
      ).toBeLessThan(faction.spreadDeg);
    }
  });

  it('counts only bottles that actually meet the terms', () => {
    const sim = withBoard();
    const contract = sim.world.contracts.find((c) => c.templateId === 'barrackTonics');
    if (!contract) return;

    sim.world.bottled.push(bottle('good', 'B', 'aquaTerra'));
    sim.world.bottled.push(bottle('lowGrade', 'F', 'aquaTerra'));
    sim.world.bottled.push(bottle('wrongRecipe', 'S', 'ignisTerra'));

    const qualifying = qualifyingItems(sim.world, contract);
    expect(qualifying.map((i) => i.uid)).toEqual(['good']);
  });

  it('pays out and clears when fully delivered', () => {
    const sim = withBoard();
    const contract = sim.world.contracts.find((c) => c.templateId === 'barrackTonics');
    if (!contract) return;

    for (let i = 0; i < contract.quantity; i += 1) {
      sim.world.bottled.push(bottle(`t${i}`, 'B', 'aquaTerra'));
    }

    const goldBefore = sim.world.gold;
    const result = sim.deliverContract(contract.id)!;

    expect(result.complete).toBe(true);
    expect(sim.world.gold).toBeGreaterThan(goldBefore);
    expect(sim.world.contracts.find((c) => c.id === contract.id)).toBeUndefined();
    expect(sim.world.statistics.contractsDelivered).toBe(1);
  });

  it('pays pro rata on a partial delivery, and keeps the contract open', () => {
    const sim = withBoard();
    const contract = sim.world.contracts.find(
      (c) => c.templateId === 'barrackTonics' && c.quantity >= 3,
    );
    if (!contract) return;

    sim.world.bottled.push(bottle('one', 'B', 'aquaTerra'));
    const result = sim.deliverContract(contract.id)!;

    expect(result.complete).toBe(false);
    expect(result.gold).toBeGreaterThan(0);
    expect(result.gold).toBeLessThan(contract.payout);
    // A partial delivery costs no reputation — a bad week should disappoint, not punish.
    expect(sim.world.statistics.contractsFailed).toBe(0);
    expect(sim.world.contracts.some((c) => c.id === contract.id)).toBe(true);
  });

  it('spends the worst qualifying bottles first when there is a surplus', () => {
    const sim = withBoard();
    const contract = sim.world.contracts.find((c) => c.templateId === 'barrackTonics');
    if (!contract) return;

    // One more qualifying bottle than the contract wants, so there is a genuine
    // choice about which to spend.
    sim.world.bottled.push(bottle('prize', 'S', 'aquaTerra'));
    for (let i = 0; i < contract.quantity; i += 1) {
      sim.world.bottled.push(bottle(`plain-${i}`, 'C', 'aquaTerra'));
    }

    const result = sim.deliverContract(contract.id)!;
    expect(result.complete).toBe(true);

    // A contract asking for grade C should never quietly consume an S.
    expect(sim.world.bottled.map((item) => item.uid)).toEqual(['prize']);
  });

  it('runs deadlines down only while the player is present', () => {
    const sim = withBoard();
    const contract = sim.world.contracts[0]!;
    const before = contract.msRemaining;

    sim.advanceBy(2 * DAY, false);
    expect(sim.world.contracts[0]!.msRemaining).toBe(before);

    sim.advanceBy(HOUR, true);
    expect(sim.world.contracts[0]!.msRemaining).toBeLessThan(before);
  });

  it('expires a contract whose time genuinely ran out, and reposts the board', () => {
    const sim = withBoard();
    const id = sim.world.contracts[0]!.id;
    sim.world.contracts[0]!.msRemaining = 500;

    sim.advanceBy(2000, true);

    expect(sim.world.contracts.some((c) => c.id === id)).toBe(false);
    expect(sim.world.statistics.contractsFailed).toBe(1);
    expect(sim.world.contracts).toHaveLength(contractsConfig.boardSize);
  });

  it('abandoning costs reputation but frees the slot', () => {
    const sim = withBoard();
    const contract = sim.world.contracts[0]!;

    expect(sim.abandonContract(contract.id)).toBe(true);
    expect(sim.world.statistics.contractsFailed).toBe(1);
  });
});
