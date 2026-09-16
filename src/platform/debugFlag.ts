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

/**
 * The query flag is applied once, at module load, and then forgotten.
 *
 * It used to be re-read on every call, which meant `?debug=1` outranked storage
 * for the whole life of the page: pressing Off in Settings wrote '0', and the
 * next render read the flag again, returned true and wrote '1' back. The switch
 * snapped to On while the panel was gone, and a reload without the query string
 * still came up with debug on. Writing it once makes the preference the only
 * thing anyone reads afterwards, which is what lets the switch be authoritative.
 */
(() => {
  try {
    const asked = new URLSearchParams(location.search).get('debug');
    if (asked === null) return;
    localStorage.setItem(KEY, asked !== '0' && asked !== 'false' ? '1' : '0');
  } catch {
    // No query string to read, or no storage to write it to. Either way the
    // stored preference below is the answer.
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
