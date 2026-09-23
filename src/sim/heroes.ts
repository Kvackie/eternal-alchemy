/**
 * Heroes, missions and favour.
 *
 * This is the system that closes the loop. Heroes consume *your own potions* as
 * expedition supplies, which turns your product into an input, gives you a
 * reason to brew things you would never sell, and stops the mid-game from
 * becoming a pure export economy.
 *
 * Nobody dies and nobody quits. A mission never fails outright — it comes back
 * Bountiful, Successful or Meagre, with an independent injury roll — and favour
 * never falls below its floor. The system rewards attentive play; it does not
 * punish a week away.
 */

import { getBiome, getHeroDef, getSeal, getVessel, heroesConfig } from './config';
import { addIngredient } from './inventory';
import type { Rng } from './rng';
import type { Grade, Hero, Mission, MissionOutcome, World } from './types';

const GRADE_POINTS: Record<Grade, number> = { S: 6, A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };

export function favourBandOf(favour: number): (typeof heroesConfig.favourBands)[number] {
  let band = heroesConfig.favourBands[0]!;
  for (const candidate of heroesConfig.favourBands) {
    if (favour >= candidate.min) band = candidate;
  }
  return band;
}

/** Level as the mission maths sees it: base, plus what favour has earned. */
export function effectiveLevel(hero: Hero): number {
  return hero.level + favourBandOf(hero.favour).levelBonus;
}

export function isAvailable(hero: Hero, now: number): boolean {
  return hero.onMission === false && (hero.injuredUntil === null || now >= hero.injuredUntil);
}

export function isInjured(hero: Hero, now: number): boolean {
  return hero.injuredUntil !== null && now < hero.injuredUntil;
}

/** Favour never drops below the floor — a hero can be disappointed, never lost. */
export function adjustFavour(hero: Hero, delta: number): void {
  hero.favour = Math.max(0, Math.min(100, hero.favour + delta));
}

/**
 * What this hero costs to take on.
 *
 * Priced off their level, so the tavern's level 5 veteran is not the same
 * bargain as its level 1 hopeful. Deliberately their *base* level rather than
 * `effectiveLevel`: favour is earned by working with someone, and charging for
 * it would mean paying twice for a hero you already raised and let go.
 */
export function recruitCostOf(heroId: string): number {
  return heroesConfig.recruitCostPerLevel * getHeroDef(heroId).baseLevel;
}

export function recruit(world: World, heroId: string): boolean {
  if (world.heroes.some((hero) => hero.id === heroId)) return false;
  const def = getHeroDef(heroId);
  const cost = recruitCostOf(heroId);
  if (world.gold < cost) return false;

  world.gold -= cost;
  world.heroes.push({
    id: heroId,
    level: def.baseLevel,
    favour: 0,
    injuredUntil: null,
    onMission: false,
    missionsCompleted: 0,
  });
  return true;
}

/**
 * Let a hero go, freeing their place.
 *
 * Refused while they are away — the mission holds their id and would resolve
 * onto a hero who no longer exists. Favour and level are lost with them: taking
 * someone back on is re-recruiting a stranger, which is the cost of a roster
 * slot being a real decision rather than a revolving door.
 */
export function dismiss(world: World, heroId: string): boolean {
  const index = world.heroes.findIndex((hero) => hero.id === heroId);
  if (index < 0 || world.heroes[index]!.onMission) return false;
  world.heroes.splice(index, 1);
  return true;
}

export interface MissionEstimate {
  success: number;
  rareFind: number;
  injury: number;
  durationMs: number;
  suppliesFilled: number;
  favouriteSupplied: boolean;
}

/**
 * What a proposed mission looks like before it is sent.
 *
 * Supplies help across the board: better potions raise success and rare finds
 * and lower injury. Unused supply slots are not wasted — over-packing is
 * kindness, and it shows up in favour on return rather than in the odds.
 */
export function estimateMission(
  world: World,
  biomeId: string,
  heroIds: string[],
  supplyUids: string[],
): MissionEstimate {
  const biome = getBiome(biomeId);
  const heroes = world.heroes.filter((hero) => heroIds.includes(hero.id));

  const levels = heroes.reduce((sum, hero) => sum + effectiveLevel(hero), 0);
  const affinity = heroes.filter((hero) => getHeroDef(hero.id).affinity === biomeId).length;

  let success = biome.baseSuccess + levels * 0.02 + affinity * 0.06;
  let injury = biome.baseInjury;
  let rareFind = biome.baseRareFind;

  for (const hero of heroes) {
    const band = favourBandOf(hero.favour);
    injury += band.injuryModifier;
    rareFind += band.rareFindBonus;
    if (getHeroDef(hero.id).traits.includes('fragile')) injury += 0.06;
    if (getHeroDef(hero.id).traits.includes('lucky')) rareFind += 0.05;
  }

  const s = heroesConfig.supplies;
  let favouriteSupplied = false;
  let filled = 0;

  for (const uid of supplyUids.slice(0, s.slots)) {
    const item = world.bottled.find((entry) => entry.uid === uid);
    if (!item) continue;
    filled += 1;

    /*
     * A horn phial and a warding sigil both promise "+1 grade when supplied to
     * heroes", so the supply maths reads the bottle as one grade better than it
     * is. Capped at the top of the scale — nothing makes a potion better than S.
     */
    const carried =
      (getVessel(item.vesselId).supplyGradeBonus ?? 0) + (getSeal(item.sealId).supplyGradeBonus ?? 0);
    const points = Math.min(GRADE_POINTS.S, GRADE_POINTS[item.grade] + carried);
    success += points * s.successPerGradePoint;
    rareFind += points * s.rareFindPerGradePoint;
    injury += points * s.injuryPerGradePoint;
    if (heroes.some((hero) => getHeroDef(hero.id).favourite === item.recipeId)) {
      favouriteSupplied = true;
    }
  }

  return {
    success: clamp(success, 0.05, 0.98),
    rareFind: clamp(rareFind, 0, 0.9),
    injury: clamp(injury, 0.01, 0.6),
    durationMs: biome.durationMs,
    suppliesFilled: filled,
    favouriteSupplied,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Can this party go?
 *
 * Three to a party, and no limit at all on how many parties are out — forty-five
 * heroes is fifteen expeditions, or forty-five solo ones. The cap belongs to the
 * party because it is what makes a party a choice: who goes together, against a
 * supply rack that is also three deep. It never belonged to the roster, where it
 * only meant that every bunk past the third was money spent on a bench.
 */
export function canSend(world: World, heroIds: string[]): boolean {
  if (heroIds.length === 0 || heroIds.length > heroesConfig.partySize) return false;
  if (world.missions.some((mission) => mission.heroIds.some((id) => heroIds.includes(id)))) {
    return false;
  }
  return heroIds.every((id) => {
    const hero = world.heroes.find((entry) => entry.id === id);
    return hero !== undefined && isAvailable(hero, world.now);
  });
}

/** Send a party. Supplies are consumed now, whatever the mission returns. */
export function sendMission(
  world: World,
  biomeId: string,
  heroIds: string[],
  supplyUids: string[],
): Mission | null {
  if (!canSend(world, heroIds)) return null;

  const estimate = estimateMission(world, biomeId, heroIds, supplyUids);
  const used = supplyUids.slice(0, heroesConfig.supplies.slots);

  for (const uid of used) {
    const index = world.bottled.findIndex((item) => item.uid === uid);
    if (index >= 0) world.bottled.splice(index, 1);
  }

  for (const id of heroIds) {
    const hero = world.heroes.find((entry) => entry.id === id);
    if (hero) hero.onMission = true;
  }

  const mission: Mission = {
    id: `mission-${world.nextMissionId}`,
    biomeId,
    heroIds: [...heroIds],
    startedAt: world.now,
    returnsAt: world.now + estimate.durationMs,
    success: estimate.success,
    rareFind: estimate.rareFind,
    injury: estimate.injury,
    suppliesFilled: estimate.suppliesFilled,
    favouriteSupplied: estimate.favouriteSupplied,
  };

  world.nextMissionId += 1;
  world.missions.push(mission);
  return mission;
}

/**
 * Resolve every mission whose time is up, into a haul waiting to be claimed.
 *
 * The outcome is never "failed" — a bad roll is a Meagre haul, not a wasted
 * afternoon and a lost party. Injury is rolled separately, so a triumphant
 * mission can still bring someone home limping.
 *
 * Every roll happens *here*, at the moment the party is due, and is then frozen
 * in `pendingClaims`. Nothing is granted and nobody is freed until the player
 * greets them. That split is what makes the claim screen honest: it reports a
 * result that already exists rather than rolling one when you happen to look,
 * so waiting a day cannot improve a haul and being away cannot cost you one.
 */
export function resolveMissions(world: World, rng: Rng): MissionOutcome[] {
  const outcomes: MissionOutcome[] = [];
  const due = world.missions.filter((mission) => world.now >= mission.returnsAt);

  for (const mission of due) {
    const biome = getBiome(mission.biomeId);
    const roll = rng.next();
    const quality: MissionOutcome['quality'] =
      roll < mission.success * 0.4 ? 'bountiful' : roll < mission.success ? 'successful' : 'meagre';

    const multiplier = quality === 'bountiful' ? 2 : quality === 'successful' ? 1 : 0.5;
    const found: MissionOutcome['found'] = [];

    const draws = quality === 'meagre' ? 1 : 2;
    for (let i = 0; i < draws; i += 1) {
      const entry = weightedPick(biome.loot, rng);
      if (!entry) continue;
      const count = Math.max(1, Math.round(rng.int(entry.min, entry.max) * multiplier));
      found.push({ kind: entry.kind ?? 'ingredient', ingredientId: entry.ingredientId, count });
    }

    if (rng.chance(mission.rareFind)) {
      const entry = weightedPick(biome.rare, rng);
      if (entry) {
        found.push({
          kind: entry.kind ?? 'ingredient',
          ingredientId: entry.ingredientId,
          count: rng.int(entry.min, entry.max),
        });
      }
    }

    const injured = mission.heroIds.filter(
      (id) => world.heroes.some((hero) => hero.id === id) && rng.chance(mission.injury),
    );

    world.statistics.missionsCompleted += 1;
    const outcome: MissionOutcome = {
      missionId: mission.id,
      biomeId: mission.biomeId,
      quality,
      found,
      injured,
      heroIds: [...mission.heroIds],
      suppliesFilled: mission.suppliesFilled,
      favouriteSupplied: mission.favouriteSupplied,
      returnedAt: mission.returnsAt,
    };
    world.pendingClaims.push(outcome);
    outcomes.push(outcome);
  }

  world.missions = world.missions.filter((mission) => world.now < mission.returnsAt);
  return outcomes;
}

/**
 * Take the haul, and let the party go.
 *
 * The counterpart to `resolveMissions`: everything that changes the world for a
 * returned mission happens here, once. Rest begins now rather than at the moment
 * they walked in, which is the reading that matches the fiction — you send them
 * to bed when you see the state of them.
 */
export function claimMission(world: World, missionId: string): MissionOutcome | null {
  const index = world.pendingClaims.findIndex((entry) => entry.missionId === missionId);
  if (index < 0) return null;

  const outcome = world.pendingClaims[index]!;
  world.pendingClaims.splice(index, 1);

  for (const entry of outcome.found) {
    if (entry.kind === 'seed') {
      world.seeds[entry.ingredientId] = (world.seeds[entry.ingredientId] ?? 0) + entry.count;
    } else if (entry.kind === 'spore') {
      world.spores[entry.ingredientId] = (world.spores[entry.ingredientId] ?? 0) + entry.count;
    } else {
      addIngredient(world, entry.ingredientId, entry.count, null);
    }
  }

  const f = heroesConfig.favour;
  for (const id of outcome.heroIds) {
    const hero = world.heroes.find((entry) => entry.id === id);
    if (!hero) continue;

    hero.onMission = false;
    hero.missionsCompleted += 1;

    adjustFavour(hero, f.perReturn + outcome.suppliesFilled * f.perSupplySlotFilled);
    if (outcome.favouriteSupplied && getHeroDef(hero.id).favourite) {
      adjustFavour(hero, f.perFavouritePotion);
    }
    if (outcome.suppliesFilled === 0) adjustFavour(hero, f.sentUnsupplied);

    if (outcome.injured.includes(id)) {
      hero.injuredUntil = world.now + heroesConfig.restMsPerInjury;
    }
  }

  return outcome;
}

function weightedPick<T extends { weight: number }>(entries: T[], rng: Rng): T | undefined {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return undefined;
  let roll = rng.next() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

/** The potion that mends an injured hero: water and earth, as the old tonic was. */
export const HEALING_RECIPE = 'aquaTerra';

/**
 * Heal an injured hero with a Restorative rather than leaving them to rest.
 *
 * Worth the most favour of anything you can do, because it is the one that
 * costs you something you could have sold.
 */
export function healHero(world: World, heroId: string, itemUid: string): boolean {
  const hero = world.heroes.find((entry) => entry.id === heroId);
  if (!hero || !isInjured(hero, world.now)) return false;

  const index = world.bottled.findIndex((item) => item.uid === itemUid);
  if (index < 0) return false;
  const item = world.bottled[index]!;
  if (item.recipeId !== HEALING_RECIPE) return false;

  world.bottled.splice(index, 1);
  hero.injuredUntil = null;
  adjustFavour(hero, heroesConfig.favour.perHealed);
  return true;
}
