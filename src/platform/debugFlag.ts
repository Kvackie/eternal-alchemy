/**
 * Whether this browser wants the debug panel.
 *
 * The panel grants gold, skips days and rerolls the seed, so a built copy of
 * the game does not carry it for everyone who opens the link. It still has to
 * be reachable on a real device, which is where the timing bugs are — hence a
 * preference rather than a build flag.
 *
 * Two ways in, one store. `?debug=1` is the one you can type on a phone with no
 * settings screen in front of you; the switch in Settings is the one you find
 * without being told it exists. Both write here, so they never disagree.
 */

const KEY = 'eternal-alchemy/debug';

/** Read the query flag once, at module load, before anything can navigate away. */
const asked = (() => {
  try {
    return new URLSearchParams(location.search).get('debug');
  } catch {
    return null;
  }
})();

/**
 * The one answer, so the switch in Settings can never disagree with the screen.
 *
 * Nothing stored means "whatever this build is for": a dev server has the panel
 * on, a built copy does not. Once the switch or the query flag has been used,
 * that choice wins in either — turning it off in `npm run dev` turns it off.
 */
export function debugEnabled(): boolean {
  try {
    if (asked !== null) {
      const on = asked !== '0' && asked !== 'false';
      localStorage.setItem(KEY, on ? '1' : '0');
      return on;
    }
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
    // Not remembering it is survivable; the session still has the flag below.
  }
}
