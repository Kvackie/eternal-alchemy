/**
 * Walk every screen at every size and report what is wrong with it.
 *
 * `npm run test:ui`. Separate from `npm test` on purpose: this needs a browser
 * and a dev server, and the simulation suite is worth keeping at two seconds.
 *
 * Pass `--size=phone` or `--screen=market` to narrow it while chasing one
 * thing; with no arguments it checks everything and exits non-zero if any
 * check has a complaint.
 */

import {
  checkIdleChurn,
  checkOverflow,
  checkScrollMemory,
  checkStrings,
  checkTapTargets,
  type Problem,
} from '../tests/browser/checks';
import { SCREENS, SIZES, goTo, launch, open, startServer, type SizeName } from '../tests/browser/harness';

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
      add('idle churn', await checkIdleChurn(page, CHURN_BUDGET));
      add('scroll memory', await checkScrollMemory(page));

      const found = problems.filter((p) => p.screen === screen && p.size === size).length;
      console.log(`${size.padEnd(8)} ${screen.padEnd(9)} ${found === 0 ? 'ok' : `${found} problems`}`);
    }

    for (const error of errors) problems.push({ screen: '-', size, check: 'console', detail: error });
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

      for (const detail of await checkOverflow(page)) {
        problems.push({ screen: 'market (day)', size, check: 'overflow', detail });
      }
      for (const detail of await checkStrings(page)) {
        problems.push({ screen: 'market (day)', size, check: 'strings', detail });
      }
      if (SIZES[size].mobile) {
        for (const detail of await checkTapTargets(page)) {
          problems.push({ screen: 'market (day)', size, check: 'tap targets', detail });
        }
      }
      for (const error of errors) {
        problems.push({ screen: 'market (day)', size, check: 'console', detail: error });
      }

      const found = problems.filter((p) => p.screen === 'market (day)' && p.size === size).length;
      console.log(`${size.padEnd(8)} ${'market+day'.padEnd(9)} ${found === 0 ? 'ok' : `${found} problems`}`);
      await close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (problems.length === 0) {
  console.log(`\nNothing to report: ${sizes.length} sizes x ${screens.length} screens.`);
  process.exit(0);
}

console.log(`\n${problems.length} problems:\n`);
for (const { size, screen, check, detail } of problems) {
  console.log(`  [${size}/${screen}] ${check}: ${detail}`);
}
process.exit(1);
