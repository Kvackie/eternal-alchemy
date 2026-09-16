/**
 * The intent bus.
 *
 * The two halves of the UI — Phaser scenes and DOM panels — never call each
 * other. They both talk to the simulation and both listen here. That keeps the
 * canvas replaceable and stops panel code from reaching into scene internals.
 */

export type GameEvent =
  | { type: 'world:changed' }
  | { type: 'screen:changed'; screen: ScreenId }
  | { type: 'brew:ready' }
  /** Time was caught up after an absence — real or simulated by the debug panel. */
  | { type: 'away'; summary: AwaySummary }
  | { type: 'toast'; message: string };

import type { AwaySummary } from '@/sim/sim';

export type ScreenId =
  | 'shop'
  | 'board'
  | 'market'
  | 'grounds'
  | 'cauldron'
  | 'roster'
  | 'ledger'
  | 'settings';

type Handler = (event: GameEvent) => void;

class Bus {
  private handlers = new Set<Handler>();

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: GameEvent): void {
    // Copy first: a handler may unsubscribe during dispatch.
    for (const handler of [...this.handlers]) handler(event);
  }
}

export const bus = new Bus();

/** Shorthand for the commonest event — something changed, redraw. */
export function changed(): void {
  bus.emit({ type: 'world:changed' });
}

export function toast(message: string): void {
  bus.emit({ type: 'toast', message });
}
