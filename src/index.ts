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
   * Shapes the climb from the opening big blind to the final one. It
   * never moves either end. 1 is an even geometric climb (every level the
   * same multiple of the last); higher front-loads it, so blinds rise
   * faster early and ease into the finish; below 1 back-loads it, holding
   * blinds low longer and steepening towards the end. Must be positive.
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

/** Big blind the curve ends on, as a share of all chips in play. */
const FINAL_BB_SHARE_OF_STACK = 0.07;
/**
 * The most the last big blind may be, as a share of all chips in play.
 * The curve aims at {@link FINAL_BB_SHARE_OF_STACK}; this is the headroom
 * rounding to real chips is allowed on top of that.
 */
const MAX_BB_SHARE_OF_STACK = 0.1;
/**
 * The steepest one level may climb over the last, wherever the curve
 * itself climbs no more than that — so rounding to chips never turns a
 * gentle step into a jump. (Where the curve is steeper, because the time
 * allows too few levels for the climb, it is left alone.)
 */
const MAX_LEVEL_STEP = 2.5;
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
 * Where level `t` of the climb sits, as a share of the whole climb
 * (measured in log space, from the opening big blind at 0 to the final
 * one at 1).
 *
 * - `blindFactor` 1 is a straight line: an even geometric climb, every
 *   level the same multiple of the last.
 * - Above 1 the climb is front-loaded: `1 - (1 - t)^blindFactor`. Blinds
 *   rise faster early and ease into the final big blind; at every level
 *   they are higher than an even climb would put them.
 * - Below 1 the climb is back-loaded — the mirror image, `t^(1/blindFactor)`.
 *   Blinds stay low longer and steepen towards the end.
 *
 * Either way the endpoints are fixed, and the steepest step (in log
 * terms) is at most `max(blindFactor, 1/blindFactor)` times the even one —
 * so the factor bends the curve without ever raising where it ends.
 * (Before 1.1.0 it was an exponent on the whole ratio, which moved the
 * endpoint: at 1.4 a 720,000-chip field finished on an 800,000 big blind.)
 */
function climbShape(t: number, blindFactor: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return blindFactor >= 1 ? 1 - Math.pow(1 - t, blindFactor) : Math.pow(t, 1 / blindFactor);
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
 * denominations, no time, non-positive level duration, non-positive
 * `blindFactor`).
 *
 * The big blind climbs from two of the smallest chip towards 7% of the
 * chips in play and never finishes above 10% of them — unless the clock
 * asks for more levels than the field can step through one chip at a
 * time.
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
  if (!Number.isFinite(blindFactor) || blindFactor <= 0 || !roundingThresholdFactor) return [];
  if (!Number.isFinite(levelDurationMins) || levelDurationMins <= 0) return [];

  const totalMinutes = Math.max(0, Math.floor(tournamentLengthHrs * 60)) + PADDING_MINS;
  const totalLevels = countLevelsThatFit(totalMinutes, levelDurationMins, breakFrequency, breakDurationMins);
  if (totalLevels === 0) return [];

  const totalChips = playerCount * startingStack;
  const smallest = lowestDenom(chipDenoms);
  const initialBigBlind = smallest * 2;
  const finalBigBlind = totalChips * FINAL_BB_SHARE_OF_STACK;

  // Every level's raw big blind sits on one curve from the opening big
  // blind to the final target — see `climbShape` for how `blindFactor`
  // bends it. The endpoint is fixed: `blindFactor` shapes the climb, it
  // does not move where the climb ends. With a single level there is no
  // climb — and no `totalLevels - 1` to divide by.
  const ratio = Math.max(1, finalBigBlind / initialBigBlind);
  const rawCurve = Array.from({ length: totalLevels }, (_, i) =>
    totalLevels > 1 ? initialBigBlind * Math.pow(ratio, climbShape(i / (totalLevels - 1), blindFactor)) : initialBigBlind,
  );
  const rawBigBlind = (i: number): number => rawCurve[i];

  const capBigBlind = totalChips * MAX_BB_SHARE_OF_STACK;
  const denomsAscending = [...new Set(chipDenoms)].sort((x, y) => x - y);

  const schedule: ScheduleEntry[] = [];
  // The smallest chip the blinds and antes still use. It only ever climbs:
  // once a denomination has been coloured up it does not come back.
  let roundingBase = smallest;
  let chipUpBase = smallest;
  let chipUpPending = false;
  // Chips below this have been raced off at a chip-up break. Only tracked
  // when chip-up breaks are actually emitted.
  const coloursUpAtBreaks = !!includeChipUp && !!breakFrequency && breakFrequency > 0;
  let colouredUpBelow = smallest;
  // Blinds of the previous *blind* level (breaks and chip-ups carry none),
  // so each level can be forced strictly above the one before it.
  let prevSB: number | null = null;
  let prevBB: number | null = null;
  let prevAnte = 0;

  /**
   * The steepest level `j` may climb over the one before it. Where the
   * curve climbs gently, rounding may not stretch a step past
   * MAX_LEVEL_STEP. Where the curve itself is steeper than that — too few
   * levels for the climb — no limit is applied: holding each level back
   * would leave the structure short of its final big blind.
   */
  const stepLimitAt = (j: number): number =>
    j > 0 && rawBigBlind(j) / rawBigBlind(j - 1) <= MAX_LEVEL_STEP ? MAX_LEVEL_STEP : Infinity;

  /**
   * Level `j`'s blinds rounded to `base`, given the level before it. Pure,
   * so the same arithmetic both builds the schedule and looks ahead along it.
   */
  const blindsOn = (base: number, j: number, prev: { sb: number; bb: number } | null): { sb: number; bb: number } => {
    const rawBB = rawBigBlind(j);
    const rawSB = rawBB / 2;
    // Never round a blind away to nothing: a level with a 0 small blind
    // isn't a level.
    let sb = Math.max(roundToNearestDenom(rawSB, base), base);
    let bb = Math.max(roundToNearestDenom(rawBB, base), base);

    // Rounding to whole chips moves a blind by up to half a chip either
    // way, and at the bottom of the ladder that is a lot: 50 rounded down
    // then 140 rounded up to 150 turned a 2.3x climb into a 3x one.
    const stepLimit = stepLimitAt(j);
    const limitOn = (previous: number): number => Math.floor((previous * stepLimit) / base) * base;

    if (prev) {
      // A level whose blinds equal the level before it isn't a level: the
      // pressure never goes up and 20 minutes of clock burn for nothing.
      // Rounding causes this whenever the step between two levels is
      // smaller than the denomination they both round to (e.g. 100/200
      // twice in a row on 100-chips). Promote by one rounding step until
      // the level is strictly above its predecessor — the raw curve is left
      // untouched, so the schedule re-converges on the intended shape.
      while (sb <= prev.sb) sb += base;
      const sbLimit = limitOn(prev.sb);
      if (sb > sbLimit && sbLimit > prev.sb) sb = sbLimit;
    }

    if (bbRule === 'double') {
      bb = roundToNearestDenom(sb * 2, base);
    } else if (bbRule === 'min1_5x') {
      const minBB = sb * 1.5;
      if (bb < minBB) bb = roundToNearestDenom(minBB, base);
    }

    if (prev) {
      // The big blind has to climb too — `bbRule` can hold it flat even
      // when the small blind moved (and with no rule at all it rounds on
      // its own).
      while (bb <= prev.bb) bb += base;
      // …but not by more than the step limit, unless climbing at all, or
      // staying at least the small blind (1.5x it under 'min1_5x'), needs
      // more. Doubling already follows the limited small blind.
      if (bbRule !== 'double') {
        const nextUp = (Math.floor(prev.bb / base) + 1) * base;
        const bbFloor = Math.max(nextUp, bbRule === 'min1_5x' ? roundToNearestDenom(sb * 1.5, base) : sb);
        bb = Math.min(bb, Math.max(limitOn(prev.bb), bbFloor));
      }
    }
    return { sb, bb };
  };

  /**
   * Whether the rest of the structure, played out on `base` from level
   * `from` onwards, finishes at or under the cap.
   */
  const finishesUnderCap = (base: number, from: number, first: { sb: number; bb: number }): boolean => {
    let level = first;
    for (let j = from + 1; j < totalLevels; j++) level = blindsOn(base, j, level);
    return level.bb <= capBigBlind;
  };

  for (let i = 0; i < totalLevels; i++) {
    const rawBB = rawBigBlind(i);
    const prev = prevSB !== null && prevBB !== null ? { sb: prevSB, bb: prevBB } : null;

    // How steeply the curve climbs out of this level — the per-level
    // multiplier the rounding base uses to decide when to promote.
    const stepRatio =
      totalLevels === 1 ? 1 : i < totalLevels - 1 ? rawBigBlind(i + 1) / rawBB : rawBB / rawBigBlind(i - 1);
    const wanted = Math.max(
      roundingBase,
      getDynamicRoundingBase(rawBB, chipDenoms, stepRatio, roundingThresholdFactor),
    );

    // Promote the rounding base towards the denomination the curve asks
    // for — but only as far as two things still hold:
    //
    // - The structure can still finish under the cap. Every later level
    //   has to rise by at least one step of the base, so a chip too coarse
    //   for the levels left carries the last big blind past the chips in
    //   play however gently the curve climbs (5000-chip steps on a
    //   160,000-chip field finished on 10000/20000).
    // - The promoted level is no steeper than the step limit. Promoting
    //   while the small blind is still below the new chip floors it up to
    //   one whole chip — 100/200 straight to 500/1000.
    //
    // Try the denomination asked for first, then each smaller one down to
    // the current base, and take the first that passes. The current base
    // always stands: chips already coloured up cannot come back. A
    // promotion held back here happens a level or two later, once the
    // blinds have grown into the chip.
    let blinds = blindsOn(roundingBase, i, prev);
    const stepLimit = stepLimitAt(i);
    for (let d = denomsAscending.length - 1; d >= 0; d--) {
      const base = denomsAscending[d];
      if (base > wanted || base <= roundingBase) continue;
      const candidate = blindsOn(base, i, prev);
      const withinStep = !prev || candidate.bb <= prev.bb * stepLimit;
      if (withinStep && finishesUnderCap(base, i, candidate)) {
        roundingBase = base;
        blinds = candidate;
        break;
      }
    }
    const { sb: sbRounded, bb: bbRounded } = blinds;

    if (includeChipUp && roundingBase > chipUpBase) {
      chipUpPending = true;
      chipUpBase = roundingBase;
    }

    // Chips leave the table at a chip-up break, so until the next one the
    // smaller chips the blinds have stopped using are still there to pay
    // an ante with. Without chip-up breaks nothing marks that moment, so
    // the ante follows the blinds' own base.
    const lowestInPlay = coloursUpAtBreaks ? colouredUpBelow : roundingBase;
    const ante = computeAnte({
      anteRule,
      antePercent,
      sbRounded,
      bbRounded,
      lowestInPlay,
      roundingBase,
      denomsAscending,
      prevAnte,
    });

    schedule.push({
      level: i + 1,
      type: 'blind',
      smallBlind: sbRounded,
      bigBlind: bbRounded,
      ante,
      durationMins: levelDurationMins,
    });

    prevSB = sbRounded;
    prevBB = bbRounded;
    prevAnte = ante;

    const isBlockEnd = !!breakFrequency && breakFrequency > 0 && (i + 1) % breakFrequency === 0;
    if (isBlockEnd && i + 1 < totalLevels) {
      if (chipUpPending) colouredUpBelow = roundingBase;
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

/**
 * The ante for one level.
 *
 * Three rules hold for every `anteRule` except `'none'`:
 *
 * - **It is paid in chips still on the table** — never below `lowestInPlay`.
 *   Flooring at the smallest denomination *in the box* was the old
 *   behaviour, and it produced a 25 ante at 5000/10000: a chip coloured up
 *   hours earlier, and an ante that fell from the level before.
 * - **It never falls.** A level's ante is at least the previous level's,
 *   lifted to the next multiple of `lowestInPlay` if smaller chips have
 *   since been coloured up.
 * - **It never exceeds the big blind.**
 *
 * For `'bb_percent'` the percentage is rounded to the biggest chip in play
 * that fits inside it, up to the chip the blinds themselves round to —
 * 12.5% of 10,000 is 1,250, which is one 1,000 chip: not fifty 25s, and
 * not a whole 5,000 chip.
 */
function computeAnte(args: {
  anteRule: AnteRule;
  antePercent: number;
  sbRounded: number;
  bbRounded: number;
  /** Smallest chip not yet coloured up. */
  lowestInPlay: number;
  /** The denomination the blinds round to at this level. */
  roundingBase: number;
  denomsAscending: number[];
  prevAnte: number;
}): number {
  const { anteRule, antePercent, sbRounded, bbRounded, lowestInPlay, roundingBase, denomsAscending, prevAnte } =
    args;
  if (anteRule === 'none') return 0;

  let ante: number;
  if (anteRule === 'match_sb') {
    ante = sbRounded;
  } else if (anteRule === 'match_bb') {
    ante = bbRounded;
  } else {
    const pct = Number.isFinite(antePercent) ? antePercent / 100 : DEFAULT_ANTE_PERCENT / 100;
    const wanted = bbRounded * pct;
    let chip = lowestInPlay;
    for (const d of denomsAscending) {
      if (d >= lowestInPlay && d <= roundingBase && d <= wanted) chip = d;
    }
    ante = Math.max(roundToNearestDenom(wanted, chip), lowestInPlay);
  }

  // Never cheaper than the level before…
  const carried = Math.ceil(prevAnte / lowestInPlay) * lowestInPlay;
  if (ante < carried) ante = carried;

  // …and never more than the big blind, which is a different game. The
  // big blind is strictly above the previous one, so this can't undo the
  // line above: it is still at least the previous ante.
  if (ante > bbRounded) ante = bbRounded;

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
