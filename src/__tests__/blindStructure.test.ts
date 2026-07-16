import { describe, expect, it } from 'vitest';
import {
  blindLevelsOnly,
  generateBlindStructure,
  scheduleDurationMins,
  type BlindStructureParams,
} from '../index.js';

const BASE: BlindStructureParams = {
  playerCount: 8,
  startingStack: 10_000,
  tournamentLengthHrs: 3,
  levelDurationMins: 15,
  chipDenoms: [25, 100, 500, 1_000, 5_000],
  breakFrequency: 4,
  breakDurationMins: 10,
  includeChipUp: true,
  blindFactor: 1,
  roundingThresholdFactor: 1,
  bbRule: 'double',
  anteRule: 'none',
};

const params = (overrides: Partial<BlindStructureParams> = {}): BlindStructureParams => ({
  ...BASE,
  ...overrides,
});

describe('generateBlindStructure', () => {
  it('produces a schedule of levels and breaks', () => {
    const schedule = generateBlindStructure(params());
    expect(schedule.length).toBeGreaterThan(0);
    expect(blindLevelsOnly(schedule).length).toBeGreaterThan(0);
    for (const entry of schedule) {
      expect(entry).toHaveProperty('level');
      expect(entry).toHaveProperty('type');
      expect(entry.durationMins).toBeGreaterThan(0);
    }
  });

  it('numbers blind levels consecutively from 1', () => {
    const levels = blindLevelsOnly(generateBlindStructure(params()));
    expect(levels.map((l) => l.level)).toEqual(levels.map((_, i) => i + 1));
  });

  it('escalates blinds monotonically', () => {
    const levels = blindLevelsOnly(generateBlindStructure(params()));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].bigBlind, `level ${i + 1}`).toBeGreaterThanOrEqual(levels[i - 1].bigBlind);
      expect(levels[i].smallBlind, `level ${i + 1}`).toBeGreaterThanOrEqual(levels[i - 1].smallBlind);
    }
  });

  // The bug this package was extracted to fix: when the rounding base
  // promoted to the next denomination while the small blind was under
  // half of it, Math.round() floored the blind to zero — a level with
  // blinds of 0/0 in the middle of a live tournament.
  it('never emits a zero blind, whatever the denominations', () => {
    const denomSets = [
      [25, 100, 500, 1_000, 5_000],
      [100, 500, 1_000, 5_000, 25_000],
      [1, 5, 25, 100],
      [5, 25, 100, 500, 1_000],
      [25],
    ];
    for (const chipDenoms of denomSets) {
      for (const blindFactor of [0.8, 1, 1.2, 1.5]) {
        for (const roundingThresholdFactor of [0.8, 1, 1.2]) {
          for (const playerCount of [2, 9, 37]) {
            const levels = blindLevelsOnly(
              generateBlindStructure(
                params({ chipDenoms, blindFactor, roundingThresholdFactor, playerCount }),
              ),
            );
            const label = `${JSON.stringify(chipDenoms)} bf=${blindFactor} rtf=${roundingThresholdFactor} n=${playerCount}`;
            for (const level of levels) {
              expect(level.smallBlind, `${label} level ${level.level}`).toBeGreaterThan(0);
              expect(level.bigBlind, `${label} level ${level.level}`).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it('only ever uses payable chip denominations', () => {
    const chipDenoms = [25, 100, 500, 1_000, 5_000];
    const smallest = Math.min(...chipDenoms);
    const levels = blindLevelsOnly(generateBlindStructure(params({ chipDenoms })));
    for (const level of levels) {
      expect(level.smallBlind % smallest, `level ${level.level} sb`).toBe(0);
      expect(level.bigBlind % smallest, `level ${level.level} bb`).toBe(0);
    }
  });

  it('opens at the smallest denomination', () => {
    const levels = blindLevelsOnly(generateBlindStructure(params({ chipDenoms: [25, 100, 500] })));
    expect(levels[0].smallBlind).toBe(25);
    expect(levels[0].bigBlind).toBe(50);
  });

  it('fills roughly the requested time, plus the padding hour', () => {
    const schedule = generateBlindStructure(
      params({ tournamentLengthHrs: 3, levelDurationMins: 15, breakFrequency: 0 }),
    );
    // 3h + 1h padding = 240 min / 15 = 16 levels.
    expect(blindLevelsOnly(schedule)).toHaveLength(16);
    expect(scheduleDurationMins(schedule)).toBe(240);
  });

  it('inserts a break every breakFrequency levels, but never trailing', () => {
    const schedule = generateBlindStructure(params({ breakFrequency: 4, breakDurationMins: 10 }));
    expect(schedule[schedule.length - 1].type).toBe('blind');

    const positions = schedule
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => entry.type !== 'blind');
    for (const { entry } of positions) {
      expect(entry.level % 4).toBe(0);
      expect(entry.durationMins).toBe(10);
    }
    expect(positions.length).toBeGreaterThan(0);
  });

  it('omits breaks when not requested', () => {
    const schedule = generateBlindStructure(params({ breakFrequency: 0 }));
    expect(schedule.every((e) => e.type === 'blind')).toBe(true);
  });

  it('marks a break as chip-up when the denomination promotes', () => {
    const schedule = generateBlindStructure(params({ includeChipUp: true }));
    expect(schedule.some((e) => e.type === 'chip-up')).toBe(true);
  });

  it('emits plain breaks when chip-ups are disabled', () => {
    const schedule = generateBlindStructure(params({ includeChipUp: false }));
    expect(schedule.some((e) => e.type === 'chip-up')).toBe(false);
    expect(schedule.some((e) => e.type === 'break')).toBe(true);
  });

  describe('big blind rules', () => {
    it('doubles the small blind exactly when bbRule is double', () => {
      const levels = blindLevelsOnly(generateBlindStructure(params({ bbRule: 'double' })));
      for (const l of levels) expect(l.bigBlind, `level ${l.level}`).toBe(l.smallBlind * 2);
    });

    it('keeps the big blind at least 1.5x the small blind', () => {
      const levels = blindLevelsOnly(generateBlindStructure(params({ bbRule: 'min1_5x' })));
      for (const l of levels) {
        expect(l.bigBlind, `level ${l.level}`).toBeGreaterThanOrEqual(l.smallBlind * 1.5);
      }
    });
  });

  describe('antes', () => {
    it('emits no ante when anteRule is none', () => {
      const levels = blindLevelsOnly(generateBlindStructure(params({ anteRule: 'none' })));
      for (const l of levels) expect(l.ante).toBe(0);
    });

    it('matches the small blind', () => {
      const levels = blindLevelsOnly(generateBlindStructure(params({ anteRule: 'match_sb' })));
      for (const l of levels) expect(l.ante, `level ${l.level}`).toBe(l.smallBlind);
    });

    it('matches the big blind', () => {
      const levels = blindLevelsOnly(generateBlindStructure(params({ anteRule: 'match_bb' })));
      for (const l of levels) expect(l.ante, `level ${l.level}`).toBe(l.bigBlind);
    });

    it('never exceeds the big blind or falls below the smallest chip', () => {
      const chipDenoms = [25, 100, 500, 1_000, 5_000];
      for (const antePercent of [10, 12.5, 20, 200]) {
        const levels = blindLevelsOnly(
          generateBlindStructure(params({ anteRule: 'bb_percent', antePercent, chipDenoms })),
        );
        for (const l of levels) {
          expect(l.ante, `pct=${antePercent} level ${l.level}`).toBeLessThanOrEqual(l.bigBlind);
          expect(l.ante, `pct=${antePercent} level ${l.level}`).toBeGreaterThanOrEqual(25);
        }
      }
    });
  });

  describe('invalid input', () => {
    it.each([
      ['no chip denominations', { chipDenoms: [] }],
      ['non-positive denominations', { chipDenoms: [0, 100] }],
      ['negative denominations', { chipDenoms: [-25, 100] }],
      ['zero blind factor', { blindFactor: 0 }],
      ['zero rounding threshold', { roundingThresholdFactor: 0 }],
      ['zero level duration', { levelDurationMins: 0 }],
      ['negative level duration', { levelDurationMins: -15 }],
    ])('returns an empty schedule for %s', (_label, overrides) => {
      expect(generateBlindStructure(params(overrides as Partial<BlindStructureParams>))).toEqual([]);
    });

    it('still produces a structure for a zero-length tournament, thanks to the padding hour', () => {
      const schedule = generateBlindStructure(params({ tournamentLengthHrs: 0 }));
      expect(blindLevelsOnly(schedule).length).toBeGreaterThan(0);
    });

    it('handles a single scheduled level without dividing by zero', () => {
      const schedule = generateBlindStructure(
        params({ tournamentLengthHrs: 0, levelDurationMins: 60, breakFrequency: 0 }),
      );
      const levels = blindLevelsOnly(schedule);
      expect(levels).toHaveLength(1);
      expect(levels[0].smallBlind).toBeGreaterThan(0);
      expect(Number.isFinite(levels[0].bigBlind)).toBe(true);
    });
  });
});
