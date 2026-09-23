/**
 * Seeded, deterministic RNG.
 *
 * Offline catch-up replays a stretch of world time that the player never watched.
 * If that replay used Math.random, the same save loaded twice would produce
 * different gold, and a bug report would be unreproducible. Every random draw in
 * the sim comes from here.
 */

/** mulberry32 — small, fast, good enough for a shop sim, and trivially serialisable. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Current seed, so it can be written into the save and resumed exactly. */
  get seed(): number {
    return this.state >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[this.int(0, items.length - 1)];
  }
}

/** A stable seed from a string (FNV-1a), for streams keyed to a thing and a time. */
export function hashKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A seed derived from the current time, for brand-new games only. */
export function freshSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
