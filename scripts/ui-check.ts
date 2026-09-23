/**
 * Walk every screen, sub-view and dialog at every size and report what is
 * wrong with any of them.
 *
 * Three passes: each screen as it lands; each view in `tests/browser/views.ts`
 * (the other tabs, the station's halves, every dialog), from a freshly loaded
 * fixture so one view's presses cannot change what the next one sees; and a
 * brand-new shop, whose empty states are the first screens anyone sees.
 *
 * `npm run test:ui`. Separate from `npm test` on purpose: this needs a browser
 * and a dev server, and the simulation suite is worth keeping at two seconds.
 *
 * Pass `--size=phone` or `--screen=market` to narrow it while chasing one
 * thing (a screen's views and its fresh-game landing come along with it); with
 * no arguments it checks everything and exits non-zero if any check has a
 * complaint.
 */

import {
  checkCoveredControls,
  checkIdleChurn,
  checkOverflow,
  checkScrollMemory,
  checkStrings,
  checkTapTargets,
  type Problem,
} from '../tests/browser/checks';
import { buildFreshSave } from '../tests/browser/fixture';
import {
  SCREENS,
  SIZES,
  closeDialogs,
  dismiss,
  goTo,
  launch,
  open,
  startServer,
  type SizeName,
} from '../tests/browser/harness';
import { VIEWS } from '../tests/browser/views';
import type { Page } from 'playwright-core';

/**
 * How still an idle screen has to be.
 *
 * Not zero: the Market retextes a merchant's countdown, which is one element
 * changing a few times in two seconds and is the whole point of patching in
 * place rather than redrawing. Anything an order of magnitude above that is a
 * screen rebuilding itself on the frame loop.
 */
const CHURN_BUDGET = 40;

function arg(name: string): string | undefined {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found?.split('=')[1];
}

const onlySize = arg('size') as SizeName | undefined;
const onlyScreen = arg('screen');

const sizes = (Object.keys(SIZES) as SizeName[]).filter((size) => !onlySize || size === onlySize);
const screens = SCREENS.filter((screen) => !onlyScreen || screen === onlyScreen);

/** The checks every view gets. Churn and scroll memory are the landings' own. */
async function measure(page: Page, screen: string, size: SizeName, touch: boolean) {
  const add = (check: string, details: string[]) => {
    for (const detail of details) problems.push({ screen, size, check, detail });
  };
  add('overflow', await checkOverflow(page));
  add('strings', await checkStrings(page));
  if (touch) add('tap targets', await checkTapTargets(page));
  add('covered controls', await checkCoveredControls(page));
}

const server = await startServer();
const browser = await launch();
const problems: Problem[] = [];

try {
  for (const size of sizes) {
    const { page, errors, close } = await open(browser, size);
    const touch = SIZES[size].mobile;

    for (const screen of screens) {
      await goTo(page, screen);
      await page.waitForTimeout(450);

      const add = (check: string, details: string[]) => {
        for (const detail of details) problems.push({ screen, size, check, detail });
      };

      add('overflow', await checkOverflow(page));
      add('strings', await checkStrings(page));
      // Only where a finger is the pointer: on a mouse a 36px button is a
      // deliberate weight, not an obstacle.
      if (touch) add('tap targets', await checkTapTargets(page));
      add('covered controls', await checkCoveredControls(page));
      add('idle churn', await checkIdleChurn(page, CHURN_BUDGET));
      add('scroll memory', await checkScrollMemory(page));

      const found = problems.filter((p) => p.screen === screen && p.size === size).length;
      console.log(
        `${size.padEnd(8)} ${screen.padEnd(9)} ${found === 0 ? 'ok' : `${found} problems`}`,
      );
    }

    for (const error of errors)
      problems.push({ screen: '-', size, check: 'console', detail: error });
    await close();
  }

  /*
   * The views: every tab, half and dialog one press or more past a landing.
   * Reloaded before each, so the fixture is what every one of them starts
   * from — a bottling window's last button bottles, and the next view should
   * not inherit that.
   */
  const views = VIEWS.filter((view) => !onlyScreen || view.screen === onlyScreen);
  for (const size of sizes) {
    const { page, errors, close } = await open(browser, size);
    const touch = SIZES[size].mobile;

    for (const view of views) {
      const label = `${view.screen}: ${view.name}`;
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await dismiss(page);
      await goTo(page, view.screen);

      const reached = await view.open(page, touch).catch(() => false);
      if (!reached) {
        problems.push({ screen: label, size, check: 'view', detail: 'could not open it' });
      } else {
        await page.waitForTimeout(300);
        await measure(page, label, size, touch);
      }
      await closeDialogs(page);

      const found = problems.filter((p) => p.screen === label && p.size === size).length;
      console.log(
        `${size.padEnd(8)} ${label.padEnd(26)} ${found === 0 ? 'ok' : `${found} problems`}`,
      );
    }

    for (const error of errors)
      problems.push({ screen: 'views', size, check: 'console', detail: error });
    await close();
  }

  /*
   * The market again, in daylight.
   *
   * The fixture's clock is night, which is the only time the barter trader is
   * in town — and the only time nobody is carrying something you cannot afford
   * yet. A blocked tile puts a sentence where a price goes and is the longest
   * thing a tile ever holds, so it is exactly what a width check wants to see.
   */
  if (!onlyScreen || onlyScreen === 'market') {
    for (const size of sizes) {
      const { page, errors, close } = await open(browser, size, 'day');
      await goTo(page, 'market');
      await page.waitForTimeout(450);
      await measure(page, 'market (day)', size, SIZES[size].mobile);
      for (const error of errors) {
        problems.push({ screen: 'market (day)', size, check: 'console', detail: error });
      }
      const found = problems.filter((p) => p.screen === 'market (day)' && p.size === size).length;
      console.log(
        `${size.padEnd(8)} ${'market (day)'.padEnd(26)} ${found === 0 ? 'ok' : `${found} problems`}`,
      );
      await close();
    }
  }

  /*
   * A brand-new shop. The greeting is measured as it arrives, then every
   * screen in its empty first-morning state.
   */
  for (const size of sizes) {
    const { page, errors, close } = await open(browser, size, 'day', {
      save: buildFreshSave(),
      keepOverlays: true,
    });
    const touch = SIZES[size].mobile;
    if ((await page.locator('.overlay').count()) > 0) {
      await measure(page, 'fresh: greeting', size, touch);
      await closeDialogs(page);
    }
    for (const screen of screens) {
      const label = `fresh: ${screen}`;
      await goTo(page, screen);
      await page.waitForTimeout(450);
      await measure(page, label, size, touch);

      /*
       * And again at the far end of every list, which is where the checklist's
       * pill decides whether the last row is reachable at all: on landing it
       * covers something by floating, at the bottom it covers something by
       * being in the way.
       */
      await page.evaluate(() => {
        for (const node of document.querySelectorAll('#panels *')) {
          const overflow = getComputedStyle(node).overflowY;
          if (overflow === 'auto' || overflow === 'scroll') node.scrollTop = node.scrollHeight;
        }
      });
      await page.waitForTimeout(150);
      for (const detail of await checkCoveredControls(page)) {
        problems.push({ screen: label, size, check: 'covered at the end of the scroll', detail });
      }

      const found = problems.filter((p) => p.screen === label && p.size === size).length;
      console.log(
        `${size.padEnd(8)} ${label.padEnd(26)} ${found === 0 ? 'ok' : `${found} problems`}`,
      );
    }
    for (const error of errors)
      problems.push({ screen: 'fresh', size, check: 'console', detail: error });
    await close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (problems.length === 0) {
  console.log(
    `\nNothing to report: ${sizes.length} sizes x (${screens.length} screens, ` +
      `${VIEWS.filter((view) => !onlyScreen || view.screen === onlyScreen).length} views, ` +
      `a fresh game).`,
  );
  process.exit(0);
}

console.log(`\n${problems.length} problems:\n`);
for (const { size, screen, check, detail } of problems) {
  console.log(`  [${size}/${screen}] ${check}: ${detail}`);
}
process.exit(1);
