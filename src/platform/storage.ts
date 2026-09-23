/**
 * Where a save physically lives.
 *
 * The web build uses `localStorage`; a Capacitor build uses Preferences, which
 * survives things `localStorage` does not — an OS clearing web data, an app
 * update, a user tapping "clear cache". For a local-only save that distinction
 * is the difference between keeping a forty-hour game and losing it.
 *
 * Capacitor is detected at runtime and imported dynamically, so the web bundle
 * never carries the native plugin and the game runs identically with neither.
 */

import { localStorageAdapter, saveKeys, type StorageAdapter } from './save';

/**
 * Capacitor's native bridge, as the WebView sees it.
 *
 * Reached through the injected global rather than an `import`. A bare module
 * specifier is not resolvable in a WebView any more than in a browser, so
 * importing the plugin would either drag Capacitor into the web bundle or 404
 * on device. The global is there on native and absent everywhere else, which is
 * exactly the test we need anyway.
 */
interface PreferencesPlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { Preferences?: PreferencesPlugin };
}

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

function isNative(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function preferences(): PreferencesPlugin | null {
  return capacitor()?.Plugins?.Preferences ?? null;
}

/**
 * A synchronous adapter backed by an asynchronous store.
 *
 * The save manager is deliberately synchronous — saving happens inside game
 * actions and must not be something a caller can forget to await. Preferences is
 * async, so this keeps an in-memory mirror for reads and writes through in the
 * background. A dropped write costs at most the last autosave, and the next one
 * lands seconds later.
 */
function mirroredAdapter(
  load: (key: string) => Promise<string | null>,
  store: (key: string, value: string) => Promise<void>,
  drop: (key: string) => Promise<void>,
  keys: string[],
): StorageAdapter {
  const mirror = new Map<string, string>();

  // Warm the mirror. Until it resolves the game reads an empty store and
  // behaves as a new save, so the bootstrap awaits `readyPromise` first.
  const warm = Promise.all(
    keys.map(async (key) => {
      const value = await load(key).catch(() => null);
      if (value !== null) mirror.set(key, value);
    }),
  );
  readyPromise = warm.then(() => undefined);

  return {
    get: (key) => mirror.get(key) ?? null,
    set: (key, value) => {
      mirror.set(key, value);
      void store(key, value).catch(() => {
        /* the next autosave will try again */
      });
    },
    remove: (key) => {
      mirror.delete(key);
      void drop(key).catch(() => {});
    },
  };
}

let readyPromise: Promise<void> = Promise.resolve();

/** Resolves once the chosen adapter can be read from. */
export function storageReady(): Promise<void> {
  return readyPromise;
}

/**
 * Pick the adapter for this platform.
 *
 * Returns synchronously so bootstrap order stays simple; on native the returned
 * adapter is empty until `storageReady()` resolves.
 */
export function createStorage(slots: number): StorageAdapter {
  if (!isNative()) return localStorageAdapter;

  // Preferences has no synchronous enumeration, so the mirror has to be told
  // every key to warm up front.
  const keys = saveKeys(slots);

  // A native shell without the plugin installed falls back rather than failing.
  return mirroredAdapter(
    async (key) => {
      const plugin = preferences();
      if (!plugin) return localStorageAdapter.get(key);
      return (await plugin.get({ key })).value;
    },
    async (key, value) => {
      const plugin = preferences();
      if (!plugin) return localStorageAdapter.set(key, value);
      await plugin.set({ key, value });
    },
    async (key) => {
      const plugin = preferences();
      if (!plugin) return localStorageAdapter.remove(key);
      await plugin.remove({ key });
    },
    keys,
  );
}
