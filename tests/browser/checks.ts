/**
 * What is worth measuring on a screen, and what counts as wrong.
 *
 * Each check is one thing that has actually broken here, written so the answer
 * is a list of specific complaints rather than a pass/fail — a report that says
 * "the chip in the Sixth plot tile is 30px wider than its tile" is a fix; one
 * that says "layout wrong" is a second investigation.
 */

import type { Page } from 'playwright-core';
import { TAP } from './harness';

export interface Problem {
  screen: string;
  size: string;
  check: string;
  detail: string;
}

/** Anything drawn outside the window, and any sideways scroll on the page. */
export async function checkOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const width = window.innerWidth;

    for (const node of document.querySelectorAll('#panels *')) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > width + 1 || box.left < -1) {
        const name = node.className || node.tagName;
        out.push(`${name} "${(node.textContent ?? '').slice(0, 28).trim()}" spills past the window`);
      }
    }

    if (document.documentElement.scrollWidth > width + 1) out.push('the page scrolls sideways');
    return [...new Set(out)];
  });
}

/**
 * Translation keys left on screen.
 *
 * `t()` renders a key it does not know as the key itself, which is a sensible
 * fallback and an invisible bug: "cauldron.buy.locked" reads as text, lays out
 * as text and is only wrong if somebody notices it is not English.
 */
export async function checkStrings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const text = document.getElementById('panels')?.textContent ?? '';
    const found = [...text.matchAll(/\b[a-z][a-zA-Z]+(?:\.[a-zA-Z][a-zA-Z0-9]+){2,}\b/g)];
    return [...new Set(found.map((match) => `untranslated: ${match[0]}`))];
  });
}

/** Controls a thumb has to hit, measured only where there is a thumb. */
export async function checkTapTargets(page: Page, tap: number = TAP): Promise<string[]> {
  return page.evaluate((min) => {
    const seen = new Map<string, number>();
    for (const node of document.querySelectorAll('#panels button, #panels input')) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.height < min || box.width < min) {
        const key = `${node.className || node.tagName} at ${Math.round(box.width)}x${Math.round(box.height)}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    return [...seen].map(([key, count]) => `${key}${count > 1 ? ` (x${count})` : ''}`);
  }, tap);
}

/**
 * Controls with something parked on top of them.
 *
 * A few things float over the panel — the checklist, the zoom controls, the
 * debug toggle — and a floating thing is, by construction, over whatever was
 * there first. The onboarding checklist spent a while as a card in the bottom
 * corner that covered two rows of cave beds and quietly ate the taps meant for
 * them: nothing overflowed, nothing was too small, and it was still broken.
 *
 * The centre of a control is the test. A control whose middle belongs to
 * something else is one you cannot press.
 */
export async function checkCoveredControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Map<string, number>();
    const controls = '#panels .panel button, #panels .panel input, #panels .panel [role="tab"]';

    /*
     * What of a control is actually on the screen.
     *
     * A control scrolled half out of its own scroller still has a full box,
     * and asking what sits at the middle of that box answers with whatever is
     * painted at those coordinates — the canvas below the panel, the nav under
     * it. That is the control not being there, not something covering it. So
     * clip the box against every ancestor that clips, and against the window,
     * and ask about the middle of what is left.
     */
    const visible = (node: Element): DOMRect | null => {
      let rect = node.getBoundingClientRect();
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflow === 'visible') continue;
        const clip = parent.getBoundingClientRect();
        const left = Math.max(rect.left, clip.left);
        const top = Math.max(rect.top, clip.top);
        rect = new DOMRect(left, top, Math.min(rect.right, clip.right) - left, Math.min(rect.bottom, clip.bottom) - top);
        if (rect.width <= 0 || rect.height <= 0) return null;
      }
      const left = Math.max(rect.left, 0);
      const top = Math.max(rect.top, 0);
      rect = new DOMRect(
        left,
        top,
        Math.min(rect.right, window.innerWidth) - left,
        Math.min(rect.bottom, window.innerHeight) - top,
      );
      if (rect.width <= 0 || rect.height <= 0) return null;

      /*
       * A sliver is not a control. Scrolled to its last line, a 44px field can
       * leave two pixels showing at the edge of its scroller, and the middle of
       * those two pixels is outside the scroller entirely — which answers with
       * whatever is painted below it. A quarter of the box is the floor for
       * calling it visible at all.
       */
      const full = node.getBoundingClientRect();
      return rect.width * rect.height >= full.width * full.height * 0.25 ? rect : null;
    };

    for (const node of document.querySelectorAll(controls)) {
      const rect = visible(node);
      if (!rect) continue;

      const over = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (!over || node.contains(over) || over.contains(node)) continue;

      const name = (over.closest('[class]')?.className ?? over.tagName).toString().split(' ')[0];
      const key = `${(node.textContent ?? '').slice(0, 24).trim() || node.className} is under .${name}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen].map(([key, count]) => `${key}${count > 1 ? ` (x${count})` : ''}`);
  });
}

/**
 * How much the page rewrites itself while nobody is touching it.
 *
 * An idle screen should be almost still: clocks are patched in place and
 * nothing else has changed. A screen that churns is one rebuilding itself on
 * the frame loop, which is what made the Roster unclickable and the Shop
 * unscrollable — both of which read as "laggy" rather than as a redraw bug.
 */
export async function checkIdleChurn(page: Page, budget: number): Promise<string[]> {
  const churn = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const panels = document.getElementById('panels');
        if (!panels) return resolve(0);
        let count = 0;
        const observer = new MutationObserver((records) => {
          count += records.length;
        });
        observer.observe(panels, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 2000);
      }),
  );
  return churn > budget ? [`${churn} DOM changes in 2s while idle (budget ${budget})`] : [];
}

/**
 * Whether a press throws away where you were reading.
 *
 * Two ways to get this wrong, both of which report a bug that is not there.
 *
 * Measure against the position in the rebuilt page rather than against the node
 * that was measured: the press replaces that node, and a detached element
 * reports a scroll of zero, which looks exactly like the failure.
 *
 * And judge against what the new page can actually hold. Bringing a pot out of
 * storage makes the Alchemy page shorter than the window, so there is nowhere
 * to scroll to and zero is the only correct answer. The complaint is only that
 * the position was lost when it could have been kept.
 */
export async function checkScrollMemory(page: Page): Promise<string[]> {
  const SKIP = /Abandon|Deliver|Send|New game|Reset|Retire|Import|Export|Put away|Bottle|Buy/i;

  const locate = `(path) => {
    const sig = (e) => e.tagName + '.' + (e.className || '').split(/\\s+/).filter(Boolean).sort().join('.');
    let node = document.getElementById('panels');
    for (const step of path) {
      const m = /^(.*)\\[(\\d+)\\]$/.exec(step);
      const kids = [...node.children].filter((k) => sig(k) === m[1]);
      node = kids[Number(m[2])];
      if (!node) return null;
    }
    return node;
  }`;

  const marked = await page.evaluate(() => {
    const sig = (e: Element) =>
      `${e.tagName}.${(e.className || '').split(/\s+/).filter(Boolean).sort().join('.')}`;
    let tallest: Element | null = null;
    for (const node of document.querySelectorAll('#panels *')) {
      if (node.scrollHeight > node.clientHeight + 60) {
        tallest = node;
        break;
      }
    }
    if (!tallest) return null;

    const path: string[] = [];
    for (let node: Element | null = tallest; node && node.id !== 'panels'; node = node.parentElement) {
      const siblings = [...(node.parentElement?.children ?? [])].filter((s) => sig(s) === sig(node!));
      path.unshift(`${sig(node)}[${siblings.indexOf(node)}]`);
    }
    tallest.scrollTop = Math.min(140, tallest.scrollHeight - tallest.clientHeight);
    return { path, top: tallest.scrollTop };
  });
  if (!marked || marked.top === 0) return [];

  const pressed = await page.evaluate(
    ([path, find, skip]) => {
      const locate = eval(`(${find})`) as (p: string[]) => Element | null;
      const node = locate(path as string[]);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      for (const button of node.querySelectorAll('button:not([disabled])')) {
        const rect = button.getBoundingClientRect();
        if (rect.top < box.top || rect.bottom > box.bottom || rect.height === 0) continue;
        if (new RegExp(skip as string, 'i').test(button.textContent ?? '')) continue;
        (button as HTMLElement).click();
        return (button.textContent ?? 'a button').slice(0, 24);
      }
      return null;
    },
    [marked.path, locate, SKIP.source] as const,
  );
  if (pressed === null) return [];

  await page.waitForTimeout(550);
  const now = await page.evaluate(
    ([path, find]) => {
      const locate = eval(`(${find})`) as (p: string[]) => Element | null;
      const node = locate(path as string[]);
      if (!node) return null;
      return { top: node.scrollTop, max: node.scrollHeight - node.clientHeight };
    },
    [marked.path, locate] as const,
  );
  if (!now) return [`pressing "${pressed}" left no scroller where one was`];

  const keepable = Math.min(marked.top, now.max);
  return now.top >= keepable
    ? []
    : [
        `pressing "${pressed}" moved the scroll from ${marked.top} to ${now.top}, ` +
          `when ${keepable} was still reachable`,
      ];
}
