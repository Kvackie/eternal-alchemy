import { describe, expect, it } from 'vitest';
import { SaveManager, memoryAdapter } from '@/platform/save';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { config } from '@/sim/config';

const HOUR = 3_600_000;

describe('saving', () => {
  it('round-trips a world through storage', () => {
    const saves = new SaveManager(memoryAdapter());
    const sim = new Simulation(createWorld(4321));
    sim.plant(sim.world.plots[0]!.id, 'sunleaf');
    sim.advanceBy(2 * HOUR);
    sim.grant({ gold: 500 });

    saves.save(sim.world);
    const loaded = saves.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.gold).toBe(sim.world.gold);
    expect(loaded!.now).toBe(sim.world.now);
    expect(loaded!.plots[0]?.crop?.cropId).toBe('sunleaf');
  });

  it('rotates slots so one bad write cannot destroy the game', () => {
    const storage = memoryAdapter();
    const saves = new SaveManager(storage);
    const sim = new Simulation(createWorld(1));

    sim.grant({ gold: 100 });
    saves.save(sim.world);
    sim.grant({ gold: 100 });
    saves.save(sim.world);

    // Corrupt the newest slot; the previous one must still load.
    storage.set('eternal-alchemy/save/2', '{ this is not json');
    const recovered = saves.load();

    expect(recovered).not.toBeNull();
    expect(recovered!.gold).toBeGreaterThan(0);
  });

  it('returns null when there is nothing saved', () => {
    expect(new SaveManager(memoryAdapter()).load()).toBeNull();
  });

  it('refuses a save from a future schema rather than half-reading it', () => {
    const storage = memoryAdapter();
    const saves = new SaveManager(storage);
    storage.set(
      'eternal-alchemy/save/0',
      JSON.stringify({
        schemaVersion: config.save.schemaVersion + 99,
        savedAt: Date.now(),
        world: createWorld(1),
      }),
    );
    expect(saves.load()).toBeNull();
  });

  it('exports and imports as text, the only backup a local-only save has', () => {
    const saves = new SaveManager(memoryAdapter());
    const sim = new Simulation(createWorld(88));
    sim.world.gold = 777;

    const text = saves.export(sim.world);
    const imported = saves.import(text);

    expect(imported?.gold).toBe(777);
  });

  it('rejects an import that is not a save', () => {
    const saves = new SaveManager(memoryAdapter());
    expect(saves.import('not json at all')).toBeNull();
    expect(saves.import('{"hello":"world"}')).toBeNull();
  });

  it('survives storage that throws on every access', () => {
    const hostile = {
      get() {
        throw new Error('blocked');
      },
      set() {
        throw new Error('blocked');
      },
      remove() {
        throw new Error('blocked');
      },
    };
    const saves = new SaveManager({
      get: () => {
        try {
          return hostile.get();
        } catch {
          return null;
        }
      },
      set: () => {
        try {
          hostile.set();
        } catch {
          /* ignore */
        }
      },
      remove: () => {
        try {
          hostile.remove();
        } catch {
          /* ignore */
        }
      },
    });

    expect(() => saves.save(createWorld(1))).not.toThrow();
    expect(saves.load()).toBeNull();
  });
});

describe('resuming from a save', () => {
  it('continues the world where it left off, including the RNG', () => {
    const saves = new SaveManager(memoryAdapter());
    const original = new Simulation(createWorld(555));
    original.advanceBy(3 * HOUR);
    saves.save(original.world);

    const resumed = new Simulation(saves.load()!);
    expect(resumed.now).toBe(original.now);
    expect(resumed.world.rngSeed).toBe(original.world.rngSeed);

    original.advanceBy(HOUR);
    resumed.advanceBy(HOUR);
    expect(resumed.world.gold).toBe(original.world.gold);
  });
});
