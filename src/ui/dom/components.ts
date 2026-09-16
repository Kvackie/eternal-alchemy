/**
 * Small DOM builders shared by every panel.
 *
 * Deliberately plain: no framework, no virtual DOM. The panels are rebuilt
 * wholesale on change, which at this scale is cheaper than diffing and much
 * easier to reason about.
 */

import { essenceGlyphSvg } from '@/ui/theme';
import { artUrlIf, dominantEssence } from '@/ui/art';
import { getIngredient, getRecipe } from '@/sim/config';
import { formatGold, t } from '@/i18n';
import { ESSENCES } from '@/sim/types';
import type { Essence, EssenceVector, Grade } from '@/sim/types';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * An ingredient's picture, or its essence glyph if it hasn't got one.
 *
 * Six panels drew this same badge by hand, which meant wiring painted art would
 * have been six near-identical edits and a seventh place to forget. The glyph
 * fallback stays because it is also the colour-blind affordance: shape carries
 * the essence when colour alone would not.
 */
export function ingredientIcon(ingredientId: string, size = 18): HTMLElement {
  const url = artUrlIf('ingredient', ingredientId);
  if (url) {
    return el('img', {
      class: 'art-icon',
      src: url,
      alt: '',
      width: String(size + 6),
      height: String(size + 6),
      loading: 'lazy',
      decoding: 'async',
    });
  }

  const essence = dominantEssence(getIngredient(ingredientId).essence);
  return el('span', { class: `essence-mark ${essence}`, html: essenceGlyphSvg(essence, size) });
}

/**
 * A finished potion's picture, or its recipe's essence glyph.
 *
 * Art for completed products drops into `art/potions/<recipeId>.png` and is
 * picked up here with no further wiring — the same fallback rule as ingredients,
 * so the shelf keeps working while the set is incomplete.
 */
export function potionIcon(recipeId: string, size = 18): HTMLElement {
  const url = artUrlIf('potion', recipeId);
  if (url) {
    return el('img', {
      class: 'art-icon',
      src: url,
      alt: '',
      width: String(size + 6),
      height: String(size + 6),
      loading: 'lazy',
      decoding: 'async',
    });
  }

  const essence = dominantEssence(getRecipe(recipeId).target);
  return el('span', { class: `essence-mark ${essence}`, html: essenceGlyphSvg(essence, size) });
}

/**
 * A character's portrait, or nothing at all.
 *
 * Returns null rather than a placeholder: a missing face is better left out than
 * filled with a grey square, and every caller already lays out fine without one.
 */
export function portrait(kind: 'merchant' | 'hero', id: string): HTMLElement | null {
  const url = artUrlIf(kind, id);
  if (!url) return null;
  return el('img', {
    class: `portrait portrait-${kind}`,
    src: url,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
  });
}

export function button(
  label: string,
  onClick: () => void,
  opts: { variant?: string; disabled?: boolean; small?: boolean; title?: string } = {},
): HTMLButtonElement {
  const classes = ['btn'];
  if (opts.variant) classes.push(opts.variant);
  if (opts.small) classes.push('small');

  const node = el('button', { class: classes.join(' '), type: 'button' }, [label]);
  if (opts.disabled) node.disabled = true;
  if (opts.title) node.title = opts.title;
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return node;
}

/** An essence chip: glyph plus value. The glyph is why this works without colour. */
export function essenceChip(essence: Essence, value: number): HTMLElement {
  return el('span', { class: `chip ${essence}` }, [
    el('span', { html: essenceGlyphSvg(essence, 10) }),
    el('span', { text: `${t(`essence.${essence}.short`)} ${Math.round(value)}` }),
  ]);
}

/** Every non-zero essence in a blend, in a stable order. */
export function essenceChips(vector: EssenceVector, threshold = 0.5): HTMLElement[] {
  return ESSENCES.filter((essence) => vector[essence] >= threshold).map((essence) =>
    essenceChip(essence, vector[essence]),
  );
}

export function chip(text: string, variant = 'plain'): HTMLElement {
  return el('span', { class: `chip ${variant}`, text });
}

/**
 * A grade, in the colour of that grade.
 *
 * The colours used to be set inline from a map in here, which meant a grade
 * printed anywhere other than through this function came out as plain text —
 * and three panels did exactly that, in slot captions. Moving them onto
 * `data-grade` in the stylesheet lets any element carry a grade's colour, and
 * keeps a scale that has to read as a scale in one place.
 */
export function gradeBadge(grade: Grade): HTMLElement {
  const node = el('span', {
    class: 'grade',
    text: grade,
    'aria-label': t('common.grade', { grade }),
  });
  node.dataset.grade = grade;
  return node;
}

/**
 * An amount of gold, in gold.
 *
 * A node rather than a string, so the colour travels with the number. Sites
 * that fold a price into a translated sentence keep using `formatGold` and stay
 * the colour of the sentence — half a coloured sentence reads worse than none.
 */
export function goldText(value: number, extraClass = ''): HTMLElement {
  return el('span', { class: `gold num ${extraClass}`.trim(), text: formatGold(value) });
}

/**
 * Stands in for a value while a translated sentence is assembled.
 *
 * A control character, so it can never collide with anything a translator might
 * legitimately write.
 */
export const VALUE_MARK = '\u0000';

/**
 * A sentence with its marked value handed back as its own node.
 *
 * A line like "You will earn 40 Mastery." is one translated string with the
 * number already inside it, so there is no element to decorate — and building
 * the sentence from fragments would put word order in the code instead of the
 * language file. Substituting `VALUE_MARK` for the number lets the finished
 * sentence be cut around it afterwards, which keeps the whole line in `en.json`
 * where it belongs.
 */
export function splitOnValue(sentence: string, value: Node): Array<Node | string> {
  const pieces = sentence.split(VALUE_MARK);
  const out: Array<Node | string> = [];
  pieces.forEach((piece, index) => {
    if (index > 0) out.push(value);
    if (piece) out.push(piece);
  });
  return out;
}

export interface RowOptions {
  title: Array<Node | string>;
  sub?: Array<Node | string>;
  actions?: HTMLElement[];
  ready?: boolean;
  blocked?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

export function row(options: RowOptions): HTMLElement {
  const classes = ['row'];
  if (options.ready) classes.push('is-ready');
  if (options.blocked) classes.push('is-blocked');

  const main = el('div', { class: 'row-main' }, [
    el('div', { class: 'row-title' }, options.title),
    ...(options.sub ? [el('div', { class: 'row-sub' }, options.sub)] : []),
  ]);

  const children: HTMLElement[] = [main];
  if (options.actions?.length) {
    children.push(el('div', { class: 'row-actions' }, options.actions));
  }

  const node = el('div', { class: classes.join(' ') }, children);
  if (options.selected) node.dataset.selected = 'true';
  if (options.onClick) {
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.addEventListener('click', options.onClick);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        options.onClick?.();
      }
    });
  }
  return node;
}

export function meter(fraction: number, over = false): HTMLElement {
  const fill = el('div', { class: `meter-fill${over ? ' over' : ''}` });
  fill.style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
  return el('div', { class: 'meter' }, [fill]);
}

export function emptyState(title: string, hint: string): HTMLElement {
  return el('div', { class: 'empty-state' }, [
    el('strong', { text: title }),
    el('span', { text: hint }),
  ]);
}

export function field(label: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    control,
  ]);
}

export interface OptionSpec {
  label: string;
  detail?: string;
  selected: boolean;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}

/**
 * A row of mutually exclusive choices.
 *
 * Unavailable options are shown disabled with a reason rather than hidden — the
 * player should learn that a cap exists before they run into it.
 */
export function optionGroup(options: OptionSpec[]): HTMLElement {
  const nodes = options.map((option) => {
    const children: Array<Node | string> = [el('span', { text: option.label })];
    if (option.detail) children.push(el('small', { text: option.detail }));

    const node = el('button', { class: 'option', type: 'button' }, children);
    node.setAttribute('aria-pressed', String(option.selected));
    if (option.disabled) node.disabled = true;
    if (option.title) node.title = option.title;
    node.addEventListener('click', option.onSelect);
    return node;
  });

  return el('div', { class: 'options' }, nodes);
}

export interface CollapsibleSpec {
  /** Extra classes for the section, so existing per-section styling still lands. */
  className?: string;
  title?: string;
  note?: string;
  /**
   * A ready-made heading, for a section that already had one worth keeping —
   * the Cauldron's numbered steps, say. Used instead of `title`/`note`.
   */
  head?: HTMLElement[];
  open: boolean;
  onToggle: () => void;
  body: HTMLElement[];
}

/**
 * A section that folds away.
 *
 * The whole header is the control rather than a separate chevron: a heading a
 * player already reads is a bigger target than a 16px arrow beside it, and on a
 * phone that difference is the whole feature.
 *
 * Openness is the caller's state, not the element's — the panels here are
 * rebuilt wholesale on every change, so a `<details>` would spring back open
 * the moment anything else on the screen moved.
 */
export function collapsible(spec: CollapsibleSpec): HTMLElement {
  /*
   * A div with a button's role, not a `<button>`.
   *
   * A heading handed in whole — the Cauldron's step head is a div wrapping a
   * number and two lines — cannot legally live inside a button, and a browser
   * that reparses it would take it back out. The role and the key handler give
   * the same behaviour on markup that stays valid.
   */
  const head = el('div', { class: 'collapsible-head', role: 'button', tabindex: '0' }, [
    el('span', { class: 'collapsible-caret', text: '▾', 'aria-hidden': 'true' }),
    ...(spec.head ?? [
      el('span', { class: 'field-label', text: spec.title ?? '' }),
      ...(spec.note ? [el('span', { class: 'field-note', text: spec.note })] : []),
    ]),
  ]);
  head.setAttribute('aria-expanded', String(spec.open));
  head.addEventListener('click', spec.onToggle);
  head.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    spec.onToggle();
  });

  /*
   * The body is wrapped, so it can scroll on its own.
   *
   * Without a box of its own there is nothing to give a height to, and a long
   * section pushes everything under it off the panel — which on the Roster means
   * the Send button, the one control the screen exists for.
   */
  const section = el('section', { class: `collapsible ${spec.className ?? ''}`.trim() }, [
    head,
    ...(spec.open ? [el('div', { class: 'collapsible-body' }, spec.body)] : []),
  ]);
  section.dataset.open = String(spec.open);
  return section;
}

/** A subtitle is optional; a screen that explains itself doesn't need one. */
export function panelHeader(title: string, subtitle?: string): HTMLElement {
  return el('div', { class: 'panel-head' }, [
    el('h2', { text: title }),
    ...(subtitle ? [el('p', { text: subtitle })] : []),
  ]);
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.firstChild.remove();
}

/** A numbered step heading, for the cauldron's three stages. */
export function stepHeader(index: number, title: string, hint?: string): HTMLElement {
  return el('div', { class: 'step-head' }, [
    el('span', { class: 'step-num', text: String(index) }),
    el('div', {}, [
      el('span', { class: 'step-title', text: title }),
      ...(hint ? [el('span', { class: 'step-hint', text: hint })] : []),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Icon inventory
// ---------------------------------------------------------------------------

export interface SlotSpec {
  /** Stable identity, used as the drag payload. */
  id: string;
  /** Big glyph or short label drawn in the tile. */
  icon: Node | string;
  /** Count badge; omitted when 1 or undefined. */
  count?: number;
  label: string;
  /**
   * Small line under the tile, e.g. a freshness stage.
   *
   * Nodes as well as text, because a caption is often a grade beside a price
   * and both of those carry a colour that a plain string would throw away.
   */
  caption?: Array<Node | string> | string;
  tone?: 'default' | 'warn' | 'good';
  selected?: boolean;
  disabled?: boolean;
  /** Tooltip / accessible description. */
  title?: string;
  onActivate?: () => void;
  /** Set to make the tile draggable with this payload type. */
  dragType?: string;
}

/**
 * One inventory tile.
 *
 * Draggable where a drop target exists, but the tap path is what's built first:
 * every tile is a button, so a tile can always be used without dragging. Drag is
 * the accelerator, never the only route.
 */
export function slot(spec: SlotSpec): HTMLElement {
  const children: Array<Node | string> = [
    el('span', { class: 'slot-icon' }, [
      typeof spec.icon === 'string' ? document.createTextNode(spec.icon) : spec.icon,
    ]),
    el('span', { class: 'slot-label', text: spec.label }),
  ];

  if (spec.caption) {
    children.push(
      typeof spec.caption === 'string'
        ? el('span', { class: 'slot-caption', text: spec.caption })
        : el('span', { class: 'slot-caption' }, spec.caption),
    );
  }
  if (spec.count !== undefined && spec.count > 1) {
    children.push(el('span', { class: 'slot-count', text: `${spec.count}` }));
  }

  const node = el('button', { class: 'slot', type: 'button' }, children);
  if (spec.tone && spec.tone !== 'default') node.dataset.tone = spec.tone;
  if (spec.selected) node.dataset.selected = 'true';
  if (spec.disabled) node.disabled = true;
  if (spec.title) node.title = spec.title;

  if (spec.onActivate && !spec.disabled) {
    node.addEventListener('click', spec.onActivate);
  }

  if (spec.dragType && !spec.disabled) {
    node.draggable = true;
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData(spec.dragType!, spec.id);
      // A plain-text fallback keeps the drag valid in browsers that ignore
      // custom types until drop, which is most of them during dragover.
      event.dataTransfer?.setData('text/plain', spec.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      node.dataset.dragging = 'true';
    });
    node.addEventListener('dragend', () => delete node.dataset.dragging);
  }

  return node;
}

export interface QuantityActionSpec {
  /** The verb, e.g. "Buy" or "Plant". */
  label: string;
  /** The largest number the player may take. A max of 1 hides the stepper. */
  max: number;
  /** Per-unit cost, when there is one. Shown as a running total. */
  unitPrice?: number;
  /** Why the action cannot be taken, if it cannot. */
  blocked?: string;
  run: (quantity: number) => void;
}

/**
 * The foot of a details panel: how many, and the verb.
 *
 * Buying used to be the tile's own click, one unit per tap, which made a stack
 * of twelve a drum solo and gave you no way to see what a thing was before you
 * owned one. The count lives here instead, next to the total it costs and the
 * description it belongs to.
 */
export function quantityAction(spec: QuantityActionSpec): HTMLElement {
  let quantity = 1;
  const row = el('div', { class: 'quantity-action' });

  const total = el('span', { class: 'quantity-total' });
  const count = el('span', { class: 'quantity-count num' });

  const step = (glyph: string, delta: number, label: string) => {
    const b = el('button', { class: 'quantity-step', type: 'button', 'aria-label': label, text: glyph });
    b.addEventListener('click', () => {
      quantity = Math.min(spec.max, Math.max(1, quantity + delta));
      draw();
    });
    return b;
  };

  const minus = step('−', -1, t('quantity.fewer'));
  const plus = step('+', 1, t('quantity.more'));
  const go = button(spec.label, () => spec.run(quantity), {
    variant: 'gold',
    disabled: Boolean(spec.blocked),
  });

  function draw(): void {
    count.textContent = String(quantity);
    minus.disabled = quantity <= 1;
    plus.disabled = quantity >= spec.max;
    total.textContent =
      spec.unitPrice === undefined ? '' : formatGold(spec.unitPrice * quantity);
    go.textContent = spec.label;
  }

  if (spec.blocked) {
    row.append(el('span', { class: 'quantity-blocked', text: spec.blocked }), go);
    draw();
    return row;
  }

  // One of a thing is not a quantity, so it gets no stepper to say so.
  if (spec.max > 1) row.append(el('div', { class: 'quantity-steps' }, [minus, count, plus]));
  if (spec.unitPrice !== undefined) row.append(total);
  row.append(go);
  draw();
  return row;
}

export function slotGrid(slots: HTMLElement[], emptyMessage?: string): HTMLElement {
  if (slots.length === 0 && emptyMessage) {
    return el('p', { class: 'grid-empty', text: emptyMessage });
  }
  return el('div', { class: 'slot-grid' }, slots);
}

/**
 * Make an element accept a dragged slot.
 *
 * `dragover` must be cancelled for a drop to fire at all — the single most
 * common reason HTML drag-and-drop silently does nothing.
 */
export function makeDropTarget(
  node: HTMLElement,
  dragType: string,
  onDrop: (id: string) => void,
): void {
  node.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(dragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    node.dataset.dropTarget = 'active';
  });

  node.addEventListener('dragleave', () => delete node.dataset.dropTarget);

  node.addEventListener('drop', (event) => {
    const id = event.dataTransfer?.getData(dragType);
    delete node.dataset.dropTarget;
    if (!id) return;
    event.preventDefault();
    onDrop(id);
  });
}

/** A labelled key/value line, for readouts that aren't tables. */
export function stat(label: string, value: Node | string, tone?: string): HTMLElement {
  const node = el('div', { class: 'stat-line' }, [
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value' }, [
      typeof value === 'string' ? document.createTextNode(value) : value,
    ]),
  ]);
  if (tone) node.dataset.tone = tone;
  return node;
}
