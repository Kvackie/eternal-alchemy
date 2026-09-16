/**
 * Saving.
 *
 * One versioned JSON blob, rotated across three slots so a corrupt write can't
 * end a forty-hour game. Saves are local-only by design, which makes manual
 * export the player's only backup — so it ships in M1, not later.
 *
 * The storage adapter is swapped for Capacitor Preferences on mobile; nothing
 * above this file knows the difference.
 */

import { baseCauldronTier, baseShelfTier, caveConfig, config, findDecor, realRecipes, shaftConfig } from '@/sim/config';
import { makeCaveTiles } from '@/sim/cave';
import { emptySpots } from '@/sim/decor';
import { rankIndexFor } from '@/sim/progression';
import { Rng } from '@/sim/rng';
import { generateVeins } from '@/sim/shaft';
import type { BrewOutcome, World } from '@/sim/types';

const KEY_PREFIX = 'eternal-alchemy/save';
const KEY_POINTER = 'eternal-alchemy/slot';

export interface SaveEnvelope {
  schemaVersion: number;
  savedAt: number;
  world: World;
}

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Browser default. Every access is guarded: private mode can throw on write. */
export const localStorageAdapter: StorageAdapter = {
  get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* Storage unavailable or full — the game keeps running unsaved. */
    }
  },
  remove(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** In-memory adapter, for tests and for the case where storage is blocked. */
export function memoryAdapter(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  };
}

export class SaveManager {
  constructor(private storage: StorageAdapter = localStorageAdapter) {}

  private slotKey(slot: number): string {
    return `${KEY_PREFIX}/${slot}`;
  }

  private currentSlot(): number {
    const raw = this.storage.get(KEY_POINTER);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** Write to the next slot in rotation, then point at it only once it landed. */
  save(world: World): void {
    const slots = Math.max(1, config.save.slots);
    const next = (this.currentSlot() + 1) % slots;
    const envelope: SaveEnvelope = {
      schemaVersion: config.save.schemaVersion,
      savedAt: Date.now(),
      world,
    };
    this.storage.set(this.slotKey(next), JSON.stringify(envelope));
    this.storage.set(KEY_POINTER, String(next));
  }

  /**
   * Load the newest readable save.
   *
   * Slots are tried newest-first by their own timestamp rather than by the
   * pointer, so a half-written slot simply loses to an older intact one.
   */
  load(): World | null {
    const slots = Math.max(1, config.save.slots);
    const candidates: SaveEnvelope[] = [];

    for (let slot = 0; slot < slots; slot += 1) {
      const raw = this.storage.get(this.slotKey(slot));
      if (!raw) continue;
      const parsed = this.parse(raw);
      if (parsed) candidates.push(parsed);
    }

    candidates.sort((a, b) => b.savedAt - a.savedAt);
    return candidates[0]?.world ?? null;
  }

  private parse(raw: string): SaveEnvelope | null {
    try {
      const envelope = JSON.parse(raw) as SaveEnvelope;
      if (typeof envelope?.schemaVersion !== 'number' || !envelope.world) return null;
      const world = migrate(envelope.world, envelope.schemaVersion);
      return world ? { ...envelope, world } : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    for (let slot = 0; slot < config.save.slots; slot += 1) {
      this.storage.remove(this.slotKey(slot));
    }
    this.storage.remove(KEY_POINTER);
  }

  /** Text the player can keep. Local-only saves make this the only real backup. */
  export(world: World): string {
    return JSON.stringify(
      { schemaVersion: config.save.schemaVersion, savedAt: Date.now(), world },
      null,
      2,
    );
  }

  import(text: string): World | null {
    const parsed = this.parse(text);
    return parsed?.world ?? null;
  }
}

/**
 * Migration chain.
 *
 * Each step upgrades a save by exactly one version. Steps run in order and must
 * be additive — a save written by an older build has to survive, and a save from
 * a *newer* build is refused outright rather than loaded half-understood.
 */
type Migration = (world: World) => World;

const MIGRATIONS: Record<number, Migration> = {
  /**
   * v1 → v2: the alembic's radius axis became relative to cauldron capacity.
   *
   * Superseded by v3, which removes the alembic entirely — but the step stays,
   * because a chain that skips a version is a chain with a hole in it. It now
   * only has to leave the save in a shape v3 can read.
   */
  2: (world) => {
    const legacy = world as unknown as { alembic?: unknown; distilling?: unknown };
    legacy.alembic = null;
    legacy.distilling = null;
    return world;
  },

  /**
   * v2 → v3: the alembic wheel was replaced by temperature and method.
   *
   * A v2 save has no temperature, no method, no log, and counts brews under a
   * statistic that no longer exists. Nothing here can be reconstructed from the
   * old shape, so the step fills defaults and — importantly — hands any brew
   * that was waiting to be bottled straight through, since that is finished work
   * the player already earned.
   */
  3: (world) => {
    const legacy = world as unknown as {
      pendingBrew?: (BrewOutcome & { distilledPurity?: number }) | null;
      statistics?: Record<string, number>;
      temperature?: number;
      method?: unknown;
      brewing?: unknown;
    };

    /*
     * Cast, because these fields no longer exist on World.
     *
     * v13 moved them into the cauldron list. A migration works on the shape of
     * the version it is upgrading FROM, not on today's — so this step still has
     * to write the flat fields, and v13 is what folds them into a pot.
     */
    legacy.temperature ??= config.brewing.ambientTemperature;
    legacy.method ??= null;
    legacy.brewing ??= null;
    world.log ??= [];
    world.nextLogId ??= 1;

    // A v2 pendingBrew predates temperature, so give it the band it would have
    // wanted — it was graded without one, and re-penalising it now would be
    // taking back work that was already done.
    if (legacy.pendingBrew) {
      legacy.pendingBrew.temperature ??= config.brewing.ambientTemperature;
      legacy.pendingBrew.degreesOutsideBand ??= 0;
      legacy.pendingBrew.method ??= null;
    }

    const stats = legacy.statistics ?? {};
    world.statistics = {
      ...emptyStatistics(),
      itemsSold: stats.itemsSold ?? 0,
      goldEarned: stats.goldEarned ?? 0,
      brewsStarted: stats.brewsStarted ?? stats.brewsDistilled ?? 0,
      brewsFinished: stats.brewsFinished ?? stats.brewsDistilled ?? 0,
      cropsHarvested: stats.cropsHarvested ?? 0,
      seedsRecovered: stats.seedsRecovered ?? 0,
    };

    delete (world as unknown as Record<string, unknown>).alembic;
    delete (world as unknown as Record<string, unknown>).distilling;
    delete (world as unknown as Record<string, unknown>).alembicTier;
    delete (world as unknown as Record<string, unknown>).alembicModules;

    return world;
  },

  /**
   * v3 → v4: merchants, renown ranks and bought equipment.
   *
   * An existing shop keeps everything it has earned and simply starts with no
   * equipment and no merchant standing. `acknowledgedRank` is seeded from the
   * rank the player's renown already entitles them to, so loading an old save
   * doesn't fire a burst of promotions they were never told about because the
   * system didn't exist yet.
   */
  4: (world) => {
    world.equipment ??= {};
    world.merchantRelations ??= {};
    world.merchantVisits ??= {};
    world.acknowledgedRank ??= rankIndexFor(world.renown ?? 0);
    return world;
  },

  /**
   * v4 → v5: the cave, the shaft, heroes and the contract board.
   *
   * An existing shop gains all four in their opening state. The shaft's veins
   * are generated from the world's own seed, so the same save always digs into
   * the same rock — reloading must not reshuffle the ground under a player who
   * was halfway through working a seam.
   */
  5: (world) => {
    const seed = world.rngSeed ?? 1;

    world.cave ??= { tiles: makeCaveTiles(caveConfig.startingTiles), lastTick: world.now ?? 0 };
    world.spores ??= { dewcap: 2 };

    world.shaft ??= {
      depth: shaftConfig.startingDepth,
      supportedDepth: shaftConfig.startingDepth,
      workingVeinId: null,
      veins: generateVeins(seed, shaftConfig.startingDepth, new Rng(seed ^ 0x5eed)),
    };

    world.heroes ??= [];
    world.missions ??= [];
    world.nextMissionId ??= 1;

    world.contracts ??= [];
    world.nextContractId ??= 1;
    world.factionReputation ??= {};
    world.lastContractTick ??= world.now ?? 0;

    world.statistics = { ...emptyStatistics(), ...(world.statistics ?? {}) };
    return world;
  },

  /**
   * v5 → v6: haggling, crossbreeding and prestige.
   *
   * `lifetimeRenown` seeds from current renown rather than zero — a shop that
   * earned its reputation before the Codex existed should not have that erased
   * the first time it retires.
   */
  6: (world) => {
    world.haggle ??= null;
    world.servedToday ??= { dayNumber: -1, customerIds: [] };
    world.strains ??= [];
    world.nextStrainId ??= 1;
    world.mastery ??= 0;
    world.codex ??= {};
    world.lifetimeRenown ??= world.renown ?? 0;
    world.retirements ??= 0;
    // A save from before towns existed was played with no modifiers at all,
    // because an unknown id resolves to an empty effect set. Mossvale is that
    // same shop written down; 'saltmarsh' silently handed it three modifiers it
    // had never been played under.
    world.townId ??= 'mossvale';
    world.statistics = { ...emptyStatistics(), ...(world.statistics ?? {}) };
    return world;
  },

  /**
   * v6 → v7: recipe discovery, standing orders, the opening checklist.
   *
   * An existing shop keeps every recipe it was already brewing — with its
   * temperature band already known. Retroactively hiding what a player has been
   * making for hours would be taking something away, not adding a system.
   */
  7: (world) => {
    world.standingOrders ??= [];
    world.onboardingDismissed ??= true;

    if (!world.recipes) {
      world.recipes = {};
      for (const recipe of realRecipes()) {
        world.recipes[recipe.id] = {
          discovered: true,
          coldestKnownTooCold: null,
          hottestKnownTooHot: null,
          bandKnown: true,
          timesBrewed: 0,
        };
      }
    }
    return world;
  },

  /**
   * v7 → v8: shelf slots can hold a stack.
   *
   * Anything already on a shelf is a single bottle, so it becomes a stack of
   * one. Nothing is added or taken away.
   */
  8: (world) => {
    for (const slot of world.shelf ?? []) {
      slot.quantity ??= slot.item ? 1 : 0;
    }
    return world;
  },

  /**
   * v8 → v9: seven shop upgrades became placeable décor.
   *
   * They were bought as equipment and worked the moment they were owned; they
   * are now furnishings that only work while they are out, and there are fewer
   * spots than pieces. A player who already owns them keeps every one, and the
   * best of each spot is placed for them — nobody should log in to find the
   * fittings they paid for switched off and a puzzle where their shop was.
   *
   * Their equipment entries are dropped, since `derivedStats` would otherwise
   * count a rug both as equipment and as décor.
   */
  9: (world) => {
    world.decorOwned ??= {};
    world.decor ??= emptySpots();

    /*
     * The seven shop upgrades were later replaced outright when painted art
     * arrived and the furnishing set was rebuilt around what the art actually
     * is. Their ids no longer exist, so each maps to the piece that took its
     * place — a player who paid for a rug gets the thing that is now on the
     * floor, rather than an empty spot and a missing purchase.
     */
    const REPLACED: Record<string, string> = {
      polishedCounter: 'mortarAndPestle',
      wovenRug: 'ironPot',
      displayCase: 'pottedFern',
      incenseBurner: 'skullChalice',
      gildedSign: 'goldBanner',
      paintedSign: 'crimsonBanner',
      lanternDisplay: 'sproutingUrn',
    };

    for (const [oldId, newId] of Object.entries(REPLACED)) {
      if ((world.equipment?.[oldId] ?? 0) <= 0) continue;
      delete world.equipment[oldId];
      const piece = findDecor(newId);
      if (!piece) continue;
      world.decorOwned[newId] = 1;

      // Best-of-spot wins, measured by what it cost — which is the game's own
      // ordering of how good a piece is.
      const current = world.decor[piece.spot];
      const currentCost = current ? (findDecor(current)?.cost ?? 0) : -1;
      if (piece.cost > currentCost) world.decor[piece.spot] = newId;
    }

    // And anything bought as décor that has since left the data file goes too,
    // so a retired piece cannot sit in a spot doing nothing.
    for (const spot of Object.keys(world.decor)) {
      const id = world.decor[spot];
      if (id && !findDecor(id)) world.decor[spot] = null;
    }

    return world;
  },

  /**
   * v9 → v10: a visit's purchases are keyed by item id, not by list position.
   *
   * The old positional key re-mapped onto whatever now sits at that index the
   * moment a merchant's pool was edited, so adding décor to Bramm's stock marked
   * a polished counter nobody had bought as sold out. The record is per-visit
   * and rebuilds on the next visit day, so dropping it costs nothing.
   */
  10: (world) => {
    world.merchantVisits = {};
    return world;
  },

  /**
   * v10 → v11: painted art arrived, and the furnishing set was rebuilt around it.
   *
   * The ten placeholder pieces were replaced by nineteen that have pictures, so
   * a shop furnished under the old ids has to be re-furnished under the new
   * ones. v9 already does this mapping for saves coming from v8; this repeats it
   * for saves that passed through v9 and v10 with décor already bought.
   */
  11: (world) => {
    const REPLACED: Record<string, string> = {
      polishedCounter: 'mortarAndPestle',
      alchemistsBench: 'goldGoblet',
      curioCabinet: 'cutDiamond',
      wovenRug: 'ironPot',
      mosaicFloor: 'coinStack',
      displayCase: 'pottedFern',
      incenseBurner: 'skullChalice',
      gildedSign: 'goldBanner',
      paintedSign: 'crimsonBanner',
      lanternDisplay: 'sproutingUrn',
    };

    world.decorOwned ??= {};
    world.decor ??= emptySpots();

    for (const [oldId, newId] of Object.entries(REPLACED)) {
      if ((world.decorOwned[oldId] ?? 0) <= 0) continue;
      delete world.decorOwned[oldId];
      if (findDecor(newId)) world.decorOwned[newId] = 1;
    }

    for (const spot of Object.keys(world.decor)) {
      const id = world.decor[spot];
      if (!id) continue;
      const successor = REPLACED[id];
      world.decor[spot] = successor && findDecor(successor) ? successor : findDecor(id) ? id : null;
    }

    return world;
  },

  /**
   * v11 → v12: shelves are made of something.
   *
   * Every existing shelf becomes a salvaged board, which is the free tier and
   * carries no bonus — so an old shop is exactly as good as it was, and better
   * boards are something to go and buy rather than something it silently gained.
   */
  12: (world) => {
    world.boards ??= {};
    for (const slot of world.shelf ?? []) {
      slot.quality ??= baseShelfTier.id;
    }
    return world;
  },

  /**
   * v12 → v13: one cauldron becomes a list of them.
   *
   * The five loose fields that were the cauldron — contents, temperature,
   * method, the brew counting down and the one waiting to be bottled — move
   * wholesale into a single starter pot, so a save mid-brew comes back mid-brew
   * at the same heat with the same method chosen. Losing that would mean taking
   * back a brew someone had already committed ingredients to.
   *
   * The old capacity upgrades are gone from equipment, since capacity now
   * belongs to the pot. Anyone who bought one is handed the equivalent cauldron
   * instead rather than quietly losing what they paid for.
   */
  13: (world) => {
    const legacy = world as unknown as {
      cauldron?: { units: unknown[] };
      temperature?: number;
      method?: unknown;
      brewing?: unknown;
      pendingBrew?: unknown;
      equipment?: Record<string, number>;
    };

    const owned = legacy.equipment ?? {};
    const tierFromEquipment =
      owned.cauldronOneEighty ? 'cauldronThree' : owned.cauldronHundred ? 'cauldronTwo' : baseCauldronTier.id;

    world.cauldrons = [
      {
        id: 'cauldron-1',
        tierId: tierFromEquipment,
        contents: (legacy.cauldron as World['cauldrons'][number]['contents']) ?? { units: [] },
        temperature: legacy.temperature ?? config.brewing.ambientTemperature,
        method: (legacy.method as World['cauldrons'][number]['method']) ?? null,
        brewing: (legacy.brewing as World['cauldrons'][number]['brewing']) ?? null,
        pendingBrew: (legacy.pendingBrew as World['cauldrons'][number]['pendingBrew']) ?? null,
        // The one pot a save this old had was the one it was brewing in.
        stored: false,
      },
    ];
    world.activeCauldronId = 'cauldron-1';
    world.nextCauldronId = 2;

    // The upgrades were spent on the pot; leaving them owned would double-count.
    delete owned.cauldronHundred;
    delete owned.cauldronOneEighty;

    delete legacy.cauldron;
    delete legacy.temperature;
    delete legacy.method;
    delete legacy.brewing;
    delete legacy.pendingBrew;
    return world;
  },
};

/** Every counter at zero, so a migration can fill only what it actually knows. */
function emptyStatistics(): World['statistics'] {
  return {
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
  };
}

function migrate(world: World, fromVersion: number): World | null {
  if (fromVersion > config.save.schemaVersion) return null;

  let current = world;
  for (let version = fromVersion + 1; version <= config.save.schemaVersion; version += 1) {
    const step = MIGRATIONS[version];
    if (step) current = step(current);
  }

  // Fills for fields added without a version bump, where absence is unambiguous.
  current.unreadSales ??= [];
  current.log ??= [];
  current.nextLogId ??= 1;
  current.decorOwned ??= {};
  current.decor ??= emptySpots();
  current.boards ??= {};
  // A save from before parties waited to be greeted simply has none waiting.
  current.pendingClaims ??= [];
  // Every pot in a save from before storage existed was, by definition, out.
  for (const pot of current.cauldrons ?? []) pot.stored ??= false;

  return current;
}
