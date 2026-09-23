/**
 * Driving the real page, for the things the simulation tests cannot see.
 *
 * Everything under `tests/` else runs against the simulation with no DOM at
 * all, which is fast and catches a great deal — and caught none of: a panel
 * capped at two thirds of the window, a chip running out of its tile, a filter
 * row eating a third of a phone, tap targets at 33px, or a scroll position
 * thrown away on every press. Those are all cheap to measure and were all
 * found by hand, repeatedly. This is that measuring, written down.
 *
 * Deliberately not part of `npm test`: it needs a browser and a dev server, and
 * the simulation suite is worth keeping at two seconds. See `npm run test:ui`.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { buildSave, type Clock } from './fixture';
import type { ScreenId } from '@/ui/bus';

export const SCREENS: ScreenId[] = [
  'shop',
  'board',
  'market',
  'grounds',
  'cauldron',
  'roster',
  'ledger',
  'settings',
];

/** The commitment: nothing a finger has to hit is smaller than this. */
export const TAP = 44;

export const SIZES = {
  desktop: { width: 1440, height: 900, mobile: false },
  wide: { width: 1920, height: 1080, mobile: false },
  phone: { width: 412, height: 883, mobile: true },
} as const;

export type SizeName = keyof typeof SIZES;

/**
 * Where Chromium actually is.
 *
 * `executablePath()` answers with the build this copy of playwright-core was
 * written against, which is not necessarily the build that is installed — on
 * this machine it names 1243 and 1194 is what exists. So: the env var if it is
 * set, then whatever is really in the browsers directory, then playwright's
 * own guess as a last resort.
 */
export function resolveChromium(): string {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    for (const dir of readdirSync(root).filter((name) => name.startsWith('chromium-'))) {
      for (const layout of [
        'chrome-linux/chrome',
        'chrome-linux64/chrome',
        'chrome-win/chrome.exe',
      ]) {
        const candidate = join(root, dir, layout);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  return chromium.executablePath();
}

export interface Harness {
  page: Page;
  /** Everything the page logged as an error, and everything it threw. */
  errors: string[];
  close: () => Promise<void>;
}

export async function startServer(): Promise<ViteDevServer> {
  const server = await createServer({
    server: { port: 5178, host: '127.0.0.1', strictPort: true },
    logLevel: 'warn',
  });
  await server.listen();
  return server;
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: resolveChromium() });
}

/**
 * Open the game at a size.
 *
 * `save` replaces the fixture — the fresh-game pass loads a brand new shop —
 * and `keepOverlays` leaves whatever greets the player on screen, so the
 * greeting itself can be measured.
 */
export async function open(
  browser: Browser,
  size: SizeName,
  clock: Clock = 'night',
  options: { save?: string; keepOverlays?: boolean } = {},
): Promise<Harness> {
  const { width, height, mobile } = SIZES[size];
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: mobile,
    isMobile: mobile,
  });

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`threw: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`logged: ${message.text()}`);
  });

  await page.addInitScript(
    (save: string) => {
      try {
        localStorage.setItem('eternal-alchemy/save/0', save);
        localStorage.setItem('eternal-alchemy/slot', '0');
      } catch {
        /* Private mode, which the game already survives. */
      }
    },
    options.save ?? buildSave(clock),
  );

  await page.goto('http://127.0.0.1:5178/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  if (!options.keepOverlays) await dismiss(page);

  return { page, errors, close: () => context.close() };
}

/**
 * Close every open dialog the way a player would, with Escape.
 *
 * Unlike `dismiss`, which presses a dialog's last button — the right way to
 * get past a greeting, and the wrong way to leave a bottling window, whose last
 * button bottles.
 */
export async function closeDialogs(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if ((await page.locator('.overlay').count()) === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

/** Clear the away summary, the checklist, or whatever dialog is in the way. */
export async function dismiss(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const overlay = page.locator('.overlay').last();
    if ((await overlay.count()) === 0) return;
    const button = overlay.locator('button').last();
    if ((await button.count()) === 0) return;
    await button.click({ force: true, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(220);
  }
}

const NAV: Record<ScreenId, RegExp> = {
  shop: /Shop/,
  board: /Board/,
  market: /Market/,
  grounds: /Grounds/,
  cauldron: /Alchemy|Cauldron/,
  roster: /Roster/,
  ledger: /Ledger/,
  settings: /Settings/,
};

export async function goTo(page: Page, screen: ScreenId): Promise<void> {
  await page
    .locator('nav button, .nav button, #nav button')
    .filter({ hasText: NAV[screen] })
    .first()
    .click({ timeout: 5000 });
  await page.waitForTimeout(450);
  await dismiss(page);
}
