# Phase 2 — notes

Log surprises, verified facts, and decisions made while working this phase. Newest first.

## 2026-10-11 — goldfish lab v1 + tuning tools built early (cloud session, no card data)

`npm run check`: 68 tests passing (54 in `packages/sim`).

### Engine (`packages/sim/src/game.ts`, `mana.ts`, `types.ts`)
- `SimCard` kinds: land, rock, dork, ramp, draw, engine, tutor, reducer, creature, interaction, spell, blank.
  Fields: `pips`, `colors` (`'G'`, `'WU'`, `'C'`, `'WUBRG'` = any), `tags`, `permanent`, `produces`, `rampLands`,
  `rampTapped`, `rampToHand`, `draws`, `reduces` + `reducesTag`, `power`, `evasion`, `haste`.
- Colored mana: pool of units; colored pips matched to units by bipartite matching (finds a payment whenever one
  exists), generic paid with the least flexible units. `{C}` needs colorless mana.
- Land choice: the land that adds the most-needed missing color (pip-weighted, hand + uncast commander), untapped
  preferred. Ramp fetches the most-needed basic.
- Casting priority each turn: mana sources (cheapest) → commander → tutors (only if they'd find something) →
  permanent combo pieces → engines/reducers → draw → creatures (most power) → other spells (biggest). Interaction
  is held. Non-permanent combo pieces are held until the whole combo can be paid in one turn.
- Tutor targets: missing piece of the combo closest to completion → cheapest rock/dork while < 6 mana sources →
  engine/reducer → biggest creature.
- Combat: creatures attack from the turn after they're cast (haste: same turn); damage = power × evasion (default
  `groundUnblockedShare` 0.5). Opponents are attacked one at a time; commander damage counts toward 21; normal
  damage overflows to the next opponent. Win = combo assembled or all opponents dead (`winTurn`).
- Per-card trace (drawn turn / cast turn per library position) → per-card drawn rate, cast-when-drawn,
  dead-when-drawn, average cast turn.
- Speed: ~1 s per 10k games for a 99-card deck (v0 was ~0.2 s; the closures and color matching cost something).
  Worker threads are still a Phase 2 task if sweeps get slow.

### Tools (`packages/sim/src/tools.ts`)
- `landSweep`, `cardImpact`, `mulliganGuide`, `bracketSpeedCheck` — design in `docs/SIMULATION.md` A6.
- **Objective choice matters.** First demo used "commander turn" for the land sweep and it recommended ever more
  lands (flood isn't punished). Default is now: win turn if the deck wins in ≥ 20% of goldfish games, else
  **total mana spent by the last turn**, which punishes both screw and flood. Same idea for the mulligan guide's
  "good game" (mana spent by turn 6 ≥ median); `goodGame: 'commander'` is an option.

Sample run (synthetic Simic deck, 36 lands, Sol Ring/Signet/Elves/3 land-ramp, Rhystic Study, draw spells,
creatures; 10k games): commander median turn 4; screw 2.1%, color screw 6.9%, flood 8.0%. Land sweep: 35–36 lands.
Card impact (mana spent): Rhystic Study, Harmonize, Kodama's Reach, Sol Ring, Cultivate on top. Mulligan rules:
no cheap source → keep 3–5 lands; 1 cheap source → 2–5; 2+ → 1–3.

### Known simplifications (on purpose, documented in the UI later)
- No opponents, no interaction cast at us, no blockers beyond the evasion share, no lifegain/lifeloss effects.
- Engines draw a fixed number per turn (e.g. Rhystic Study ≈ 1 — an assumption per card, set in its profile).
- Tutors put cards into hand only. Draw-step order: normal draw, then engine draws.
- "Table kill" needs 3 × 40 life (or 21 commander damage each) — creature decks rarely finish within 10 turns in a
  goldfish; `firstKill` is often the more useful speed number for them.

### Next
- Profiles from real data (Phase 1 mapping task) — then run the 30 benchmark decks.
- Ramp sweep, consistency score, bootstrap CIs for percentiles, worker threads.
- Mulligan features: color coverage, key pieces (combo/engine) in hand.
