/**
 * Blind structure generation.
 *
 * Produces a full blind schedule — levels, antes, breaks and chip-ups —
 * from the parameters a host actually knows: how many players, how many
 * chips each, how long the night should run, and which chip denominations
 * are on the table.
 *
 * The interesting constraint is the chips. A structure is useless if it
 * asks for a 150 chip when the smallest denomination in the box is 25 and
 * the 25s were coloured up an hour ago. So the rounding base tracks the
 * blinds upward through the denominations, and (optionally) emits a
 * chip-up break at each promotion.
 */

export type LevelType = 'blind' | 'break' | 'chip-up';

export interface BlindLevel {
  /** 1-indexed level number. Breaks carry the number of the level they follow. */
  level: number;
  type: 'blind';
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMins: number;
}

export interface BreakLevel {
  level: number;
  /** `chip-up` when the break coincides with a denomination promotion. */
  type: 'break' | 'chip-up';
  durationMins: number;
}

export type ScheduleEntry = BlindLevel | BreakLevel;

/** How the big blind is derived from the small blind. */
export type BigBlindRule =
  /** Whatever the geometric progression produces. */
  | 'none'
  /** Always exactly 2× the small blind. */
  | 'double'
  /** At least 1.5× the small blind. */
  | 'min1_5x';

/** How the ante is derived from the blinds. */
export type AnteRule =
  /** A percentage of the big blind — see `antePercent`. */
  | 'bb_percent'
  /** Equal to the small blind. */
  | 'match_sb'
  /** Equal to the big blind (a "big blind ante"). */
  | 'match_bb'
  /** No ante. */
  | 'none';

export interface BlindStructureParams {
  playerCount: number;
  startingStack: number;
  /** Target running time. An hour of padding is added so the structure doesn't run dry. */
  tournamentLengthHrs: number;
  levelDurationMins: number;
  /** Chip denominations available on the table. Required — this drives all rounding. */
  chipDenoms: number[];
  /**
   * Shapes how fast blinds escalate. 1 spreads the climb evenly across the
   * scheduled levels; higher accelerates it, lower flattens it.
   */
  blindFactor: number;
  /**
   * Scales how eagerly the rounding base promotes to the next
   * denomination. 1 is the default cadence; higher holds smaller chips in
   * play longer.
   */
  roundingThresholdFactor: number;
  /** Insert a break every N blind levels. Omit for no breaks. */
  breakFrequency?: number;
  breakDurationMins?: number;
  /** Mark a break as `chip-up` when the rounding base promotes. */
  includeChipUp?: boolean;
  /** @default 'none' */
  bbRule?: BigBlindRule;
  /** @default 'bb_percent' */
  anteRule?: AnteRule;
  /** Percentage of the big blind used when `anteRule` is `bb_percent`. @default 12.5 */
  antePercent?: number;
}

/** Big blind at the end of the structure, as a share of all chips in play. */
const FINAL_BB_SHARE_OF_STACK = 0.07;
/** Padding so a structure that runs long doesn't fall off the end. */
const PADDING_MINS = 60;
const DEFAULT_ANTE_PERCENT = 12.5;

const roundToNearestDenom = (value: number, base: number): number =>
  base > 0 ? Math.round(value / base) * base : value;

const lowestDenom = (chipDenoms: number[]): number => Math.min(...chipDenoms);

/**
 * The denomination the blinds should round to at this level.
 *
 * Promotes to the next denomination once the big blind is large enough
 * that the current one is just noise. The threshold widens with the
 * escalation multiplier — a fast structure promotes sooner, because it
 * will have outgrown the chip before the next break otherwise.
 */
function getDynamicRoundingBase(
  bigBlind: number,
  chipDenoms: number[],
  multiplier: number,
  roundingThresholdFactor: number,
): number {
  const sorted = [...chipDenoms].sort((a, b) => a - b);
  let base = sorted[0];

  for (let i = 0; i < sorted.length - 1; i++) {
    const next = sorted[i + 1];
    const stepThreshold = next * (0.6 + 0.4 * multiplier) * roundingThresholdFactor;
    if (bigBlind >= stepThreshold) base = next;
    else break;
  }

  return base;
}

/**
 * How many blind levels fit in the available time, accounting for the
 * breaks between them.
 */
function countLevelsThatFit(
  totalMinutes: number,
  levelDurationMins: number,
  breakFrequency: number | undefined,
  breakDurationMins: number | undefined,
): number {
  const hasBreaks = !!breakFrequency && breakFrequency > 0 && !!breakDurationMins && breakDurationMins > 0;
  if (!hasBreaks) return Math.max(0, Math.floor(totalMinutes / levelDurationMins));

  let levels = 0;
  let elapsed = 0;
  while (elapsed + levelDurationMins <= totalMinutes) {
    levels += 1;
    elapsed += levelDurationMins;

    // Only spend time on a break if another level could still follow it —
    // a break as the last thing on the schedule is just an early night.
    const isBlockEnd = levels % breakFrequency === 0;
    const canFitAnotherLevel = elapsed + levelDurationMins <= totalMinutes;
    if (isBlockEnd && canFitAnotherLevel) {
      if (elapsed + breakDurationMins <= totalMinutes) elapsed += breakDurationMins;
      else break;
    }
  }
  return levels;
}

/**
 * Generate a blind schedule.
 *
 * Returns an ordered list of blind levels interleaved with breaks. Returns
 * an empty array if the inputs can't describe a structure (no chip
 * denominations, no time, non-positive level duration).
 */
export function generateBlindStructure(params: BlindStructureParams): ScheduleEntry[] {
  const {
    playerCount,
    startingStack,
    tournamentLengthHrs,
    levelDurationMins,
    chipDenoms,
    blindFactor,
    roundingThresholdFactor,
    breakFrequency,
    breakDurationMins,
    includeChipUp,
    bbRule = 'none',
    anteRule = 'bb_percent',
    antePercent = DEFAULT_ANTE_PERCENT,
  } = params;

  if (!Array.isArray(chipDenoms) || chipDenoms.length === 0) return [];
  if (!chipDenoms.every((d) => Number.isFinite(d) && d > 0)) return [];
  if (!blindFactor || !roundingThresholdFactor) return [];
  if (!Number.isFinite(levelDurationMins) || levelDurationMins <= 0) return [];

  const totalMinutes = Math.max(0, Math.floor(tournamentLengthHrs * 60)) + PADDING_MINS;
  const totalLevels = countLevelsThatFit(totalMinutes, levelDurationMins, breakFrequency, breakDurationMins);
  if (totalLevels === 0) return [];

  const totalChips = playerCount * startingStack;
  const smallest = lowestDenom(chipDenoms);
  const initialSmallBlind = smallest;
  const initialBigBlind = smallest * 2;
  const finalBigBlind = totalChips * FINAL_BB_SHARE_OF_STACK;

  // Geometric escalation from the opening big blind to the target final
  // one, spread across the levels we have. With a single level there is
  // no climb to spread — and no `totalLevels - 1` to divide by.
  const multiplier =
    totalLevels > 1 ? Math.pow(finalBigBlind / initialBigBlind, blindFactor / (totalLevels - 1)) : 1;

  const schedule: ScheduleEntry[] = [];
  let currentSB = initialSmallBlind;
  let currentBB = initialBigBlind;
  let prevRoundingBase = smallest;
  let chipUpPending = false;
  // Blinds of the previous *blind* level (breaks and chip-ups carry none),
  // so each level can be forced strictly above the one before it.
  let prevSB: number | null = null;
  let prevBB: number | null = null;

  for (let i = 0; i < totalLevels; i++) {
    const roundingBase = getDynamicRoundingBase(currentBB, chipDenoms, multiplier, roundingThresholdFactor);

    if (includeChipUp && roundingBase > prevRoundingBase) {
      chipUpPending = true;
      prevRoundingBase = roundingBase;
    }

    // Never round a blind away to nothing: a level with a 0 small blind
    // isn't a level.
    let sbRounded = Math.max(roundToNearestDenom(currentSB, roundingBase), roundingBase);
    let bbRounded = Math.max(roundToNearestDenom(currentBB, roundingBase), roundingBase);

    // A level whose blinds equal the level before it isn't a level: the
    // pressure never goes up and 20 minutes of clock burn for nothing.
    // Rounding causes this whenever the geometric step between two levels
    // is smaller than the denomination they both round to (e.g. 100/200
    // twice in a row on 100-chips). Promote by one rounding step until the
    // level is strictly above its predecessor — the raw curve is left
    // untouched, so the schedule re-converges on the intended shape.
    if (prevSB !== null) {
      while (sbRounded <= prevSB) sbRounded += roundingBase;
    }

    if (bbRule === 'double') {
      bbRounded = roundToNearestDenom(sbRounded * 2, roundingBase);
    } else if (bbRule === 'min1_5x') {
      const minBB = sbRounded * 1.5;
      if (bbRounded < minBB) bbRounded = roundToNearestDenom(minBB, roundingBase);
    }

    // The big blind has to climb too — `bbRule` can hold it flat even when
    // the small blind moved (and with no rule at all it rounds on its own).
    if (prevBB !== null) {
      while (bbRounded <= prevBB) bbRounded += roundingBase;
    }

    schedule.push({
      level: i + 1,
      type: 'blind',
      smallBlind: sbRounded,
      bigBlind: bbRounded,
      ante: computeAnte({ anteRule, antePercent, sbRounded, bbRounded, roundingBase, smallest }),
      durationMins: levelDurationMins,
    });

    prevSB = sbRounded;
    prevBB = bbRounded;

    currentSB *= multiplier;
    currentBB *= multiplier;

    const isBlockEnd = !!breakFrequency && breakFrequency > 0 && (i + 1) % breakFrequency === 0;
    if (isBlockEnd && i + 1 < totalLevels) {
      schedule.push({
        level: i + 1,
        type: chipUpPending ? 'chip-up' : 'break',
        durationMins:
          typeof breakDurationMins === 'number' && breakDurationMins > 0
            ? breakDurationMins
            : levelDurationMins,
      });
      chipUpPending = false;
    }
  }

  return schedule;
}

function computeAnte(args: {
  anteRule: AnteRule;
  antePercent: number;
  sbRounded: number;
  bbRounded: number;
  roundingBase: number;
  smallest: number;
}): number {
  const { anteRule, antePercent, sbRounded, bbRounded, roundingBase, smallest } = args;
  if (anteRule === 'none') return 0;

  let ante: number;
  if (anteRule === 'match_sb') {
    ante = sbRounded;
  } else if (anteRule === 'match_bb') {
    ante = bbRounded;
  } else {
    const pct = Number.isFinite(antePercent) ? antePercent / 100 : DEFAULT_ANTE_PERCENT / 100;
    ante = roundToNearestDenom(bbRounded * pct, roundingBase);
  }

  // An ante bigger than the big blind is a different game; an ante
  // smaller than the smallest chip can't be paid.
  if (ante > bbRounded) ante = bbRounded;
  if (ante < smallest) ante = smallest;
  return ante;
}

/** Total scheduled minutes, including breaks. */
export function scheduleDurationMins(schedule: ScheduleEntry[]): number {
  return schedule.reduce((sum, entry) => sum + entry.durationMins, 0);
}

/** Just the playing levels, without breaks. */
export function blindLevelsOnly(schedule: ScheduleEntry[]): BlindLevel[] {
  return schedule.filter((e): e is BlindLevel => e.type === 'blind');
}
