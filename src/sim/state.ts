/**
 * A brand-new world, and the shape every save must deserialise into.
 */

import { baseCauldronTier, caveConfig, config, crops, shaftConfig, vessels, seals } from './config';
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
    rngSeed: seed,

    gold: config.economy.startingGold,
    renown: config.economy.startingRenown,

    plots: makePlots(config.garden.startingPlots),
    inventory: [],
    seeds: {},
    vessels: {},
    seals: {},

    // One pot to start. More are bought, not upgraded into.
    cauldrons: [
      makeCauldron('cauldron-1', baseCauldronTier.id, config.brewing.ambientTemperature),
    ],
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

    cave: { tiles: makeCaveTiles(caveConfig.startingTiles), lastTick: 0 },
    spores: {},

    shaft: {
      depth: shaftConfig.startingDepth,
      supportedDepth: shaftConfig.startingDepth,
      workingVeinId: null,
      veins: generateVeins(seed, shaftConfig.startingDepth, new Rng(seed ^ 0x5eed)),
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

    strains: [],
    nextStrainId: 1,

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
      strainsBred: 0,
    },
  };

  // Opening loadout: enough seeds and vessels to run the whole loop once without
  // touching a merchant, since merchants don't exist until M2.
  for (const crop of crops) {
    world.seeds[crop.id] = 4;
  }
  for (const vessel of vessels) {
    world.vessels[vessel.id] = vessel.startingStock;
  }
  for (const seal of seals) {
    world.seals[seal.id] = seal.cost === 0 ? 0 : 5;
  }

  // One cluster of the starter mushroom, so the cave is usable the moment it
  // opens rather than blocked behind a merchant visit.
  world.spores.dewcap = 2;

  // Two recipes to start; the rest are found by brewing them.
  seedStartingKnowledge(world);

  return world;
}
