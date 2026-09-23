/**
 * Scroll positions surviving a rebuild.
 *
 * The panels are thrown away and built again on every world change, so keeping
 * the reader's place is a matter of recognising, in the new tree, the node that
 * was scrolled in the old one. That recognition is pure tree-walking — no
 * layout, no styles — which is why it can be tested here without a browser.
 *
 * The stand-in below is only the handful of properties the walk actually reads.
 * A real `Element` brings a DOM implementation this project does not otherwise
 * need, and the thing under test is the key, not the rendering.
 */

import { describe, expect, it } from 'vitest';
import { captureScroll, restoreScroll } from '@/ui/dom/scroll';

interface Fake {
  tagName: string;
  className: string;
  dataset: Record<string, string | undefined>;
  scrollTop: number;
  scrollLeft: number;
  children: Fake[];
}

function node(tagName: string, className = '', children: Fake[] = [], keepScroll?: string): Fake {
  return {
    tagName,
    className,
    dataset: keepScroll === undefined ? {} : { keepScroll },
    scrollTop: 0,
    scrollLeft: 0,
    children,
  };
}

/** A child by path, so the tests read as trees rather than as index checks. */
function at(root: Fake, ...path: number[]): Fake {
  let cursor = root;
  for (const step of path) {
    const next = cursor.children[step];
    if (!next) throw new Error(`no child ${step} of ${cursor.className || cursor.tagName}`);
    cursor = next;
  }
  return cursor;
}

const capture = (root: Fake) => captureScroll(root as unknown as Element);
const restore = (root: Fake, memory: ReturnType<typeof capture>) =>
  restoreScroll(root as unknown as Element, memory);

describe('keeping the reader’s place across a rebuild', () => {
  it('puts a nested scroller back where it was', () => {
    const before = node('DIV', 'panels', [
      node('DIV', 'panel panel-roomy', [
        node('DIV', 'panel-body', [node('DIV', 'collapsible-body')]),
      ]),
    ]);
    at(before, 0, 0, 0).scrollTop = 340;

    const memory = capture(before);
    const after = node('DIV', 'panels', [
      node('DIV', 'panel panel-roomy', [
        node('DIV', 'panel-body', [node('DIV', 'collapsible-body')]),
      ]),
    ]);
    restore(after, memory);

    expect(at(after, 0, 0, 0).scrollTop).toBe(340);
  });

  it('keeps the panel itself, which is the scroller below the breakpoint', () => {
    const before = node('DIV', 'panels', [
      node('DIV', 'panel panel-roomy', [node('DIV', 'panel-body')]),
    ]);
    at(before, 0).scrollTop = 120;

    const after = node('DIV', 'panels', [
      node('DIV', 'panel panel-roomy', [node('DIV', 'panel-body')]),
    ]);
    restore(after, capture(before));

    expect(at(after, 0).scrollTop).toBe(120);
  });

  it('tells apart two scrollers that sit side by side', () => {
    const pair = () =>
      node('DIV', 'panels', [
        node('DIV', 'panel-pair', [
          node('DIV', 'panel', [node('DIV', 'panel-body')]),
          node('DIV', 'panel', [node('DIV', 'panel-body')]),
        ]),
      ]);

    const before = pair();
    at(before, 0, 1, 0).scrollTop = 500;

    const after = pair();
    restore(after, capture(before));

    expect(at(after, 0, 0, 0).scrollTop).toBe(0);
    expect(at(after, 0, 1, 0).scrollTop).toBe(500);
  });

  it('is not thrown off by a badge appearing beside the list', () => {
    const before = node('DIV', 'panels', [node('DIV', 'panel', [node('DIV', 'panel-body')])]);
    at(before, 0, 0).scrollTop = 90;

    // The rebuild added a header the first tree had not got.
    const after = node('DIV', 'panels', [
      node('DIV', 'panel', [node('DIV', 'panel-head'), node('DIV', 'panel-body')]),
    ]);
    restore(after, capture(before));

    expect(at(after, 0, 1).scrollTop).toBe(90);
  });

  it('follows a named scroller that has moved within its parent', () => {
    const before = node('DIV', 'panels', [
      node('DIV', 'panel', [
        node('DIV', 'station-col', [], 'stores'),
        node('DIV', 'station-col', [], 'recipes'),
      ]),
    ]);
    at(before, 0, 1).scrollTop = 210;

    // The pot changed what it was doing, so the columns came back in another order.
    const after = node('DIV', 'panels', [
      node('DIV', 'panel', [
        node('DIV', 'station-col', [], 'recipes'),
        node('DIV', 'station-col', [], 'stores'),
      ]),
    ]);
    restore(after, capture(before));

    expect(at(after, 0, 0).scrollTop).toBe(210);
    expect(at(after, 0, 1).scrollTop).toBe(0);
  });

  it('drops a position whose element the rebuild did not produce', () => {
    const before = node('DIV', 'panels', [node('DIV', 'panel', [node('DIV', 'panel-body')])]);
    at(before, 0, 0).scrollTop = 400;

    // A different screen entirely: nothing here was scrolled, and nothing should be.
    const after = node('DIV', 'panels', [node('DIV', 'panel panel-full', [node('DIV', 'bench')])]);
    restore(after, capture(before));

    expect(at(after, 0).scrollTop).toBe(0);
    expect(at(after, 0, 0).scrollTop).toBe(0);
  });

  it('records nothing when nothing has been scrolled', () => {
    const tree = node('DIV', 'panels', [node('DIV', 'panel', [node('DIV', 'panel-body')])]);
    expect(capture(tree).size).toBe(0);
  });

  it('keeps sideways scroll too, which is what the nav does on a phone', () => {
    const before = node('NAV', 'nav', [node('BUTTON'), node('BUTTON')]);
    before.scrollLeft = 64;

    const after = node('NAV', 'nav', [node('BUTTON'), node('BUTTON')]);
    restore(after, capture(before));

    expect(after.scrollLeft).toBe(64);
  });
});
