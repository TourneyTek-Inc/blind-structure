# Changelog

All notable changes to this project are documented here. This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
