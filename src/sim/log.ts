/**
 * The shop's log.
 *
 * Every notable thing that happens gets a line, so the Ledger can answer "what
 * happened while I was away" and "where did my gold come from" without the
 * player having to have been watching. Entries carry a kind and parameters, not
 * a sentence — formatting happens at render time, in the reader's language.
 */

import type { LogEntry, LogKind, World } from './types';

/**
 * How many lines to keep.
 *
 * The log lives in the save, and a shelf can sell a hundred times overnight, so
 * this is a real bound rather than a formality. Two thousand lines is a few
 * hundred kilobytes at worst and covers many sessions of scrollback.
 */
export const LOG_CAP = 2000;

export function record(
  world: World,
  kind: LogKind,
  params: Record<string, string | number> = {},
): LogEntry {
  const entry: LogEntry = { id: world.nextLogId, at: world.now, kind, params };
  world.nextLogId += 1;
  world.log.push(entry);

  if (world.log.length > LOG_CAP) {
    world.log.splice(0, world.log.length - LOG_CAP);
  }
  return entry;
}

export interface LogPage {
  entries: LogEntry[];
  page: number;
  pageCount: number;
  total: number;
}

/**
 * One page of the log, newest first.
 *
 * Pages are counted from the newest end so that page 1 stays page 1 as new
 * entries arrive — paging from the old end would shuffle everything underneath
 * the reader every time something sold.
 */
export function logPage(world: World, page: number, pageSize: number, kinds?: LogKind[]): LogPage {
  const filtered = kinds?.length
    ? world.log.filter((entry) => kinds.includes(entry.kind))
    : world.log;

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(Math.max(1, page), pageCount);

  const newestFirst = [...filtered].reverse();
  const start = (clamped - 1) * pageSize;

  return {
    entries: newestFirst.slice(start, start + pageSize),
    page: clamped,
    pageCount,
    total,
  };
}
