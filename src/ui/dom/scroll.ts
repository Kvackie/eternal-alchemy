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
 * Every press that changes the world rebuilds the panel it was made in, which
 * throws away the control that was pressed. Focus falls to `<body>` with it, so
 * a keyboard player had to Tab from the top of the page after every sort, every
 * fold, every page of a list and every Take along. This finds the control that
 * stands where the pressed one stood and puts the caret back on it.
 *
 * "Where it stood" is an identity rather than a position, because a press is
 * usually what moved things: a sort reorders the list, a fold removes the rows
 * above, a sale shortens it. So a control is known by
 *
 * - its scope: the landmarks around it that say whose it is — a row by its
 *   title, a fold by its heading, a dialog by its heading, anything with an id,
 *   and anything a panel has named with `data-focus-scope`;
 * - its role, and its name: `data-focus-key` if the builder gave it one, else
 *   its label or its text (less anything that ticks, like a countdown);
 * - and which of the controls sharing all of that it was.
 *
 * A control whose name changes when pressed — Take along turning into Leave
 * behind — is found a second way: the same scope, and the same position within
 * the innermost landmark around it. That only ever lands inside the same row or
 * the same fold, never on a stranger that happens to be in the same place.
 *
 * If neither finds it, nothing is focused. Putting the caret on the first
 * control instead would be a jump to the top by another name.
 *
 * A `data-keep-focus` name is the old, stronger form: unique on its screen,
 * matched on its own, and the field's selection comes back with it — which is
 * what lets a search box be typed into while every keystroke rebuilds the list.
 */
export interface FocusMemory {
  /** The `data-keep-focus` name, when the control had one. */
  name: string | null;
  scope: string;
  role: string;
  label: string;
  /** Which of the controls sharing scope, role and label it was. */
  ordinal: number;
  /** Its position within the innermost landmark, for a control that renamed itself. */
  path: string;
  start: number | null;
  end: number | null;
}

/** Everything that can hold the caret. */
const CONTROLS =
  'button, input, select, textarea, a[href], summary, [tabindex], [contenteditable="true"], [role="button"], [role="tab"], [role="switch"]';

/** Text that changes on its own, and so is no part of a name. */
const UNSTABLE_TEXT = '[data-countdown-at], .badge';

function readText(node: Node, out: string[]): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.TEXT_NODE) out.push(child.nodeValue ?? '');
    else if (child instanceof Element && !child.matches(UNSTABLE_TEXT)) readText(child, out);
  }
}

function textOf(node: Element | null): string {
  if (!node) return '';
  const out: string[] = [];
  readText(node, out);
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function roleOf(node: Element): string {
  return node.getAttribute('role') ?? node.tagName.toLowerCase();
}

function labelOf(node: HTMLElement): string {
  const key = node.dataset.focusKey;
  if (key) return `=${key}`;
  const aria = node.getAttribute('aria-label');
  if (aria) return aria.trim();
  // A row that is itself the control is named by its title, not by every
  // figure on it.
  if (node.classList.contains('row')) {
    return textOf(node.querySelector(':scope > .row-main > .row-title'));
  }
  // A field's value is what the player is changing, so it cannot name it.
  if (
    node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement
  ) {
    return node.name || node.getAttribute('placeholder') || node.type;
  }
  return textOf(node);
}

/** What an ancestor says about whose a control is, if it says anything. */
function landmarkOf(node: Element): string | null {
  const scope = (node as HTMLElement).dataset?.focusScope;
  if (scope) return `=${scope}`;
  if (node.id) return `#${node.id}`;
  if (node.classList.contains('row')) {
    return `row:${textOf(node.querySelector(':scope > .row-main > .row-title'))}`;
  }
  if (node.classList.contains('collapsible')) {
    return `fold:${textOf(node.querySelector(':scope > .collapsible-head > .field-label'))}`;
  }
  if (node.getAttribute('role') === 'dialog') return `dialog:${textOf(node.querySelector('h2'))}`;
  return null;
}

function scopeOf(node: Element, root: Element): string {
  const parts: string[] = [];
  for (let at = node.parentElement; at && at !== root; at = at.parentElement) {
    const mark = landmarkOf(at);
    if (mark) parts.push(mark);
  }
  return parts.reverse().join(' > ');
}

function ordinalAmong(node: Element, same: (sibling: Element) => boolean): number {
  let ordinal = 0;
  for (let at = node.previousElementSibling; at; at = at.previousElementSibling) {
    if (same(at)) ordinal += 1;
  }
  return ordinal;
}

/**
 * Where a control sits under its innermost landmark.
 *
 * Tag alone for the control itself, since a press often restyles it; tag and
 * classes for the wrappers, counted the way the scroll paths count them.
 */
function pathOf(node: Element, root: Element): string {
  const parts = [`${node.tagName}[${ordinalAmong(node, (at) => at.tagName === node.tagName)}]`];
  for (let at = node.parentElement; at && at !== root; at = at.parentElement) {
    if (landmarkOf(at)) break;
    const sig = signature(at);
    parts.push(`${sig}[${ordinalAmong(at, (other) => signature(other) === sig)}]`);
  }
  return parts.reverse().join('/');
}

function controlsIn(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CONTROLS)];
}

function matchesByKey(
  root: Element,
  role: string,
  label: string,
  scope: string,
  candidates: HTMLElement[],
): HTMLElement[] {
  // Role and label first: they are cheap, and they rule out nearly everything
  // before the walk up to the scope is paid for.
  return candidates.filter(
    (node) => roleOf(node) === role && labelOf(node) === label && scopeOf(node, root) === scope,
  );
}

export function captureFocus(root: Element): FocusMemory | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === root || !root.contains(active)) return null;
  if (!active.matches(CONTROLS)) return null;

  const field = active as HTMLInputElement;
  const start = typeof field.selectionStart === 'number' ? field.selectionStart : null;
  const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : null;

  const name = active.dataset.keepFocus ?? null;
  const role = roleOf(active);
  const label = labelOf(active);
  const scope = scopeOf(active, root);
  const ordinal = name
    ? 0
    : matchesByKey(root, role, label, scope, controlsIn(root)).indexOf(active);

  return {
    name,
    scope,
    role,
    label,
    ordinal: Math.max(0, ordinal),
    path: name ? '' : pathOf(active, root),
    start,
    end,
  };
}

function canTakeFocus(node: HTMLElement): boolean {
  if ((node as HTMLButtonElement).disabled) return false;
  if (node.closest('[inert], [hidden]')) return false;
  return node.getClientRects().length > 0;
}

/**
 * The control itself or, if a press has just switched it off, its nearest
 * neighbour in the same group: the last page's More is disabled, and the
 * caret belongs on the pager's other button rather than on nothing.
 */
function focusable(target: HTMLElement): HTMLElement | null {
  if (canTakeFocus(target)) return target;
  const group = target.parentElement;
  if (!group) return null;
  const siblings = [...group.querySelectorAll<HTMLElement>(CONTROLS)].filter(
    (node) => node.parentElement === group,
  );
  const at = siblings.indexOf(target);
  const byDistance = siblings
    .map((node, index) => ({ node, distance: Math.abs(index - at) }))
    .filter(({ node }) => node !== target)
    .sort((a, b) => a.distance - b.distance);
  return byDistance.find(({ node }) => canTakeFocus(node))?.node ?? null;
}

function findEquivalent(root: Element, memory: FocusMemory): HTMLElement | null {
  if (memory.name) {
    return root.querySelector<HTMLElement>(`[data-keep-focus="${CSS.escape(memory.name)}"]`);
  }

  const candidates = controlsIn(root);
  const same = matchesByKey(root, memory.role, memory.label, memory.scope, candidates);
  if (same.length > 0) return same[Math.min(memory.ordinal, same.length - 1)]!;

  // Renamed by the press: the same place, under the same landmark.
  return (
    candidates.find(
      (node) =>
        roleOf(node) === memory.role &&
        scopeOf(node, root) === memory.scope &&
        pathOf(node, root) === memory.path,
    ) ?? null
  );
}

export function restoreFocus(root: Element, memory: FocusMemory | null): void {
  if (!memory) return;

  const found = findEquivalent(root, memory);
  const target = found ? focusable(found) : null;
  if (!target) return;

  // `preventScroll`, or refocusing a control near the bottom of a long list
  // yanks the list to it — undoing the scroll restore that just ran.
  target.focus({ preventScroll: true });
  if (target === found && memory.start !== null && memory.end !== null) {
    try {
      (target as HTMLInputElement).setSelectionRange(memory.start, memory.end);
    } catch {
      /* Not a field that carries a selection. The focus is the important half. */
    }
  }
}
