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
 * A minimum grade, written the short way.
 *
 * "D or better" in a badge inside a chip is two boxes and three words around a
 * single letter — on a contract card that is the loudest thing in a row of
 * terms, and it is the least of them. "D+" says it, in the colour the grade
 * already has, with nothing drawn around it.
 */
export function gradeFloor(grade: Grade): HTMLElement {
  const node = el('span', { class: 'grade-floor', text: `${grade}+` });
  node.dataset.grade = grade;
  node.setAttribute('aria-label', t('common.gradeOrBetter', { grade }));
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

/**
 * The card that a list is made of.
 *
 * Optional picture, a title, a line of chips under it, sometimes a meter, and
 * the buttons that act on it. Every list in the game is made of these — plots,
 * seams, heroes, missions, contracts, walk-ins, shelves — and until now every
 * one of them built its own out of `.plot-main` and `.plot-title`, which is
 * why a Quarry seam was marked up as a garden plot.
 *
 * `variant` is the family name. It carries only what that family does
 * differently: a contract's coloured left edge, a shelf stacking downwards.
 * The card itself is this.
 */
export interface RowOptions {
  /** plot, vein, hero, mission, contract, walkin, shelf — the family class. */
  variant?: string;
  /** Drawn at the leading edge, at a fixed width so titles line up. */
  icon?: Node;
  title: Array<Node | string> | string;
  sub?: Array<Node | string>;
  /** Below the chips: a meter, a bar, whatever this row measures. */
  extra?: Array<Node | string>;
  actions?: Array<HTMLElement | null | undefined>;
  ready?: boolean;
  blocked?: boolean;
  selected?: boolean;
  onClick?: () => void;
  /** Anything else the family needs, e.g. `{ working: 'true' }`. */
  data?: Record<string, string>;
}

export function row(options: RowOptions): HTMLElement {
  const classes = ['row'];
  if (options.variant) classes.push(options.variant);
  if (options.ready) classes.push('is-ready');
  if (options.blocked) classes.push('is-blocked');

  const main = el('div', { class: 'row-main' }, [
    el('div', { class: 'row-title' }, typeof options.title === 'string' ? [options.title] : options.title),
    ...(options.sub?.length ? [el('div', { class: 'row-sub' }, options.sub)] : []),
    ...(options.extra ?? []),
  ]);

  const actions = (options.actions ?? []).filter((node): node is HTMLElement => node != null);
  const node = el('div', { class: classes.join(' ') }, [
    ...(options.icon ? [el('span', { class: 'row-icon' }, [options.icon])] : []),
    main,
    ...(actions.length > 0 ? [el('div', { class: 'row-actions' }, actions)] : []),
  ]);

  if (options.selected) node.dataset.selected = 'true';
  for (const [key, value] of Object.entries(options.data ?? {})) node.dataset[key] = value;

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

export interface TabSpec {
  id: string;
  label: string;
}

/**
 * A strip of tabs, with the semantics a strip of tabs is supposed to have.
 *
 * Three screens built one of these by hand out of buttons carrying
 * `aria-pressed`, which is the markup for a toggle — it tells a screen reader
 * "this button is pushed in", not "this is one of four views and you are on the
 * second". A tab list also answers the arrow keys, which is how anyone
 * navigating by keyboard expects to move between them: a strip where Tab has
 * to be pressed four times to reach the fourth view is a strip of buttons
 * wearing a tab's clothes.
 *
 * Selection follows focus, which is the right choice when switching is cheap
 * and reversible — every one of these swaps a panel that is already built.
 *
 * `aria-controls` points every tab at the one panel, because only the selected
 * view is in the document. See `tabPanel`.
 */
export function tabStrip(spec: {
  name: string;
  tabs: TabSpec[];
  current: string;
  onSelect: (id: string) => void;
  className?: string;
}): HTMLElement {
  const strip = el('div', {
    class: spec.className ? `options tabs ${spec.className}` : 'options tabs',
    role: 'tablist',
  });

  const buttons = spec.tabs.map((tab) => {
    const selected = tab.id === spec.current;
    const node = el('button', { class: 'option', type: 'button', role: 'tab' }, [
      el('span', { text: tab.label }),
    ]);
    node.id = `${spec.name}-tab-${tab.id}`;
    node.setAttribute('aria-selected', String(selected));
    node.setAttribute('aria-controls', `${spec.name}-panel`);
    /*
     * Named for the shell's focus memory, so the caret comes back.
     *
     * Choosing a tab rebuilds the panel, which throws away the button that was
     * focused — after one arrow press the focus was on nothing and a second
     * press went to the document. See `captureFocus`.
     */
    node.dataset.keepFocus = `${spec.name}-tab-${tab.id}`;
    // Roving: one stop for the whole strip, and the arrows move within it.
    node.tabIndex = selected ? 0 : -1;
    node.addEventListener('click', () => spec.onSelect(tab.id));
    return node;
  });

  buttons.forEach((node, index) => {
    node.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      let next = -1;
      if (step !== 0) next = (index + step + spec.tabs.length) % spec.tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = spec.tabs.length - 1;
      if (next < 0) return;

      event.preventDefault();
      /*
       * Focus moves before the selection does.
       *
       * The shell records where the caret is at the start of a render and puts
       * it back afterwards, so the tab that is about to be selected has to be
       * the focused one *now* for it to be the focused one after.
       */
      buttons[next]!.focus();
      spec.onSelect(spec.tabs[next]!.id);
    });
  });

  strip.append(...buttons);
  return strip;
}

/** The view a strip of tabs is showing, named by the tab that chose it. */
export function tabPanel(name: string, current: string, children: HTMLElement[]): HTMLElement {
  const panel = el('div', { class: 'tab-panel', role: 'tabpanel' }, children);
  panel.id = `${name}-panel`;
  panel.setAttribute('aria-labelledby', `${name}-tab-${current}`);
  return panel;
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

/**
 * The line above a list: what it is, a remark, and what you can do to it.
 *
 * Ten sections built this by hand out of a `.stores-head` wrapping a
 * `.field-label` and a `.field-note`, and the two that also wanted a button
 * had to remember that the button goes inside the head rather than under it.
 */
export function sectionHead(
  label: string,
  note?: string,
  ...actions: Array<HTMLElement | null | undefined>
): HTMLElement {
  return el('div', { class: 'stores-head' }, [
    el('span', { class: 'field-label', text: label }),
    ...(note ? [el('span', { class: 'field-note', text: note })] : []),
    ...actions.filter((node): node is HTMLElement => node != null),
  ]);
}

/**
 * One line saying a list is empty, where a whole empty state is too much.
 *
 * `emptyState` is the two-line version, for a screen with nothing on it;
 * this is the note inside a section that happens to have no rows today.
 */
export function emptyNote(text: string): HTMLElement {
  return el('p', { class: 'grid-empty', text });
}

/**
 * Previous, "page 2 of 7", next.
 *
 * Five copies of this existed, each twenty lines, each with its own page
 * variable and its own idea of how to clamp it — which is five places to get
 * the disabled state of the last page wrong.
 */
export function pager(spec: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  /** The Ledger's pages run backwards through time, so it says Newer/Older. */
  prev?: string;
  next?: string;
}): HTMLElement {
  const go = (page: number) => spec.onChange(Math.min(spec.pageCount, Math.max(1, page)));
  return el('div', { class: 'pager' }, [
    button(spec.prev ?? t('common.page.prev'), () => go(spec.page - 1), {
      variant: 'quiet',
      small: true,
      disabled: spec.page <= 1,
    }),
    el('span', {
      class: 'pager-label num',
      text: t('common.page.of', { page: spec.page, count: spec.pageCount }),
    }),
    button(spec.next ?? t('common.page.next'), () => go(spec.page + 1), {
      variant: 'quiet',
      small: true,
      disabled: spec.page >= spec.pageCount,
    }),
  ]);
}

/**
 * A row of chips where exactly one is on.
 *
 * Distinct from `optionGroup`, which is a row of cells sized to a grid: this
 * is the lighter thing that sits above a list to say how it is ordered.
 */
export function chipRow<T extends string>(spec: {
  options: ReadonlyArray<{ id: T; label: string }>;
  current: T;
  onPick: (id: T) => void;
}): HTMLElement {
  return el(
    'div',
    { class: 'sort-row' },
    spec.options.map(({ id, label }) => {
      const node = el('button', { class: 'sort-chip', type: 'button', text: label });
      node.setAttribute('aria-pressed', String(spec.current === id));
      node.addEventListener('click', () => spec.onPick(id));
      return node;
    }),
  );
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.firstChild.remove();
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
  /**
   * Unavailable, but still worth opening.
   *
   * Reads like `disabled` and keeps its own click, which `disabled` does not.
   * A sold-out or rank-locked thing is exactly what a player wants to look at —
   * that is when they ask what it was and what it would take — and while the
   * tile was the corner dot's neighbour that still worked. Once the tile became
   * the only way in, `disabled` made those the only things you could not read.
   */
  dimmed?: boolean;
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
  if (spec.dimmed) node.dataset.dimmed = 'true';
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

/**
 * An on/off switch, for a setting that is simply on or off.
 *
 * `optionGroup` was standing in for this — two full-width cells reading Off and
 * On, which is the weight of a choice between five text sizes rather than of a
 * thing with two states. `role="switch"` is what a screen reader wants for the
 * same reason a track and a thumb are what an eye wants.
 */
export function toggleSwitch(spec: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}): HTMLElement {
  const node = el('button', { class: 'switch', type: 'button' }, [
    el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })]),
    el('span', { class: 'switch-label', text: spec.label }),
  ]);
  node.setAttribute('role', 'switch');
  node.setAttribute('aria-checked', String(spec.on));
  node.addEventListener('click', () => spec.onChange(!spec.on));
  return node;
}

export interface ModalSpec {
  /** Extra classes for the dialog box, e.g. a panel-specific layout. */
  className?: string;
  /** Built with its own way out, so a button inside can close it. */
  content: (dismiss: () => void) => Array<Node | string>;
  /** After it has gone. */
  onClose?: () => void;
}

/**
 * One modal, for every panel that needs one.
 *
 * There were ten of these, each with its own copy of the overlay, the dismiss
 * closure, the Escape handler, the backdrop-click guard and the mount. Three of
 * them registered a `keydown` listener and never removed it.
 *
 * All ten mounted into `#panels`, which `Shell.renderPanels()` clears on every
 * world change — so a dialog left open while a merchant left town was torn out
 * of the document without anything calling `dismiss`, stranding the listener
 * and the whole closure behind it. One of them worked around that by refusing
 * to call `changed()` until it closed. Mounting on the stage instead puts the
 * modal outside the container that gets rebuilt, which ends both problems: the
 * dialog survives a redraw, and closing it is the only thing that removes it.
 */
export function modal(spec: ModalSpec): () => void {
  const overlay = el('div', { class: 'overlay' });

  const dismiss = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    spec.onClose?.();
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') dismiss();
  }

  document.addEventListener('keydown', onKey);

  // A tap on the ground around the card is a way out, not a way through.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dismiss();
  });

  const dialog = el('div', {
    class: spec.className ? `dialog ${spec.className}` : 'dialog',
    role: 'dialog',
    'aria-modal': 'true',
  });
  dialog.append(...spec.content(dismiss));
  overlay.append(dialog);

  // The stage outlives the panels; `#panels` is the thing being rebuilt.
  const host = document.getElementById('stage') ?? document.getElementById('panels');
  host?.append(overlay);
  return dismiss;
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
  /** What it costs, where that is not a number of coins. */
  note?: string;
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

  /*
   * The count is typed into, not only stepped to.
   *
   * Taking forty of something at one press per unit is forty presses; at ten a
   * press it is four, and the player who knows they want forty should not have
   * to press anything. So the number is a field: tap it, type it, done. It is
   * `inputmode="numeric"` rather than `type="number"` because the spinner a
   * number input draws is a second, worse pair of steppers sitting next to
   * these ones, and it cannot be styled away portably.
   */
  const count = el('input', {
    class: 'quantity-count num',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    'aria-label': t('quantity.count'),
  });

  const step = (glyph: string, delta: number, label: string, wide = false) => {
    const b = el('button', {
      class: wide ? 'quantity-step wide' : 'quantity-step',
      type: 'button',
      'aria-label': label,
      text: glyph,
    });
    b.addEventListener('click', () => {
      set(quantity + delta);
    });
    return b;
  };

  const minusTen = step('−10', -10, t('quantity.fewer10'), true);
  const minus = step('−', -1, t('quantity.fewer'));
  const plus = step('+', 1, t('quantity.more'));
  const plusTen = step('+10', 10, t('quantity.more10'), true);
  const most = el('button', { class: 'quantity-step wide', type: 'button', text: t('quantity.max') });
  most.addEventListener('click', () => set(spec.max));

  const go = button(spec.label, () => spec.run(quantity), {
    variant: 'gold',
    disabled: Boolean(spec.blocked),
  });

  function set(next: number): void {
    quantity = Math.min(spec.max, Math.max(1, Math.round(next)));
    draw();
  }

  /** Everything but the field itself — see `draw`. */
  function refresh(): void {
    minus.disabled = quantity <= 1;
    minusTen.disabled = quantity <= 1;
    plus.disabled = quantity >= spec.max;
    plusTen.disabled = quantity >= spec.max;
    most.disabled = quantity >= spec.max;
    total.textContent = spec.unitPrice === undefined ? '' : formatGold(spec.unitPrice * quantity);
  }

  function draw(): void {
    count.value = String(quantity);
    refresh();
  }

  /*
   * Typing is clamped as it goes, but an empty field is left empty.
   *
   * Rewriting the box to "1" the instant it is cleared makes it impossible to
   * replace a two-digit number: you delete the second digit, the field snaps
   * back, and the first one is still there. So an empty box counts as one and
   * says nothing until the focus leaves.
   */
  count.addEventListener('input', () => {
    const digits = count.value.replace(/\D/g, '');
    if (digits === '') {
      quantity = 1;
      if (count.value !== '') count.value = '';
      refresh();
      return;
    }
    quantity = Math.min(spec.max, Math.max(1, Number(digits)));
    if (String(quantity) !== digits) count.value = String(quantity);
    refresh();
  });

  count.addEventListener('blur', () => draw());
  count.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    draw();
    if (!spec.blocked) spec.run(quantity);
  });

  if (spec.blocked) {
    row.append(el('span', { class: 'quantity-blocked', text: spec.blocked }), go);
    draw();
    return row;
  }

  // One of a thing is not a quantity, so it gets no stepper to say so. The
  // ten-at-a-time pair only appears where ten is a step worth having.
  if (spec.max > 1) {
    const steps = el('div', { class: 'quantity-steps' });
    if (spec.max > 10) steps.append(minusTen);
    steps.append(minus, count, plus);
    if (spec.max > 10) steps.append(plusTen);
    steps.append(most);
    row.append(steps);
  }
  if (spec.note) row.append(el('span', { class: 'quantity-note', text: spec.note }));
  if (spec.unitPrice !== undefined) row.append(total);
  row.append(go);
  draw();
  return row;
}

export function slotGrid(slots: HTMLElement[], emptyMessage?: string): HTMLElement {
  if (slots.length === 0 && emptyMessage) {
    return emptyNote(emptyMessage);
  }
  return el('div', { class: 'slot-grid' }, slots);
}

/**
 * Does this thing answer to what was typed?
 *
 * The terms are given by the caller rather than scraped from the tile, because
 * a tile's text also carries its price, its grade and its freshness — so typing
 * "50" would match every bottle worth fifty gold as well as every one named for
 * it. Blank matches everything, which is what an empty box should mean.
 */
export function matchesSearch(query: string, ...terms: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return terms.some((term) => term !== undefined && term.toLowerCase().includes(needle));
}

/**
 * A text filter over a list of tiles.
 *
 * Unlike the chip rows beside it this is an open question rather than a closed
 * list, so it gets a line of its own. `name` is what the shell puts the caret
 * back into after the rebuild every keystroke causes — see `captureFocus` —
 * which is what lets the filter be applied where the list is built, before it
 * is sorted and paged, rather than by hiding tiles that are already drawn.
 */
export function searchField(spec: {
  name: string;
  value: string;
  placeholder: string;
  onInput: (query: string) => void;
}): HTMLElement {
  const input = el('input', {
    class: 'search-input',
    type: 'search',
    placeholder: spec.placeholder,
    'aria-label': spec.placeholder,
    enterkeyhint: 'done',
    autocomplete: 'off',
  });
  input.dataset.keepFocus = spec.name;
  input.value = spec.value;
  input.addEventListener('input', () => spec.onInput(input.value));
  // A form-less input still submits on Enter in some engines, which reloads.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });

  return el('div', { class: 'search-row' }, [input]);
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
