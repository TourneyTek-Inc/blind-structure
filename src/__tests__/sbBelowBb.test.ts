import { describe, expect, it } from 'vitest';
import { blindLevelsOnly, generateBlindStructure, type BlindStructureParams } from '../index.js';

const QA_FIELD: BlindStructureParams = {
  playerCount: 60, startingStack: 12_000, tournamentLengthHrs: 8, levelDurationMins: 20,
  chipDenoms: [25, 100, 500, 1_000, 5_000, 25_000], blindFactor: 1.4, roundingThresholdFactor: 1,
  breakFrequency: 4, breakDurationMins: 10, includeChipUp: true, bbRule: 'none', anteRule: 'match_sb',
};

describe('the small blind is always below the big blind', () => {
  it('holds for every bbRule across a broad sweep', () => {
    const failures: string[] = [];
    for (const chipDenoms of [[25,100,500,1_000,5_000],[1,5,25,100],[100,500,1_000],[5,25,100,500,1_000,5_000,25_000],[25,100,500,1_000,5_000,25_000]])
    for (const playerCount of [6, 18, 60, 120])
    for (const startingStack of [10_000, 12_000, 20_000, 50_000])
    for (const tournamentLengthHrs of [3, 5, 8])
    for (const blindFactor of [0.8, 1, 1.4, 1.6])
    for (const bbRule of ['none', 'double', 'min1_5x'] as const) {
      const p = { ...QA_FIELD, chipDenoms, playerCount, startingStack, tournamentLengthHrs, blindFactor, bbRule };
      for (const l of blindLevelsOnly(generateBlindStructure(p))) {
        if (l.smallBlind >= l.bigBlind) { failures.push(`${playerCount}x${startingStack} ${tournamentLengthHrs}h bf=${blindFactor} [${chipDenoms}] ${bbRule}: L${l.level} ${l.smallBlind}/${l.bigBlind}`); break; }
      }
    }
    expect(failures).toEqual([]);
  });

  it('the QA field (60 x 12,000, 8h, 20-min levels) on no rule', () => {
    for (const l of blindLevelsOnly(generateBlindStructure(QA_FIELD))) expect(l.smallBlind, `L${l.level}`).toBeLessThan(l.bigBlind);
  });
});
