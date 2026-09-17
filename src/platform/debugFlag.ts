/**
 * Whether this browser wants the debug panel.
 *
 * The panel grants gold, skips days and rerolls the seed, so a built copy of
 * the game does not carry it for everyone who opens the link. It still has to
 * be reachable on a real device, which is where the timing bugs are — hence a
 * preference rather than a build flag, set from the switch in Settings.
 *
 * There was a `?debug=1` query flag here too, from before that switch existed.
 * It is gone: two ways to set one thing is one way too many, and a link that
 * quietly rewrites a stored preference the moment it loads is a surprising
 * thing for a URL to do.
 */

const KEY = 'eternal-alchemy/debug';

/**
 * Nothing stored means "whatever this build is for".
 *
 * A dev server has the panel on, a built copy does not. Once the switch has
 * been used, that choice wins in either — turning it off in `npm run dev`
 * turns it off.
 */
export function debugEnabled(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) return stored === '1';
    return import.meta.env.DEV;
  } catch {
    // Private windows and blocked site data both throw rather than return null.
    return import.meta.env.DEV;
  }
}

export function setDebugEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Not remembering it is survivable; the session still has the flag above.
  }
}
