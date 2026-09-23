/**
 * A brand-new world, and the shape every save must deserialise into.
 */

import { baseCauldronTier, caveConfig, config, shaftConfig } from './config';
import { makeCauldron } from './cauldrons';
import { makeCaveTiles } from './cave';
import { emptySpots } from './decor';
import { seedStartingKnowledge } from './discovery';
import { makePlots } from './garden';
import { makeShelf } from './market';
import { generateVeins } from './shaft';
import { freshSeed, Rng } from './rng';
import type { World } from './types';

export function createWorld(seed = freshSeed()): World {
  const world: World = {
    now: 0,
    lastSeenRealTime: Date.now(),
    seed,
    rngSeed: seed,

    gold: config.economy.startingGold,
    renown: config.economy.startingRenown,

    plots: makePlots(config.garden.startingPlots),
    inventory: [],
    seeds: {},
    boosters: {},
    bottledKinds: {},

    // One pot to start. More are bought, not upgraded into.
    cauldrons: [makeCauldron('cauldron-1', baseCauldronTier.id)],
    activeCauldronId: 'cauldron-1',
    nextCauldronId: 2,

    bottled: [],
    shelf: makeShelf(config.shop.startingShelves),

    lastMarketTick: 0,
    unreadSales: [],

    log: [],
    nextLogId: 1,

    equipment: {},
    decorOwned: {},
    decor: emptySpots(),
    boards: {},
    merchantRelations: {},
    merchantVisits: {},
    acknowledgedRank: 0,

    cave: {
      tiles: makeCaveTiles(caveConfig.startingTiles),
      lastTick: 0,
      seed: (seed ^ 0xca7e) >>> 0,
    },
    spores: {},

    shaft: {
      // The shaft opens at the surface; the first beams' worth is free to dig.
      depth: 0,
      supportedDepth: shaftConfig.startingDepth,
      workingVeinIds: [],
      veins: generateVeins(seed, 0, new Rng(seed ^ 0x5eed)),
    },

    heroes: [],
    missions: [],
    pendingClaims: [],
    nextMissionId: 1,

    contracts: [],
    nextContractId: 1,
    factionReputation: {},
    lastContractTick: 0,

    haggle: null,
    servedToday: { dayNumber: -1, customerIds: [] },

    mastery: 0,
    codex: {},
    lifetimeRenown: 0,
    retirements: 0,
    // Mossvale has no modifiers at all, which is what a first run needs: nothing
    // in it is being quietly scaled, so the numbers a new player learns are the
    // real ones. A new game used to open in Saltmarsh — crops fast, ore poor,
    // merchants dear — and taught a shop that never existed anywhere else.
    townId: 'mossvale',

    recipes: {},
    onboardingDismissed: false,

    statistics: {
      itemsSold: 0,
      goldEarned: 0,
      brewsStarted: 0,
      brewsFinished: 0,
      cropsHarvested: 0,
      seedsRecovered: 0,
      fungiHarvested: 0,
      oreExtracted: 0,
      missionsCompleted: 0,
      contractsDelivered: 0,
      contractsFailed: 0,
      hagglesWon: 0,
    },
  };

  // Opening loadout: enough seeds to run the whole loop once without touching
  // a merchant.
  for (const { id, count } of config.economy.startingSeeds) world.seeds[id] = count;

  // A cluster of a starter mushroom, so the cave is usable the moment it opens
  // rather than blocked behind a merchant visit.
  for (const { id, count } of config.economy.startingSpores) world.spores[id] = count;

  // The five single-essence recipes to start; the rest are found by brewing.
  seedStartingKnowledge(world);

  return world;
}
