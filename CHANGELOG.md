# Changelog

All notable changes to this project are documented here. This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.1.1 — 2026-10-06

### Fixed

- **With `bbRule: 'none'` the small blind could equal the big blind.**
  Nothing tied the two together under `'none'`: each was rounded on its
  own, and on a coarse chip the rule that every blind rises each level
  pushed both up one chip at a time until they met — 60 players × 12,000,
  8 hours, 20-minute levels on a 25…25,000 set ran 2000/2000, 3000/3000
  … 60000/60000 from level 10 to the end. 297 of 300 sampled `'none'`
  schedules had at least one such level.

  The big blind is now always at least one chip above the small blind,
  for every rule. `'double'` and `'min1_5x'` output is unchanged; `'none'`
  still applies no ratio, so a late `'none'` level can sit one chip apart
  (55000/60000).

## 1.1.0 — 2026-10-05

Two fixes that change the structure generated for almost every input. No
API changes: the same options, the same result shape.

### Fixed

- **Antes went backwards, onto chips that had already left the table.**
  A `bb_percent` ante was rounded to the blinds' current denomination and,
  when that rounded to nothing, floored at the smallest chip *in the box*.
  At 5000/10000 on a 25/100/500/1k/5k set, 12.5% is 1,250, which rounds to
  0 on 5,000s — so the ante became **25**, down from 1,000 the level
  before, paid in a chip coloured up hours earlier.

  Antes now:
  - never fall from one level to the next, for every rule except `'none'`;
  - are paid only in chips still on the table — nothing a chip-up break has
    already coloured up (without chip-up breaks, nothing smaller than the
    blinds' own denomination);
  - for `bb_percent`, round to the biggest chip in play that fits inside the
    percentage, no bigger than the blinds' chip. 5000/10000 at 12.5% is
    now a 1,000 ante.

- **`blindFactor` moved where the blinds finish, not how they get there.**
  The curve aimed at a final big blind of 7% of the chips in play, but
  `blindFactor` was applied as an exponent to the whole climb, so the last
  big blind was really `opening × (target / opening)^blindFactor`. At the
  1.4 most hosts use, a 720,000-chip field finished on **400,000/800,000** —
  more than every chip in the room — with 3× jumps between levels on the
  way.

  Now:
  - The curve always runs from the opening big blind to 7% of the chips in
    play. `blindFactor` only bends it: `1` is an even geometric climb,
    above `1` front-loads it (`1 - (1 - t)^blindFactor` — blinds rise
    faster early and ease into the finish), below `1` back-loads it
    (`t^(1/blindFactor)`).
  - The last big blind never exceeds **10%** of the chips in play. The
    rounding base will not promote to a chip so coarse that the remaining
    levels, each at least one chip higher, would carry it past that. The
    one exception is a field too small for the clock: when even stepping
    one smallest chip per level overshoots, nothing can fit.
  - No level climbs more than **2.5×** over the one before it wherever the
    curve itself climbs no faster than that. Rounding to chips may no
    longer stretch a step (50 rounded down, then 140 rounded up to 150, was
    a 3× step on a 2.3× curve), and a promotion that would floor the small
    blind up to one whole new chip (100/200 straight to 500/1000) waits a
    level. Where the clock allows too few levels for the climb, the
    curve's own steps are steeper than 2.5× and are left as they are.

  On the Poker Hawk desktop defaults at 8 players (20k stack, 4h, 20-minute
  levels, breaks every 4, `blindFactor` 1.4) the second half of the
  structure goes from
  `5000/10000, 10000/20000, 15000/30000, 25000/50000, 50000/100000`
  (62.5% of the chips) to
  `3000/6000, 4000/8000, 5000/10000, 6000/12000, 7000/14000` (8.75%).

  This changes generated output.

### Changed

- A non-positive or non-finite `blindFactor` now returns `[]`, like the
  other invalid inputs. A negative one used to produce a descending curve
  that the monotonic-blinds rule then forced back up one chip at a time.

## 1.0.0

Stable release. Promotes the package out of `0.x` to declare the public API
settled and supported under Semantic Versioning; breaking changes from here
require a major bump. Carries the repeated-level fix below.

### Changed

- Release workflow no longer sets `registry-url` on `actions/setup-node`,
  which was suppressing OIDC trusted publishing. Publishes again carry a
  provenance attestation.

### Fixed

- **Repeated blind levels.** A level could carry exactly the same blinds as
  the level before it — most visibly `100/200` twice in a row on a standard
  25/100/500/1k/5k chip set. Blinds climb on a geometric curve but are
  rounded to whichever denomination is actually on the table, so whenever the
  step between two levels was smaller than that rounding base, both rounded
  to the same number. The result was a level that raised nothing: the clock
  burned but the pressure never went up.

  Levels are now forced strictly above their predecessor, promoted by one
  rounding step where needed. The raw curve is deliberately left untouched,
  so the schedule re-converges on its intended shape and still finishes on
  the same final big blind. On the Poker Hawk desktop defaults (18 players,
  20k stack, 4h, 20m levels) the schedule goes from
  `… 100/200, 100/200, 200/400, 500/1000, 500/1000 …` to
  `… 100/200, 200/400, 300/600, 500/1000, 1000/2000 …`.

  This changes generated output.

## 0.1.0

Initial release. Extracted from the Poker Hawk platform.

### Added

- `generateBlindStructure` — chip-denomination-aware blind schedules with
  breaks, chip-ups, big-blind rules and antes.
- `blindLevelsOnly`, `scheduleDurationMins` — schedule helpers.

### Fixed (relative to the implementation this was extracted from)

- **Zero-blind levels.** When the rounding base promoted to the next
  denomination while the small blind was under half of it,
  `Math.round(value / base) * base` returned 0 — producing a level with
  blinds of 0/0. Blinds are now floored at the rounding base. A sweep of
  600 realistic parameter combinations found 11.2% of structures hit this.
- **Single-level structures** no longer divide by `totalLevels - 1`.
- Breaks are a real type in a discriminated union rather than an
  `as unknown as` cast.
- Removed a `console.log` that fired for every level of every structure.
