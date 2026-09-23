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
  | { type: 'confirm'; request: ConfirmRequest }
  /** The debug switch in Settings moved. */
  | { type: 'debug'; enabled: boolean }
  | { type: 'toast'; message: string };

/**
 * A question the shell asks before something is undone.
 *
 * It goes through the bus rather than being built where it is needed, because
 * the panels are torn down and rebuilt on every world change — a dialog
 * appended next to the button that raised it would vanish on the first tick.
 * The shell owns it, as it already owns the away dialog, and outlives the
 * render that asked for it.
 */
export interface ConfirmRequest {
  title: string;
  body: string;
  /** The label on the button that goes through with it. */
  confirm: string;
  /**
   * Red rather than amber on the button that goes through.
   *
   * For the questions where the answer takes something away, so the dialog
   * wears the colour the control that raised it already wore.
   */
  danger?: boolean;
  onConfirm: () => void;
}

import type { AwaySummary } from '@/sim/sim';

export type ScreenId =
  'shop' | 'board' | 'market' | 'grounds' | 'cauldron' | 'roster' | 'ledger' | 'settings';

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

/**
 * Shorthand for the commonest event — something changed, redraw.
 *
 * Coalesced to the next frame rather than emitted where it is called. Every
 * panel is rebuilt wholesale on a world change, so emitting synchronously tears
 * the pressed button out of the document while its own click is still being
 * dispatched — and a browser that delivers a second click for one tap, which
 * Android's WebView does when the element under the finger is replaced, lands
 * that second click on the *replacement*. That is how one tap on the roster's
 * `+` packed two bottles. Deferring keeps the pressed button alive for the whole
 * gesture, and collapses a burst of changes into a single render.
 */
let redrawPending = false;

export function changed(): void {
  if (redrawPending) return;
  redrawPending = true;

  const flush = () => {
    redrawPending = false;
    bus.emit({ type: 'world:changed' });
  };

  // `requestAnimationFrame` is absent outside a browser — tests, and the save
  // importer running under Node — where emitting straight away is correct.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
  else flush();
}

export function toast(message: string): void {
  bus.emit({ type: 'toast', message });
}

/** Ask before doing something that cannot be taken back. */
export function confirm(request: ConfirmRequest): void {
  bus.emit({ type: 'confirm', request });
}
