/**
 * Scroll positions, kept across a rebuild.
 *
 * The DOM panels are thrown away and rebuilt on every world change, and a world
 * change is most of a click. Without this, every press — stocking a shelf,
 * taking a hero along, folding a section, even the clock ticking on its own —
 * threw the reader back to the top of whatever they were reading.
 *
 * The shell used to do this itself, against a hand-written list of the classes
 * it believed were scrollers. That list was wrong the moment a fourth one
 * appeared, and it was wrong in three ways at once: below the desktop
 * breakpoint the scroller is the panel, not its body; the Roster's sections
 * scroll inside their own folds; and which of them scrolls at all depends on
 * the viewport. So nothing is listed here. Every element that has actually been
 * scrolled is recorded, and put back if the rebuild produced one in the same
 * place.
 *
 * "The same place" is a path of signatures — tag plus classes — and the node's
 * ordinal among the siblings that share its signature. Counting only matching
 * siblings means a badge appearing next to a list does not renumber the list.
 * A `data-keep-scroll` name short-circuits the path entirely, for the few
 * scrollers that move around within their parent between renders.
 */

export type ScrollMemory = Map<string, { top: number; left: number }>;

function signature(node: Element): string {
  const classes = typeof node.className === 'string' ? node.className.trim() : '';
  if (!classes) return node.tagName;
  return `${node.tagName}.${classes.split(/\s+/).sort().join('.')}`;
}

/**
 * Visit every element under `root`, with the key naming where it sits.
 *
 * Keys are built on the way down rather than by walking back up from each node,
 * which keeps this linear in the size of the tree — it runs on every render, on
 * every screen.
 */
function walk(root: Element, visit: (node: Element, key: string) => void): void {
  visit(root, '');
  const descend = (node: Element, prefix: string): void => {
    const children = node.children;
    if (children.length === 0) return;
    const seen = new Map<string, number>();
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      const sig = signature(child);
      const ordinal = seen.get(sig) ?? 0;
      seen.set(sig, ordinal + 1);
      const named = (child as HTMLElement).dataset?.keepScroll;
      const key = named
        ? `#${named}`
        : prefix
          ? `${prefix}/${sig}[${ordinal}]`
          : `${sig}[${ordinal}]`;
      visit(child, key);
      descend(child, key);
    }
  };
  descend(root, '');
}

/** Is anything under here scrolled at all? Reads properties, builds nothing. */
function anyScrolled(node: Element): boolean {
  if (node.scrollTop > 0 || node.scrollLeft > 0) return true;
  // Indexed rather than `for...of`: this runs over every node in the panel on
  // every render, and an iterator per node is the bulk of what that costs.
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    if (anyScrolled(children[i]!)) return true;
  }
  return false;
}

/**
 * What is scrolled, and by how much.
 *
 * The cheap pass comes first because most renders find nothing: a panel sitting
 * at the top has no position to keep, and building a key for every node in it
 * to discover that was the whole cost. On a fifty-shelf shop that pass was a
 * twentieth of every rebuild, spent on an empty answer.
 */
export function captureScroll(root: Element): ScrollMemory {
  const memory: ScrollMemory = new Map();
  if (!anyScrolled(root)) return memory;

  walk(root, (node, key) => {
    if (node.scrollTop > 0 || node.scrollLeft > 0) {
      memory.set(key, { top: node.scrollTop, left: node.scrollLeft });
    }
  });
  return memory;
}

/**
 * Put it back.
 *
 * A position that no longer exists is dropped rather than clamped: a screen
 * that has changed shape has no position worth arguing about. Writing a
 * `scrollTop` past the end is harmless — the browser clamps it to whatever the
 * new content allows, which is the behaviour wanted when a list gets shorter.
 */
export function restoreScroll(root: Element, memory: ScrollMemory): void {
  if (memory.size === 0) return;
  walk(root, (node, key) => {
    const saved = memory.get(key);
    if (!saved) return;
    if (saved.top > 0) node.scrollTop = saved.top;
    if (saved.left > 0) node.scrollLeft = saved.left;
  });
}

/**
 * Where the caret was, kept across the same rebuild.
 *
 * A search box asks for a rebuild on every keystroke — the filter has to run
 * where the list is built, before it is sorted and paged, or a query would only
 * ever narrow the page you happen to be looking at. That rebuild throws the
 * field away mid-word, so the caret has to be put back with it.
 *
 * Named rather than pathed, unlike the scrollers: there are a handful of these,
 * each already unique on its screen, and a name survives the surrounding list
 * changing shape underneath it — which is exactly what typing does.
 */
export interface FocusMemory {
  name: string;
  start: number | null;
  end: number | null;
}

export function captureFocus(root: Element): FocusMemory | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return null;

  const name = active.dataset.keepFocus;
  if (!name) return null;

  const field = active as HTMLInputElement;
  return {
    name,
    start: typeof field.selectionStart === 'number' ? field.selectionStart : null,
    end: typeof field.selectionEnd === 'number' ? field.selectionEnd : null,
  };
}

export function restoreFocus(root: Element, memory: FocusMemory | null): void {
  if (!memory) return;

  const field = root.querySelector<HTMLInputElement>(
    `[data-keep-focus="${CSS.escape(memory.name)}"]`,
  );
  if (!field) return;

  // `preventScroll`, or refocusing a field near the bottom of a long list
  // yanks the list to it — undoing the scroll restore that just ran.
  field.focus({ preventScroll: true });
  if (memory.start !== null && memory.end !== null) {
    try {
      field.setSelectionRange(memory.start, memory.end);
    } catch {
      /* Not a field that carries a selection. The focus is the important half. */
    }
  }
}
