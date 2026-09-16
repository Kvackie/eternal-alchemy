/**
 * The world clock and the day cycle.
 *
 * World time is a plain millisecond counter. Every phase, weekday and timer in
 * the game is derived from it, so "what time is it" and "what time would it be
 * after 72 hours away" are the same question asked twice.
 */

import { config } from './config';
import type { DayPhase } from './types';

export interface DayState {
  /** Whole in-game days elapsed since world time zero. */
  dayNumber: number;
  /** 0..1 through the current day. */
  fraction: number;
  phase: DayPhase;
  /** Weekday id from config.clock.weekdays. */
  weekday: string;
  /** World time at which the current phase ends. */
  phaseEndsAt: number;
}

const PHASE_IDS: DayPhase[] = ['dawn', 'day', 'dusk', 'night'];

function phaseAt(fraction: number): { phase: DayPhase; index: number } {
  const phases = config.clock.phases;
  let index = 0;
  for (let i = 0; i < phases.length; i += 1) {
    const entry = phases[i];
    if (entry && fraction >= entry.startFraction) index = i;
  }
  return { phase: PHASE_IDS[index] ?? 'day', index };
}

export function dayStateAt(now: number): DayState {
  const dayMs = config.clock.dayLengthMs;
  const dayNumber = Math.floor(now / dayMs);
  const fraction = (now % dayMs) / dayMs;
  const { phase, index } = phaseAt(fraction);

  const phases = config.clock.phases;
  const nextStart = phases[index + 1]?.startFraction ?? 1;
  const phaseEndsAt = dayNumber * dayMs + nextStart * dayMs;

  const weekdays = config.clock.weekdays;
  const weekday = weekdays[dayNumber % weekdays.length] ?? 'toilday';

  return { dayNumber, fraction, phase, weekday, phaseEndsAt };
}

export function isNight(now: number): boolean {
  return dayStateAt(now).phase === 'night';
}

/** Merchants keep daylight hours — the Ashwalker is the sole exception, added in M2. */
export function merchantsAvailable(now: number): boolean {
  return !isNight(now);
}

/** World time of the next occurrence of a phase, at or after `now`. */
export function nextPhaseStart(now: number, phase: DayPhase): number {
  const dayMs = config.clock.dayLengthMs;
  const index = PHASE_IDS.indexOf(phase);
  const start = config.clock.phases[index]?.startFraction ?? 0;
  const dayNumber = Math.floor(now / dayMs);
  const candidate = dayNumber * dayMs + start * dayMs;
  return candidate > now ? candidate : candidate + dayMs;
}

/** How far through the current phase we are, 0..1. Drives the lighting blend. */
export function phaseProgress(now: number): number {
  const state = dayStateAt(now);
  const dayMs = config.clock.dayLengthMs;
  const phases = config.clock.phases;
  const index = PHASE_IDS.indexOf(state.phase);
  const start = (phases[index]?.startFraction ?? 0) * dayMs + state.dayNumber * dayMs;
  const end = state.phaseEndsAt;
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export function formatDuration(ms: number): { hours: number; minutes: number; seconds: number } {
  const clamped = Math.max(0, Math.floor(ms / 1000));
  return {
    hours: Math.floor(clamped / 3600),
    minutes: Math.floor((clamped % 3600) / 60),
    seconds: clamped % 60,
  };
}
