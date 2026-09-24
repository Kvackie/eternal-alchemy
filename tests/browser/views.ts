/**
 * Everything the sweep looks at beyond the eight screens themselves.
 *
 * A screen is only its landing view. Most of what a player reads lives one
 * press further in — the other tab, the half of the station a phone hides, a
 * dialog — and none of that was ever measured, so a chip could run out of a
 * dialog or a button hide behind another for as long as nobody happened to open
 * it by hand. Each view here is one press sequence from a screen's landing view
 * to something worth measuring.
 *
 * A view says whether it got there. One that cannot find its way in is a
 * problem in its own right: the control it needed has moved or gone.
 */

import type { Page } from 'playwright-core';
import type { ScreenId } from '@/ui/bus';
import type { Clock } from './fixture';

export interface View {
  screen: ScreenId;
  name: string;
  /** The fixture's clock to open it at; night unless it says otherwise. */
  clock?: Clock;
  /** Press whatever gets there; false if something on the way was missing. */
  open: (page: Page, touch: boolean) => Promise<boolean>;
}

/** Click the first match, if there is one. */
async function press(page: Page, selector: string, text?: RegExp): Promise<boolean> {
  let target = page.locator(selector);
  if (text) target = target.filter({ hasText: text });
  if ((await target.count()) === 0) return false;
  await target.first().click({ timeout: 3000 });
  await page.waitForTimeout(350);
  return true;
}

const dialogOpen = async (page: Page) => (await page.locator('.overlay').count()) > 0;

/** Into the station for a given pot, from the bench. */
async function station(page: Page, pot: RegExp): Promise<boolean> {
  return press(page, '.bench-card', pot);
}

export const VIEWS: View[] = [
  // -- Shop
  { screen: 'shop', name: 'inventory', open: (page) => press(page, '[role=tab]', /Inventory/) },
  {
    screen: 'shop',
    name: 'shelf dialog',
    open: async (page) => (await press(page, '.slot')) && dialogOpen(page),
  },
  {
    screen: 'shop',
    name: 'stock dialog',
    open: async (page) =>
      (await press(page, '[role=tab]', /Inventory/)) &&
      (await press(page, '.slot')) &&
      dialogOpen(page),
  },

  // -- Board
  {
    screen: 'board',
    name: 'abandon',
    open: async (page) => (await press(page, 'button', /^Abandon$/)) && dialogOpen(page),
  },

  // -- Market
  {
    screen: 'market',
    name: 'goods',
    open: async (page) => (await press(page, '.slot')) && dialogOpen(page),
  },
  // Only a day trader buys, so the other side of the counter is a daylight view.
  {
    screen: 'market',
    name: 'sell',
    clock: 'day',
    open: (page) => press(page, '[role=tab]', /^Sell$/),
  },
  {
    screen: 'market',
    name: 'sell dialog',
    clock: 'day',
    open: async (page) =>
      (await press(page, '[role=tab]', /^Sell$/)) &&
      (await press(page, '.merchant-sell .slot')) &&
      dialogOpen(page),
  },

  // -- Grounds
  { screen: 'grounds', name: 'cave', open: (page) => press(page, '[role=tab]', /^Cave$/) },
  { screen: 'grounds', name: 'quarry', open: (page) => press(page, '[role=tab]', /^Quarry$/) },
  {
    screen: 'grounds',
    name: 'seed',
    open: async (page) => (await press(page, '.slot')) && dialogOpen(page),
  },
  {
    screen: 'grounds',
    name: 'soil picker',
    open: async (page) =>
      (await press(page, '.slot')) &&
      (await press(page, '.overlay button', /Plant/)) &&
      dialogOpen(page),
  },
  {
    screen: 'grounds',
    name: 'seed picker',
    open: async (page) => (await press(page, '.plot button', /^Plant$/)) && dialogOpen(page),
  },

  // -- Alchemy
  { screen: 'cauldron', name: 'station', open: (page) => station(page, /Filling/) },
  {
    screen: 'cauldron',
    name: 'station book',
    open: async (page, touch) => {
      if (!(await station(page, /Filling/))) return false;
      // On a phone the book is the other half of the station.
      if (touch && !(await press(page, '[role=tab]', /recipes/i))) return false;
      return press(page, '.recipe-unknown-list .collapsible-head');
    },
  },
  {
    screen: 'cauldron',
    name: 'bottled',
    // Bottling asks nothing: pressing a Ready card bottles, and the bench is
    // what is left to look at — with no pot still saying Ready.
    open: async (page) =>
      (await station(page, /Ready/)) &&
      !(await dialogOpen(page)) &&
      (await page.locator('.bench-card').filter({ hasText: /Ready/ }).count()) === 0,
  },
  {
    screen: 'cauldron',
    name: 'ingredient',
    open: async (page) =>
      (await station(page, /Filling/)) &&
      (await press(page, '.ingredient-details')) &&
      dialogOpen(page),
  },

  // -- Roster
  {
    screen: 'roster',
    name: 'reward',
    open: async (page) => (await press(page, 'button', /Claim rewards/)) && dialogOpen(page),
  },
  {
    screen: 'roster',
    name: 'hero',
    open: async (page) => (await press(page, '.row.hero')) && dialogOpen(page),
  },
  { screen: 'roster', name: 'destination', open: (page) => press(page, '.slot', /Emberwaste/) },

  // -- Settings
  {
    screen: 'settings',
    name: 'codex',
    open: async (page) => (await press(page, '.codex-card')) && dialogOpen(page),
  },
  { screen: 'settings', name: 'debug', open: (page) => press(page, '.debug-toggle') },
];
