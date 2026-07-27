# Changelog

All notable changes to this project are documented here. This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.0

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

  This changes generated output, hence the minor bump.

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
