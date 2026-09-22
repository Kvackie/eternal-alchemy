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
