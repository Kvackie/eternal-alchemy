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

import { baseCauldronTier, baseShelfTier, caveConfig, config, findDecor, recipes, shaftConfig } from '@/sim/config';
import { makeCaveTiles } from '@/sim/cave';
import { emptySpots } from '@/sim/decor';
import { rankIndexFor } from '@/sim/progression';
import { Rng } from '@/sim/rng';
import { generateVeins } from '@/sim/shaft';
import { fairValue } from '@/sim/market';
import type { BottledItem, World } from '@/sim/types';
import { LEGACY_INGREDIENTS, LEGACY_SEEDS, LEGACY_SPORES } from './legacyIngredients';
import { LEGACY_RECIPES } from './legacyRecipes';

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

/**
 * The room temperature, as it stood while pots had one.
 *
 * Steps v3 and v13 write a temperature because the saves they upgrade had one;
 * v14 is what removes it. The value is only ever an intermediate.
 */
const LEGACY_AMBIENT = 20;

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
      pendingBrew?: (Record<string, unknown> & { distilledPurity?: number }) | null;
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
    legacy.temperature ??= LEGACY_AMBIENT;
    legacy.method ??= null;
    legacy.brewing ??= null;
    world.log ??= [];
    world.nextLogId ??= 1;

    // A v2 pendingBrew predates temperature, so give it the band it would have
    // wanted — it was graded without one, and re-penalising it now would be
    // taking back work that was already done.
    if (legacy.pendingBrew) {
      legacy.pendingBrew.temperature ??= LEGACY_AMBIENT;
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

    world.cave ??= {
      tiles: makeCaveTiles(caveConfig.startingTiles),
      lastTick: world.now ?? 0,
      seed: world.rngSeed ?? 1,
    };
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
   * v5 → v6: haggling, crossbreeding and prestige. (Crossbreeding is gone
   * again since v15, which is why nothing here fills its fields.)
   *
   * `lifetimeRenown` seeds from current renown rather than zero — a shop that
   * earned its reputation before the Codex existed should not have that erased
   * the first time it retires.
   */
  6: (world) => {
    world.haggle ??= null;
    world.servedToday ??= { dayNumber: -1, customerIds: [] };
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
    world.onboardingDismissed ??= true;

    if (!world.recipes) {
      world.recipes = {};
      for (const recipe of recipes) {
        // v7 also wrote the band bounds, which v14 removes along with heat.
        world.recipes[recipe.id] = { discovered: true, timesBrewed: 0 };
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
        // Temperature and method moved into the pot here; v14 then drops them.
        ...({ temperature: legacy.temperature ?? LEGACY_AMBIENT, method: legacy.method ?? null } as object),
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

  /**
   * v13 → v14: brewing stops being about heat and method, and the book becomes
   * 31 potions.
   *
   * A pot keeps its contents, and a brew in progress or waiting to be bottled
   * keeps its grade — both were decided already. What goes is the state that
   * only meant something while there was a burner: the pot's temperature and
   * chosen method, the band a recipe's knowledge had narrowed down, and the
   * Ledger lines announcing a band had been found.
   *
   * The Lagged upgrade slowed the heat's drift and Deft Hands widened the band.
   * Neither has anything left to act on, so both are removed from what the
   * shop owns — and paid back, gold for the one and Mastery for the other, at
   * what they cost. The prices are written here because the definitions they
   * came from are gone.
   *
   * Every old recipe id — in the book, on bottles and shelves, in pots, on
   * contracts and in the Ledger — becomes the potion made of the same essences.
   */
  14: (world) => {
    const strip = (outcome: unknown) => {
      if (!outcome || typeof outcome !== 'object') return;
      const loose = outcome as Record<string, unknown>;
      delete loose.temperature;
      delete loose.degreesOutsideBand;
      delete loose.method;
      delete loose.isFallback;
      delete loose.contaminantPoints;
    };

    for (const pot of world.cauldrons ?? []) {
      const loose = pot as unknown as Record<string, unknown>;
      delete loose.temperature;
      delete loose.method;
      strip(pot.brewing?.outcome);
      strip(pot.pendingBrew);
    }

    /*
     * The 197-recipe book became 31 potions. Every old recipe folds into the
     * one made of the same essences, wherever a save names it; what was known
     * about any of them is known about the potion they became.
     */
    const MURK = 'murk';
    const renamed = (id: string) => LEGACY_RECIPES.get(id) ?? id;
    const rename = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(rename);
      if (!node || typeof node !== 'object') return;
      const loose = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(loose)) {
        if (key === 'recipeId' && typeof value === 'string') loose[key] = renamed(value);
        else rename(value);
      }
    };

    const known: World['recipes'] = {};
    for (const [id, knowledge] of Object.entries(world.recipes ?? {})) {
      if (id === MURK) continue;
      const next = renamed(id);
      const before = known[next];
      known[next] = {
        discovered: (before?.discovered ?? false) || knowledge.discovered,
        timesBrewed: (before?.timesBrewed ?? 0) + (knowledge.timesBrewed ?? 0),
      };
    }
    // Every shop starts out knowing the five single-essence potions.
    for (const recipe of recipes) {
      if (!recipe.knownFromStart) continue;
      known[recipe.id] = { discovered: true, timesBrewed: known[recipe.id]?.timesBrewed ?? 0 };
    }
    world.recipes = known;

    // Murk had no successor, and was worth next to nothing: it is poured away.
    const isMurk = (item: { recipeId: string } | null | undefined) => item?.recipeId === MURK;
    world.bottled = (world.bottled ?? []).filter((item) => !isMurk(item));
    for (const slot of world.shelf ?? []) {
      if (!isMurk(slot.item)) continue;
      slot.item = null;
      slot.quantity = 0;
    }
    for (const pot of world.cauldrons ?? []) {
      if (isMurk(pot.brewing?.outcome)) pot.brewing = null;
      if (isMurk(pot.pendingBrew)) pot.pendingBrew = null;
    }

    rename(world);

    world.log = (world.log ?? []).filter(
      (entry) => (entry.kind as string) !== 'bandLearned' && entry.params.recipe !== MURK,
    );
    for (const entry of world.log) {
      if (typeof entry.params.recipe === 'string') entry.params.recipe = renamed(entry.params.recipe);
    }

    if (world.equipment?.lagged) {
      world.gold = (world.gold ?? 0) + 180 * world.equipment.lagged;
      delete world.equipment.lagged;
    }
    const deftHands = world.codex?.deftHands ?? 0;
    if (deftHands > 0) {
      // Tier n of a Codex node costs n times its per-tier price; Deft Hands' was 3.
      world.mastery = (world.mastery ?? 0) + (3 * deftHands * (deftHands + 1)) / 2;
    }
    if (world.codex) delete world.codex.deftHands;
    return world;
  },
  /**
   * v14 → v15: bottle forms and the greenhouse are gone.
   *
   * Every bottle becomes a plain potion. Its value is worked out again, since
   * the form's multiplier was part of it. Bred strains fold back into the crop
   * they came from: their seeds become that crop's seeds, and their harvests
   * and pot contents become the plain ingredient. The greenhouse leaves the
   * shop, paid back at its price, and the two beds it added stay, because
   * plots are never taken away.
   */
  15: (world) => {
    const loose = world as unknown as Record<string, unknown>;
    const strains = (loose.strains ?? []) as Array<{ id: string; baseCropId: string }>;

    const reform = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(reform);
      if (!node || typeof node !== 'object') return;
      const item = node as Record<string, unknown>;
      if ('formId' in item && 'recipeId' in item) {
        delete item.formId;
        delete item.dosesLeft;
        item.fairValue = fairValue(item as unknown as BottledItem);
      }
      delete item.strainId;
      for (const value of Object.values(item)) reform(value);
    };
    reform(world);

    for (const strain of strains) {
      const held = world.seeds[strain.id] ?? 0;
      delete world.seeds[strain.id];
      if (held > 0) world.seeds[strain.baseCropId] = (world.seeds[strain.baseCropId] ?? 0) + held;
    }

    // A brew's composition was read by forms, and later by the volatile trait;
    // v18 drops what was left of it.

    delete loose.strains;
    delete loose.nextStrainId;
    delete (world.statistics as unknown as Record<string, unknown>).strainsBred;
    if (world.equipment?.greenhouse) {
      world.gold = (world.gold ?? 0) + 1400 * world.equipment.greenhouse;
      delete world.equipment.greenhouse;
    }
    world.log = (world.log ?? []).filter((entry) => (entry.kind as string) !== 'strainBred');
    // Planting and seed lines named a strain by its id; they name the crop now.
    const baseCrop = new Map(strains.map((strain) => [strain.id, strain.baseCropId]));
    for (const entry of world.log) {
      const crop = entry.params.crop;
      if (typeof crop === 'string' && baseCrop.has(crop)) entry.params.crop = baseCrop.get(crop)!;
    }
    return world;
  },

  /**
   * v15 → v16: the ingredient set is rebuilt on a clean strength scale.
   *
   * Every ingredient that went folds into the kept one of the same kind
   * closest to it in essence, wherever the save names it: stores, pots, the
   * shaft's veins, unclaimed expedition hauls and the Ledger. Seeds of a crop
   * that went become seeds of the nearest herb, a bed growing one keeps
   * growing as that herb, and spores and cave beds of a species that went
   * become the nearest fungus. Kept ingredients keep their id and take their
   * new strength.
   */
  16: (world) => {
    const ingredient = (id: string) => LEGACY_INGREDIENTS.get(id) ?? id;
    const crop = (id: string) => LEGACY_SEEDS.get(id) ?? id;
    const species = (id: string) => LEGACY_SPORES.get(id) ?? id;

    const rename = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(rename);
      if (!node || typeof node !== 'object') return;
      const loose = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(loose)) {
        if (key === 'ingredientId' && typeof value === 'string') loose[key] = ingredient(value);
        else rename(value);
      }
    };
    rename(world.inventory);
    rename(world.cauldrons);
    rename(world.shaft);
    rename(world.pendingClaims);

    const refold = (table: Record<string, number>, map: (id: string) => string) => {
      const out: Record<string, number> = {};
      for (const [id, count] of Object.entries(table ?? {})) {
        const next = map(id);
        out[next] = (out[next] ?? 0) + count;
      }
      return out;
    };
    world.seeds = refold(world.seeds, crop);
    world.spores = refold(world.spores, species);

    for (const plot of world.plots ?? []) {
      if (plot.crop) plot.crop.cropId = crop(plot.crop.cropId);
    }
    for (const tile of world.cave?.tiles ?? []) {
      if (tile.speciesId) tile.speciesId = species(tile.speciesId);
    }

    for (const entry of world.log ?? []) {
      const params = entry.params;
      if (typeof params.ingredient === 'string') params.ingredient = ingredient(params.ingredient);
      if (typeof params.crop === 'string') params.crop = crop(params.crop);
      if (typeof params.item === 'string') params.item = crop(ingredient(params.item));
    }
    return world;
  },

  /**
   * v16 → v17: loose ends from the overhaul.
   *
   * The cave gets a seed of its own, so each world spreads its own way. A
   * shaft dug before the strata came every five metres gets veins at every
   * step it has passed, or the shallow minerals would never surface in it.
   * And a merchant's packed stall is dropped, so it is dealt again from what
   * they trade now rather than showing what no longer exists.
   */
  17: (world) => {
    world.cave.seed ??= world.rngSeed ?? 1;

    const step = shaftConfig.depthStep;
    const dug = new Set((world.shaft?.veins ?? []).map((vein) => vein.depth));
    for (let depth = 0; depth <= (world.shaft?.depth ?? 0); depth += step) {
      if (dug.has(depth)) continue;
      world.shaft.veins.push(...generateVeins(world.rngSeed, depth, new Rng((world.rngSeed ^ depth) >>> 0)));
    }

    for (const visit of Object.values(world.merchantVisits ?? {})) delete visit.picks;
    return world;
  },

  /**
   * v17 → v18: vessels and seals are gone, and bottling is one press.
   *
   * Every bottle loses the vessel and seal it was made with and is revalued
   * as the plain potion it now is; an order stops asking for either; a shelf
   * that stacked several pouches keeps one and hands the rest back to the store
   * room. The vessel moulds and the sealing press never did anything, and are
   * refunded at what they cost. Stalls are dealt again, so none still shows
   * glass for sale.
   */
  18: (world) => {
    const loose = world as unknown as Record<string, unknown>;
    delete loose.vessels;
    delete loose.seals;

    const refunds: Record<string, number> = { vesselMoulds: 900, sealPress: 1200 };
    for (const [id, cost] of Object.entries(refunds)) {
      const owned = world.equipment?.[id] ?? 0;
      if (owned > 0) world.gold = (world.gold ?? 0) + cost * owned;
      if (world.equipment) delete world.equipment[id];
    }

    const unbottle = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const entry of node) unbottle(entry);
        return;
      }
      const item = node as Record<string, unknown>;
      if ('recipeId' in item && ('vesselId' in item || 'sealId' in item)) {
        delete item.vesselId;
        delete item.sealId;
        if ('fairValue' in item) item.fairValue = fairValue(item as unknown as BottledItem);
      }
      delete item.requiresSeal;
      delete item.requiresVessel;
      delete item.composition;
      for (const value of Object.values(item)) unbottle(value);
    };
    unbottle(world);

    for (const slot of world.shelf ?? []) {
      if (!slot.item || slot.quantity <= 1) continue;
      for (let i = 1; i < slot.quantity; i += 1) {
        world.bottled.push({ ...slot.item, uid: `${slot.item.uid}-${i}` });
      }
      slot.quantity = 1;
    }

    for (const visit of Object.values(world.merchantVisits ?? {})) delete visit.picks;

    const gone = new Set([
      'waxedPouch', 'clayVial', 'hornPhial', 'glassFlask', 'copperBottle', 'ironBoundJar',
      'sealedAmphora', 'crystalOrb', 'cork', 'waxRibbon', 'alchemistsMark', 'guildStamp',
      'wardingSigil', 'silverClasp', 'ashwalkerMark', 'vesselMoulds', 'sealPress',
    ]);
    world.log = (world.log ?? []).filter(
      (entry) => !(typeof entry.params.item === 'string' && gone.has(entry.params.item)),
    );
    for (const entry of world.log) delete entry.params.vessel;
    return world;
  },

  /**
   * v18 → v19: the Hearth Guild's wax-sealed order lost its seal in v18, and
   * now its name: `sealedTonics` is `guildTonics`.
   */
  19: (world) => {
    for (const contract of world.contracts ?? []) {
      if (contract.templateId === 'sealedTonics') contract.templateId = 'guildTonics';
    }
    return world;
  },

  /**
   * v19 → v20: the Iron Pot furnishing is gone — it read as a cauldron you
   * could brew in. Whoever owned it has its price back, and the floor it stood
   * on is free for something else.
   */
  20: (world) => {
    const owned = world.decorOwned?.ironPot ?? 0;
    if (owned > 0) world.gold = (world.gold ?? 0) + 150 * owned;
    if (world.decorOwned) delete world.decorOwned.ironPot;
    for (const spot of Object.keys(world.decor ?? {})) {
      if (world.decor[spot] === 'ironPot') world.decor[spot] = null;
    }
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
