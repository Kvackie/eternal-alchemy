import { describe, expect, it } from 'vitest';
import {
  dayStateAt,
  isNight,
  merchantsAvailable,
  nextPhaseStart,
  phaseProgress,
} from '@/sim/clock';
import { config } from '@/sim/config';
import { DAY } from './helpers';

describe('the day cycle', () => {
  it('starts at dawn on day zero', () => {
    const state = dayStateAt(0);
    expect(state.dayNumber).toBe(0);
    expect(state.phase).toBe('dawn');
  });

  it('runs dawn, day, dusk, night in order across one day', () => {
    expect(dayStateAt(DAY * 0.02).phase).toBe('dawn');
    expect(dayStateAt(DAY * 0.3).phase).toBe('day');
    expect(dayStateAt(DAY * 0.7).phase).toBe('dusk');
    expect(dayStateAt(DAY * 0.9).phase).toBe('night');
  });

  it('gives night roughly a quarter of the day', () => {
    let nightSamples = 0;
    const samples = 1000;
    for (let i = 0; i < samples; i += 1) {
      if (isNight((DAY * i) / samples)) nightSamples += 1;
    }
    expect(nightSamples / samples).toBeCloseTo(0.25, 2);
  });

  it('cycles weekdays and wraps at the week length', () => {
    expect(dayStateAt(0).weekday).toBe(config.clock.weekdays[0]);
    expect(dayStateAt(DAY * 2).weekday).toBe('marketday');
    // The week is however many weekdays are declared — a separate count could
    // silently disagree with the list, so there is no separate count.
    const week = config.clock.weekdays.length;
    expect(dayStateAt(DAY * week).weekday).toBe(dayStateAt(0).weekday);
  });
});

describe('merchant hours', () => {
  it('closes merchants at night and opens them otherwise', () => {
    expect(merchantsAvailable(DAY * 0.3)).toBe(true);
    expect(merchantsAvailable(DAY * 0.9)).toBe(false);
  });
});

describe('phase navigation', () => {
  it('finds the next dawn strictly in the future', () => {
    const now = DAY * 1.5;
    const next = nextPhaseStart(now, 'dawn');
    expect(next).toBeGreaterThan(now);
    expect(dayStateAt(next).phase).toBe('dawn');
  });

  it('reports progress through the current phase', () => {
    expect(phaseProgress(DAY * 0.75)).toBeCloseTo(0, 2);
    expect(phaseProgress(DAY * 0.99)).toBeGreaterThan(0.9);
  });
});
