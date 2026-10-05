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
      ['negative blind factor', { blindFactor: -1.4 }],
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

describe('blind levels always escalate', () => {
  // Regression: rounding to a coarse denomination could emit two identical
  // consecutive levels (e.g. 100/200 then 100/200 again) whenever the
  // geometric step was smaller than the rounding base. A level that doesn't
  // raise the blinds is 20 minutes of dead clock.
  const strictlyIncreasing = (p: BlindStructureParams): string | null => {
    const levels = blindLevelsOnly(generateBlindStructure(p));
    for (let i = 1; i < levels.length; i++) {
      const prev = levels[i - 1];
      const cur = levels[i];
      if (cur.smallBlind <= prev.smallBlind) {
        return `SB did not rise at level ${cur.level}: ${prev.smallBlind} -> ${cur.smallBlind}`;
      }
      if (cur.bigBlind <= prev.bigBlind) {
        return `BB did not rise at level ${cur.level}: ${prev.bigBlind} -> ${cur.bigBlind}`;
      }
    }
    return null;
  };

  it('never repeats the previous level (the reported 100/200 twice case)', () => {
    // Poker Hawk desktop defaults — reproduced L3==L4 and L6==L7 before the fix.
    expect(
      strictlyIncreasing(
        params({
          playerCount: 18,
          startingStack: 20_000,
          tournamentLengthHrs: 4,
          levelDurationMins: 20,
        }),
      ),
    ).toBeNull();
  });

  it('holds across a broad parameter sweep', () => {
    const failures: string[] = [];
    for (const playerCount of [2, 6, 9, 18, 45, 200]) {
      for (const startingStack of [1_000, 10_000, 20_000, 100_000]) {
        for (const tournamentLengthHrs of [1, 3, 4, 8]) {
          for (const levelDurationMins of [10, 15, 20, 30]) {
            for (const bbRule of ['double', 'min1_5x', 'none'] as const) {
              const failure = strictlyIncreasing(
                params({ playerCount, startingStack, tournamentLengthHrs, levelDurationMins, bbRule }),
              );
              if (failure) {
                failures.push(
                  `${playerCount}p/${startingStack}/${tournamentLengthHrs}h/${levelDurationMins}m/${bbRule}: ${failure}`,
                );
              }
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('holds across chip sets and rounding factors', () => {
    const failures: string[] = [];
    const chipSets = [
      [25, 100, 500, 1_000, 5_000],
      [1, 5, 25, 100],
      [100, 500, 1_000],
      [5, 25, 100, 500, 1_000, 5_000, 25_000],
    ];
    for (const chipDenoms of chipSets) {
      for (const roundingThresholdFactor of [0.5, 1, 1.5, 2]) {
        for (const blindFactor of [0.5, 1, 1.5]) {
          const failure = strictlyIncreasing(
            params({ chipDenoms, roundingThresholdFactor, blindFactor, playerCount: 18, startingStack: 20_000 }),
          );
          if (failure) {
            failures.push(`[${chipDenoms.join(',')}] rtf=${roundingThresholdFactor} bf=${blindFactor}: ${failure}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

// --- Property-test plumbing -------------------------------------------------

/** Small seeded PRNG (mulberry32) so every sweep is the same sweep. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHIP_SETS = [
  [25, 100, 500, 1_000, 5_000],
  [25, 100, 500, 1_000, 5_000, 25_000],
  [5, 25, 100, 500, 1_000],
  [1, 5, 25, 100, 500],
  [100, 500, 1_000, 5_000, 25_000],
  [25, 100, 1_000, 5_000],
  [50, 100, 500, 1_000, 5_000],
];

/** `count` deterministic, realistic parameter sets. */
function sampleParams(seed: number, count: number, blindFactor: () => number): BlindStructureParams[] {
  const rnd = seeded(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  return Array.from({ length: count }, () => ({
    playerCount: pick([6, 8, 9, 10, 18, 27, 36, 45, 60, 90, 120]),
    startingStack: pick([5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 50_000]),
    tournamentLengthHrs: pick([2, 2.5, 3, 4, 5, 6, 8]),
    levelDurationMins: pick([10, 12, 15, 20, 25, 30]),
    chipDenoms: pick(CHIP_SETS),
    blindFactor: blindFactor(),
    roundingThresholdFactor: pick([0.8, 1, 1.2, 1.5]),
    breakFrequency: pick([0, 1, 1, 3, 4, 6]),
    breakDurationMins: pick([5, 10, 15]),
    includeChipUp: rnd() < 0.75,
    bbRule: pick(['double', 'none', 'min1_5x'] as const),
    anteRule: pick(['bb_percent', 'bb_percent', 'match_sb', 'match_bb'] as const),
    antePercent: pick([10, 12.5, 15, 20, 25]),
  }));
}

const describeParams = (p: BlindStructureParams): string =>
  `${p.playerCount}p/${p.startingStack}/${p.tournamentLengthHrs}h/${p.levelDurationMins}m ` +
  `[${p.chipDenoms.join(',')}] bf=${p.blindFactor} rtf=${p.roundingThresholdFactor} ` +
  `brk=${p.breakFrequency} ${p.bbRule} ${p.anteRule}@${p.antePercent}`;

// Poker Hawk desktop defaults at 8 players: 160,000 chips, 4h, 20-min levels.
const HOME_GAME = params({
  playerCount: 8,
  startingStack: 20_000,
  tournamentLengthHrs: 4,
  levelDurationMins: 20,
  breakFrequency: 4,
  breakDurationMins: 10,
  blindFactor: 1,
  anteRule: 'bb_percent',
  antePercent: 12.5,
});

// The field QA reported the overshoot on: 36 x 20,000 = 720,000 chips.
const QA_FIELD = params({ ...HOME_GAME, playerCount: 36, blindFactor: 1.4 });

describe('antes', () => {
  const levelAt = (p: BlindStructureParams, smallBlind: number, bigBlind: number) => {
    const level = blindLevelsOnly(generateBlindStructure(p)).find(
      (l) => l.smallBlind === smallBlind && l.bigBlind === bigBlind,
    );
    if (!level) throw new Error(`no ${smallBlind}/${bigBlind} level in ${describeParams(p)}`);
    return level;
  };

  // Regression: 12.5% of 10,000 is 1,250, which rounded to the 5,000 base
  // gave 0 and was then floored to the smallest chip in the BOX — a 25
  // ante at 5000/10000, down from 1000 the level before, paid in a chip
  // coloured up hours earlier.
  it('5000/10000 at 12.5% on 25/100/500/1k/5k antes at least 1000', () => {
    for (const p of [HOME_GAME, QA_FIELD]) {
      const level = levelAt(p, 5_000, 10_000);
      expect(level.ante, describeParams(p)).toBeGreaterThanOrEqual(1_000);
      expect(level.ante % 1_000, describeParams(p)).toBe(0);
    }
  });

  it('never fall from one level to the next (the reported 100 -> 25 case)', () => {
    const levels = blindLevelsOnly(generateBlindStructure(HOME_GAME));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].ante, `level ${levels[i].level}`).toBeGreaterThanOrEqual(levels[i - 1].ante);
    }
  });

  it('never decrease, and are always paid in a chip still in play — 300 seeded structures', () => {
    const samples = sampleParams(0xa17e, 300, (() => {
      const rnd = seeded(0xbf);
      return () => +(0.5 + rnd() * 2.5).toFixed(2);
    })());
    const failures: string[] = [];
    let inPlayChecked = 0;

    for (const p of samples) {
      const schedule = generateBlindStructure(p);
      const levels = blindLevelsOnly(schedule);
      const label = describeParams(p);
      const sorted = [...p.chipDenoms].sort((a, b) => a - b);

      for (let i = 0; i < levels.length; i++) {
        const l = levels[i];
        if (l.ante <= 0) failures.push(`${label}: level ${l.level} ante ${l.ante}`);
        if (l.ante > l.bigBlind) failures.push(`${label}: level ${l.level} ante ${l.ante} > bb ${l.bigBlind}`);
        if (i > 0 && l.ante < levels[i - 1].ante) {
          failures.push(`${label}: ante fell at level ${l.level}: ${levels[i - 1].ante} -> ${l.ante}`);
        }
      }

      // Which chips are still on the table is visible from outside when
      // every level is followed by a break and promotions are marked: a
      // chip-up break is where chips leave, and each one means the
      // rounding base moved up at least one denomination — so after k of
      // them nothing below sorted[k] is left. The ante must be a multiple
      // of a denomination at or above that.
      if (p.breakFrequency === 1 && p.includeChipUp) {
        inPlayChecked++;
        let chipUps = 0;
        for (const entry of schedule) {
          if (entry.type === 'chip-up') chipUps++;
          if (entry.type !== 'blind') continue;
          const lowestInPlay = sorted[Math.min(chipUps, sorted.length - 1)];
          if (!sorted.some((d) => d >= lowestInPlay && entry.ante % d === 0)) {
            failures.push(`${label}: level ${entry.level} ante ${entry.ante} needs a chip below ${lowestInPlay}`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
    expect(inPlayChecked).toBeGreaterThan(50);
  });
});

describe('blind ladder', () => {
  // Regression: blindFactor was an exponent on the whole climb, so it moved
  // the endpoint. At 1.4 the last big blind was 50 * (50400 / 50)^1.4 =
  // 800,000 — more than the 720,000 chips in the room — with 3x jumps on
  // the way.
  it('finishes inside the chips in play on the field QA reported', () => {
    const levels = blindLevelsOnly(generateBlindStructure(QA_FIELD));
    const chips = QA_FIELD.playerCount * QA_FIELD.startingStack;
    expect(levels[levels.length - 1].bigBlind).toBeLessThanOrEqual(chips * 0.1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].bigBlind / levels[i - 1].bigBlind, `level ${levels[i].level}`).toBeLessThanOrEqual(2.5);
    }
  });

  it('blindFactor bends the climb without moving its end', () => {
    const at = (blindFactor: number) => blindLevelsOnly(generateBlindStructure({ ...QA_FIELD, blindFactor }));
    const even = at(1);
    const fast = at(2);
    const slow = at(0.5);
    const chips = QA_FIELD.playerCount * QA_FIELD.startingStack;
    expect(fast).toHaveLength(even.length);
    expect(slow).toHaveLength(even.length);

    // Same destination: within the 7% target and the 10% cap, all three.
    for (const levels of [even, fast, slow]) {
      const last = levels[levels.length - 1].bigBlind;
      expect(last).toBeGreaterThanOrEqual(chips * 0.05);
      expect(last).toBeLessThanOrEqual(chips * 0.1);
    }

    // Different route: a higher factor front-loads the climb, a lower one
    // holds it back. Compare at the midpoint.
    const mid = Math.floor(even.length / 2);
    expect(fast[mid].bigBlind).toBeGreaterThan(even[mid].bigBlind);
    expect(slow[mid].bigBlind).toBeLessThan(even[mid].bigBlind);
  });

  it('stays under the cap and steps no more than 2.5x — 300 seeded structures, blindFactor 1.1 to 2.0', () => {
    const samples = sampleParams(0x1adde5, 300, (() => {
      const rnd = seeded(0xb1);
      return () => +(1.1 + rnd() * 0.9).toFixed(2);
    })());
    const failures: string[] = [];
    let capChecked = 0;
    let stepChecked = 0;

    for (const p of samples) {
      const levels = blindLevelsOnly(generateBlindStructure(p));
      const label = describeParams(p);
      const chips = p.playerCount * p.startingStack;
      const smallest = Math.min(...p.chipDenoms);
      const n = levels.length;

      // The cap holds whenever the field can afford the levels the clock
      // asks for: every level must raise the blinds by at least one chip,
      // and when 2 x smallest chip x levels eats the headroom between the
      // 7% target and the 10% cap, no ladder of real chips can stay under.
      if (2 * smallest * n <= 0.03 * chips) {
        capChecked++;
        const last = levels[n - 1].bigBlind;
        if (last > chips * 0.1) failures.push(`${label}: last bb ${last} > 10% of ${chips}`);
      }

      // The 2.5x step limit holds whenever the curve itself climbs no
      // faster than that — i.e. the time allows enough levels for the climb.
      // The steepest step of the curve is at most (final / opening)^(bf / (n - 1)).
      const climb = Math.max(1, (0.07 * chips) / (2 * smallest));
      if (n > 1 && Math.pow(climb, p.blindFactor / (n - 1)) <= 2.5) {
        stepChecked++;
        for (let i = 1; i < n; i++) {
          const step = levels[i].bigBlind / levels[i - 1].bigBlind;
          if (step > 2.5) {
            failures.push(`${label}: ${levels[i - 1].bigBlind} -> ${levels[i].bigBlind} (${step.toFixed(2)}x)`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
    expect(capChecked).toBeGreaterThan(150);
    expect(stepChecked).toBeGreaterThan(100);
  });
});
