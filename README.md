# @tourneytek/blind-structure

[![CI](https://github.com/TourneyTek-Inc/blind-structure/actions/workflows/ci.yml/badge.svg)](https://github.com/TourneyTek-Inc/blind-structure/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@tourneytek/blind-structure.svg)](https://www.npmjs.com/package/@tourneytek/blind-structure)
[![types](https://img.shields.io/badge/types-included-3178C6.svg)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Generate a poker blind structure from the things a host actually knows: how many players, how many chips each, how long the night should run, and **which chips are on the table**.

Zero dependencies. One pure function. Ships ESM + CJS with types.

Extracted from [Poker Hawk](https://www.pokerhawk.io).

```bash
npm install @tourneytek/blind-structure
```

```ts
import { generateBlindStructure } from '@tourneytek/blind-structure';

const schedule = generateBlindStructure({
  playerCount: 8,
  startingStack: 10_000,
  tournamentLengthHrs: 3,
  levelDurationMins: 15,
  chipDenoms: [25, 100, 500, 1_000, 5_000],
  blindFactor: 1,
  roundingThresholdFactor: 1,
  breakFrequency: 4,
  breakDurationMins: 10,
  includeChipUp: true,
  bbRule: 'double',
  anteRule: 'none',
});

// [ { level: 1, type: 'blind', smallBlind: 25, bigBlind: 50, ante: 0, durationMins: 15 },
//   …
//   { level: 4, type: 'chip-up', durationMins: 10 },
//   … ]
```

## The chips are the whole problem

Plenty of tools will draw you a geometric curve from 25/50 up to something enormous. That curve is useless if it asks for a 150 chip when the smallest denomination in the box is 25 — and worse if it asks for 25s an hour after you coloured them up.

So the rounding base climbs *through* your denominations as the blinds grow. When it promotes, the structure can emit a **chip-up** break at exactly the moment the room needs to swap chips:

```ts
schedule.filter((e) => e.type === 'chip-up');
// → the breaks where a denomination just left play
```

`roundingThresholdFactor` tunes how eagerly that promotion happens — raise it to keep smaller chips in play longer.

## Options

| Option | Meaning |
| --- | --- |
| `playerCount`, `startingStack` | Together set the chips in play. The final big blind targets 7% of that. |
| `tournamentLengthHrs` | Target running time. **An hour of padding is added** so a structure that runs long doesn't fall off the end. |
| `levelDurationMins` | Minutes per level. |
| `chipDenoms` | Denominations on the table. Required — this drives all rounding. |
| `blindFactor` | Escalation shape. `1` spreads the climb evenly; higher accelerates, lower flattens. |
| `roundingThresholdFactor` | How eagerly the rounding base promotes. `1` is the default cadence. |
| `breakFrequency`, `breakDurationMins` | Break every N levels. Omit for none. |
| `includeChipUp` | Mark a break as `chip-up` when the denomination promotes. |
| `bbRule` | `'none'` · `'double'` · `'min1_5x'` |
| `anteRule` | `'none'` · `'bb_percent'` · `'match_sb'` · `'match_bb'` |
| `antePercent` | Percentage of the big blind when `anteRule` is `'bb_percent'`. Default `12.5`. |

The result is a discriminated union — `type: 'blind'` entries carry blinds and an ante; `type: 'break' | 'chip-up'` entries carry only a duration:

```ts
import { blindLevelsOnly, scheduleDurationMins } from '@tourneytek/blind-structure';

blindLevelsOnly(schedule); // just the playing levels
scheduleDurationMins(schedule); // total minutes, breaks included
```

## Guarantees

- **Blinds are never zero.** See below.
- **Blinds only ever use payable denominations** — every value is a multiple of your smallest chip.
- **Blinds escalate monotonically.** No level is cheaper than the one before it.
- **Antes never exceed the big blind**, and never fall below the smallest chip (an ante you can't pay isn't an ante).
- **A break is never the last thing on the schedule** — that's just an early night.
- Bad input returns `[]` rather than throwing: no denominations, non-positive denominations, or a non-positive level duration.

## The zero-blind bug

This library exists partly because of one bug worth naming.

The rounding step is `Math.round(value / base) * base`. When the base promotes to the next denomination while the small blind is still under **half** of it, that expression returns **`0`** — and with `bbRule: 'double'`, the big blind derives from the small blind and goes to zero too. The result is a level, mid-tournament, with blinds of **0/0**.

Across a sweep of 600 realistic parameter combinations against the original implementation, **11.2% produced at least one zero-blind level** — 170 broken levels in total. Denomination sets starting at 100 were the worst hit.

The fix is a floor at the rounding base, so a promoted blind lands on the new denomination rather than on nothing. It's covered by a test that sweeps every denomination set, blind factor and rounding threshold this library ships with.

## License

MIT © [TourneyTek, Inc.](https://www.pokerhawk.io)
