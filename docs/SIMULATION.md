# Simulation lab

The simulators turn deckbuilding opinions into measured averages over thousands of games. They drive the bracket
label, land and ramp counts, card swap decisions, card impact rankings and the mulligan guide. This is expected to
be the highest-return part of the project, so it gets its own phase (Phase 2) and an early slice in Phase 1.

Two engines, used for different questions:

| | Goldfish lab (`packages/sim`) | Pod lab (Forge, `tools/forge`) |
| --- | --- | --- |
| What it plays | Your deck alone, simplified rules | Full rules, 4-player Commander (1v1v1v1), AI pilots |
| Speed (target) | 10,000 games in < 5 s | Seconds to minutes per game — measure in Phase 2 |
| Answers | Consistency: mana, screw/flood, commander turn, when the win con assembles, which cards matter, how many lands | Strength: win rate vs a bracket field, win turn with interaction, how games are won |
| Best for | Every build, every swap, A/B tests, sweeps | Headline power rating, overnight gauntlets, calibration |
| Weakness | No opponents, no interaction | Forge AI misplays combo/politics; some cards AI-unplayable; slow, noisy |

## Status

| Piece | State |
| --- | --- |
| Goldfish v0 (`packages/sim`): RNG, mulligans, lands/rocks/dorks/ramp, commander turn, screw/flood, mana by turn, paired A/B | **Built 2026-10-11**, validated against hypergeometric math, ~0.2 s per 10k games |
| Card → `SimCard` mapping from real data | Phase 1 (needs the card DB) |
| Full sim profiles, win-con/combo assembly, combat clock, draw engines, tutors | Phase 2 |
| Sweeps, card impact, mulligan guide, worker threads | Phase 2 |
| Forge pod lab | Phase 2 |

API today: `runGoldfish(deck, { games, seed, maxTurns, keepPolicy, ... })`, `compareGoldfish(a, b, opts)`,
`playGame(deck, rng, opts)`, stats helpers (`summarize`, `proportion`, `pairedDifference`, `hypergeomPmf`).

---

## Part A — Goldfish lab

### A1. Card simulation profiles

Every card gets a **sim profile**: a small, explicit model of what it does for the simulator. Stored in
`sim_profile` (one row per oracle_id), built automatically, overridable by hand.

| Field | Meaning | Example |
| --- | --- | --- |
| `kind` | land, mana_rock, mana_dork, ramp_spell, ritual, draw_burst, draw_engine, tutor, cost_reducer, wincon, combo_piece, creature, removal, wipe, protection, other | Cultivate → ramp_spell |
| `mv`, `pips` | Mana value and colored requirements | `{G:1}` |
| `produces` | Mana produced: amount, colors, enters tapped, summoning sick | Arcane Signet → 1 of commander colors, untapped |
| `ramp` | Lands fetched: count, to battlefield tapped/untapped, to hand | Cultivate → 1 tapped + 1 to hand |
| `draw` | Immediate cards; per-turn engine cards; condition | Rhystic Study → engine ≈ 1/turn (configurable assumption) |
| `tutor` | What it finds (role/specific), where it puts it | Demonic Tutor → any, to hand |
| `reduces` | Cost reduction: amount, applies to (type/tribe) | Dragonspeaker Shaman → dragons −2 |
| `power`, `evasion` | For the combat clock (simplified) | 6/6 flyer |
| `wincon` | Flags: alt-win, combo piece (Spellbook combo id), finisher, engine | Thassa's Oracle → combo |
| `castable_ai` | Whether the sim knows how to use it; else treated as a vanilla spell of its MV | — |
| `source` | `auto_tags`, `oracle_parser`, `llm`, `manual` (manual wins) | — |

Profile builders, in order: Scryfall function tags (`otag:`) → oracle-text parsers for common templates
("Search your library for a basic land…", "Add {C}{C}", "Draw two cards") → one-time LLM tagging for the rest
(cached) → manual overrides in `sim_profile_override`. Report per deck: **% of cards with a real profile**.

### A2. Game loop

Seeded RNG (xoshiro128**), one game = up to `maxTurns` (default 12).

1. **Shuffle + opening hand.** London mulligan with the **free first mulligan** used in multiplayer Commander.
   Keep policy is a pluggable function; default (implemented in v0):
   keep if 3–5 lands, or 2 lands + ≥ 1 cheap mana source (MV ≤ 2); at ≤ 5 cards keep 2–4 lands; forced keep at
   4 cards. Bottoming keeps ≈ 3/7 lands, then mana sources, then spells, cheapest first. Record mulligans taken.
2. **Draw step.** Multiplayer: nobody skips the first draw (comprehensive rules 103.8). Seat position configurable.
3. **Land drop.** Choose the land that fixes the most needed colors for spells in hand; prefer tapped lands on
   turns where the extra mana can't be used.
4. **Main phase policy** (greedy, configurable priority):
   mana rocks/dorks and ramp → commander (if `commanderPriority` says so and castable, with commander tax on
   recasts) → draw engines → cost reducers → combo pieces / win cons → creatures by MV → others.
   Removal/protection/counterspells are **held** (counted as "available interaction", not cast).
   Tutors fetch the highest-value missing piece (combo half > win con > ramp early / draw later).
5. **End of turn bookkeeping:** lands, total mana, mana by color, cards in hand, cards cast, board power.

Simplifications are explicit and listed in the UI: no opponents, no interaction cast at us, triggers approximated,
combat damage is unblocked × evasion factor.

### A3. Per-game outputs

- Lands in play per turn; total and per-color mana available per turn
- Turn the commander is first cast
- **Win-con assembled turn**: first turn the deck *could* win if unopposed —
  combo: all pieces in hand/battlefield + enough mana; combat: cumulative unblocked power ≥ 40 against one
  opponent (and ≥ 120 for the whole table); alt-win: condition met
- **Engine-online turn**: first turn a draw engine or key engine piece is on the battlefield
- Mana screw (≤ 2 lands on turn 4, or a missing color needed by ≥ 2 cards in hand on turn 4)
- Flood (lands are ≥ 55% of the cards seen by turn 7; configurable)
- Cards drawn, cards cast, **dead cards** (drawn but never castable or never worth casting by turn 10)
- Mulligans taken; final kept hand

### A4. Aggregate metrics (per deck run)

Always distributions, never just means: P10 / P50 / P90 and the full histogram.

| Metric | Why it matters |
| --- | --- |
| Win-con assembled turn (P10/P50/P90) | Speed → bracket check (B2 shouldn't threaten before turn 8, B3 before turn 6) |
| Commander cast turn | Commander-centric decks live or die on this |
| Mana on turns 3 / 5 / 7 | Ramp quality |
| Screw rate, flood rate, color-screw rate | Mana base quality |
| Keep rate, average mulligans | Consistency |
| Dead-card rate per card | Finds cards that rot in hand |
| Consistency score | Single number: % of games where the win con assembles within the bracket's turn window ± 1 |

### A5. Statistics done right

- Default **N = 10,000 games**; report 95% confidence intervals (bootstrap for percentiles).
- **Common random numbers for A/B tests**: both variants of a deck play the *same* shuffles (same seeds, same
  card order with the swapped card in the swapped slot). This cuts noise massively, so small differences become
  measurable. Report "difference ± CI" and only call a swap better when the CI excludes zero.
- Deterministic: same deck + same seed list = identical results (needed for tests and regressions).

### A6. Tools built on the goldfish lab

1. **Land count sweep** — run 33…40 lands (swapping lands for the weakest nonlands), plot screw/flood/win-con turn;
   recommend the knee of the curve.
2. **Ramp sweep** — same for ramp pieces 6…14.
3. **Swap A/B** — "Cultivate → Arcane Signet": paired comparison on every metric.
4. **Card impact ranking** — leave-one-out: replace each nonland with a blank card, measure Δ in consistency score
   and win-con turn. Ranks the deck's real all-stars and its filler; feeds the critic pass.
5. **Mulligan guide** — log opening-hand features (lands, cheap ramp, colors, key pieces) and game outcome; fit a
   simple model (logistic regression) and turn it into plain rules ("keep 2-landers only with Sol Ring or 2 ramp").
6. **Bracket speed check** — flags "too fast for Bracket 2" or "too slow for Bracket 4" from the win-con turn
   distribution.
7. **Meme mode sanity** — confirms a meme deck still functions (screw rate, can it ever assemble its joke?).

### A7. Performance and validation

- Node + `worker_threads`, one worker per core; target 10k games < 5 s for a typical deck.
- **Validate against exact math**: land-drop probabilities on a vanilla deck must match the hypergeometric
  distribution (unit tests with tolerance). Compare opening-hand land counts against exact probabilities.
- Sanity decks: a precon and a known Bracket 4 list must land in plausible ranges; regression snapshots per release.

---

## Part B — Pod lab (Forge 1v1v1v1)

### B1. How it runs

Forge (open-source MTG engine, Java) has a command-line **simulation mode**:

```
java -jar <forge jar> sim -d <deck1> <deck2> <deck3> <deck4> -f commander -n <games> -q
```

(`-D` loads decks from a directory; `-t` / `-p` run tournaments; `-q` prints results only.) Confirm exact jar name
and flags against the installed version in Phase 2.

- Export decks to Forge `.dck` format (`[metadata]` Name, `[Commander]`, `[Main]` sections).
- Run as **separate JVM processes** (copyleft licence; also isolates crashes). Parallel: cores − 1 workers.
- Jobs queue in SQL (`sim_job`); a runner picks jobs, runs Forge, parses output and game logs into `sim_game`.

### B2. The field (opponents)

Per bracket, a **reference gauntlet** of ~20 decks:
- Bracket 2: Forge's bundled precon decks + EDHREC average decks at `core`, filtered by our validator.
- Bracket 3: EDHREC average decks at `upgraded` for the top commanders (varied archetypes: aggro, combo, control,
  value, stax-lite).
- Bracket 4: EDHREC `optimized` average decks; Bracket 5: cEDH lists from EDHTop16.
Each pod = your deck + 3 opponents sampled from the gauntlet; **rotate seats** (first-seat advantage is real).

### B3. Metrics

| Metric | Notes |
| --- | --- |
| Win rate | Baseline is 25% in a 4-player pod; report seat-adjusted and with CI |
| Win turn distribution (when you win) | The interaction-adjusted speed DeckCheck tries to estimate |
| Game length | Compared with the bracket's expected turns |
| How games end | Combat, commander damage, combo/alt-win, poison, concession/timeout (parsed from logs) |
| Survival turn when losing | Resilience |
| Rating | TrueSkill-style multiplayer rating across all pods → a power score comparable across decks |

### B4. How many games

Win rates are noisy. Detecting a 5-percentage-point change from 25% (95% confidence, 80% power) needs about
**1,200 games per variant**. So:
- Use the **goldfish lab for A/B decisions** (paired seeds, cheap).
- Use the **pod lab for headline numbers**: ~200–500 games for a deck's rating (overnight batch), more for
  close calls.

### B5. Caveats and calibration

- Forge's AI is weaker at combo lines, politics, and holding interaction; report the share of the deck Forge flags
  as AI-unplayable and treat combo decks' numbers with caution.
- New cards may lag in Forge; report unsupported cards and substitute or exclude.
- **Calibrate against reality**: compare Forge numbers with the owner's play log (real games) and adjust the power
  score mapping over time.

---

## Data model (see `db/schema.sql`)

`sim_profile`, `sim_profile_override`, `sim_run` (deck, engine, params, seed, N, started/finished),
`sim_metric` (run, metric, p10/p50/p90/mean/ci), `sim_card_stat` (run, card, dead rate, impact Δ),
`sim_job` (queue for Forge), `sim_game` (Forge games: seats, winner, turns, end reason).

## UI (web app)

- Win-con turn histogram with the bracket's turn window shaded
- Mana-by-turn chart (P10–P90 band)
- Land/ramp sweep line charts with the recommended point marked
- Card impact ranking (bar list, best to worst)
- Mulligan guide (plain-language rules + example hands)
- Pod lab: win rate with CI, end-reason breakdown, rating over time per deck version
