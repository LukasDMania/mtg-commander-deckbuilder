# Roadmap

Five phases, about 26 weeks for one developer (rough estimates). **A phase starts only after the previous gate
passes.** Work tasks top to bottom; tick `[x]` when done; log surprises in `docs/phases/phase-N.md`.

Current phase: **Phase 0** — start with the Tooling and Scryfall tasks.

Done early (2026-10-11, from a cloud session without access to card data): the pure-logic parts of Phase 1
— deck parser/exporter, validator, bracket rules, goldfish v0 — and most of the Phase 2 goldfish lab (simulator v1
and tuning tools). See `docs/phases/phase-1.md` and `docs/phases/phase-2.md` for what was built, what's left, and
what must be verified against real data.

---

## Phase 0 — Data foundation (weeks 1–3)

Tooling
- [x] npm workspaces, TypeScript strict, Vitest, `npm run check` (typecheck + test)
- [ ] ESLint + Prettier, add lint to `npm run check`
- [ ] `.env` loading; SQL Server connection helper in `packages/data` (`mssql`); connection smoke test
- [ ] Migration runner: applies `db/schema.sql` then `db/migrations/*.sql` in order, tracks applied files

Scryfall
- [ ] Bulk-data downloader: read `https://api.scryfall.com/bulk-data` (with User-Agent + Accept headers), download
      `oracle_cards` and `default_cards`, stream-parse (files are large — never load whole into memory)
- [ ] Import `card` (oracle-level) incl. color identity, legality, `game_changer` flag; `card_printing` with
      `prices.eur` / `eur_foil` / `usd`; `card_price_history` daily row
- [ ] Cheapest € printing per card view (`v_card_price`)
- [ ] Map card data to `@cdb/rules` `CardInfo`: `canBeCommander` (legendary creature, "can be your commander",
      Background), `partnerKinds`/`partnerWith` (Partner, Partner with, Friends forever, Choose a Background,
      Background, Doctor's companion, Time Lord Doctor), `anyNumberAllowed` / `maxCopies` (oracle text), basic-land
      color identity as Scryfall reports it; a SQL-backed `CardLookup`
- [ ] Confirm how the Game Changer flag appears in bulk data (field name) vs `is:gamechanger` search; document it

EDHREC (see `docs/EDHREC.md`)
- [ ] Polite fetcher (2–3 s spacing, User-Agent, 7-day cache in `edhrec_page`, retries with backoff)
- [ ] Download full real pages for 3 commanders (incl. a partner pair) × base/bracket/theme/budget/average-deck/
      combos; save trimmed fixtures to `packages/data/fixtures/edhrec/`
- [ ] **Verify** every shape in `docs/EDHREC.md`; confirm bracket slugs (`exhibition`, `core`, `upgraded`,
      `optimized`, `cedh`), `expensive.json`, partner slug rule, and whether `id` is a Scryfall printing id
- [ ] Parsers → `edhrec_card_stat`, `edhrec_theme`, `edhrec_bracket_count`, `commander`
- [ ] Commander list crawl (`commanders/year.json` + `more` pages)

Commander Spellbook
- [ ] Import combos (`combo`, `combo_card`) incl. bracket tags; wrapper for `estimate-bracket` and `find-my-combos`

Deck corpus (real human decks — `docs/PLAN.md` §4b)
- [ ] Explore Archidekt's public JSON API on the PC (search by commander/format, deck fetch); confirm where the
      player-set bracket, tags, views and likes live; document in `docs/phases/phase-0.md`
- [ ] Sampler: per commander, up to ~300 recent, complete, legal decks with a player-set bracket →
      `corpus_deck`, `corpus_deck_card` (polite pacing, cache)

Roles
- [ ] Role tagging v1 from Scryfall function tags (`otag:`) for: ramp, mana-rock, mana-dork, card-draw, removal,
      board-wipe, counterspell, tutor, protection, recursion, sacrifice-outlet, token-maker, cost-reducer,
      land-destruction, extra-turn (verify tag names first) → `card_role`
- [ ] Scheduled jobs script (daily Scryfall prices, weekly the rest) + Windows Task Scheduler instructions

**Gate 0:** a query for any card returns rules text, roles and cheapest € price; a query for
commander × bracket returns Top Cards and High Lift Cards with inclusion %, lift and € price.

---

## Phase 1 — Deck engine as an MCP server (weeks 4–9)

Rules (`packages/rules`, test-first)
- [x] Deck model + parser/exporter for plain text, Moxfield and Archidekt formats (verify Moxfield's import of
      our text export on the PC)
- [x] Validator: 100 cards incl. commander(s); singleton with exceptions (basics, "any number" cards); color
      identity incl. partners/backgrounds; Commander legality; € total vs budget (companion legality: not yet)
- [x] Bracket rules engine: policy table, Game Changer count, mass land denial, extra turns, two-card combos via
      `ComboInfo`; minimum-bracket report with reasons
- [ ] Feed real combos: Commander Spellbook → `ComboInfo` (decide the `early` rule, e.g. Spellbook tag or total
      MV ≤ 6) and the `mass-land-denial` / `extra-turn` role tags
- [ ] Role counts, curve, colored-source counts vs brief targets → warnings (stats exist in `validateDeck().stats`;
      comparison with the brief and colored sources not yet)
- [ ] Mana base builder: land count from curve + ramp, color weighting by pips, nonbasics within leftover budget

Candidate pools (`packages/data`)
- [ ] Pool builder: identity + legality + bracket + per-card price ceiling; EDHREC (commander × bracket × theme)
      ranked by inclusion and lift; Scryfall role tags; owned-card boost; score per card
- [ ] Discovery candidates: low-inclusion / high-lift + semantic matches + unusual cards from well-liked corpus decks
- [ ] Corpus stats: role counts and curves per commander × bracket (feeds brief role targets); card-to-card lift
      within a commander's decks (packages and anti-synergies)
- [ ] Embeddings: local model (transformers.js) → `card_embedding` (`VECTOR`); `semantic_search`
- [ ] Meme mode search: names, flavor text, creature types, Scryfall art tags; theme-fidelity score

Goldfish v0 (`packages/sim`, early slice — see `docs/SIMULATION.md`)
- [x] Seeded RNG, London + free mulligan, land/mana-only simulation; screw/flood/mana-by-turn metrics
- [x] Hypergeometric validation tests
- [x] Paired A/B with common random numbers (`compareGoldfish`) — pulled forward from Phase 2
- [ ] Map real cards to `SimCard` profiles (kinds: land, rock, dork, ramp, draw, engine, tutor, reducer, creature,
      interaction, spell; colors, pips, power, evasion) from role tags + oracle text; combos from Spellbook

MCP server (`apps/server`)
- [ ] MCP server (stdio) registered in Claude Desktop config; tools: `get_commander`, `get_edhrec_cards`,
      `search_cards`, `semantic_search`, `get_combos`, `validate_deck`, `build_mana_base`, `simulate` (v0),
      `save_deck`, `get_collection` (spec in `docs/PLAN.md` §6)
- [ ] Deckbuilding instructions for Claude Desktop (project instructions or skill): pipeline, brief JSON,
      discovery slots, critic pass, meme mode, "only cards returned by tools", always end with `validate_deck`
- [ ] Exports: Moxfield/Archidekt text, Cardmarket wants list
- [ ] `tests/benchmarks`: 30 requests (10 popular commanders × B2/B3, 10 niche themes, 5 meme, 5 budgets €50–100)
      + a script that validates saved results

**Gate 1:** all 30 benchmark decks pass every hard rule (100%), built through Claude Desktop on the Pro plan.
Record how much Pro usage a full build takes.

---

## Phase 2 — Simulation lab (weeks 10–16)

Goldfish lab (full — `docs/SIMULATION.md` Part A)
- [x] Sim profile model (`SimCard` v1) — the card side; see `docs/SIMULATION.md` A1
- [ ] Sim profiles from real data: auto from tags + oracle parsers; LLM-assisted tagging cache; manual overrides;
      coverage %
- [x] Full game loop: colored mana, ramp, rocks/dorks, draw bursts/engines, tutors, cost reducers, commander, combo
      assembly, combat clock with commander damage, held interaction (commander tax is moot in a goldfish)
- [x] Metrics with P10/P50/P90 + 95% CIs (normal/Wilson); per-card drawn/cast/dead rates; 10k games ≈ 1 s
- [ ] Bootstrap CIs for percentiles; consistency score; worker_threads
- [x] Paired A/B with common random numbers (v0 done in Phase 1; extend to the full metric set)
- [x] Land sweep, card impact ranking (leave-one-out, paired), bracket speed check
- [ ] Ramp sweep (same pattern as the land sweep)
- [x] Mulligan guide (hand features → good-game rate vs fresh 7 / 6-card baselines → plain-language rules)
- [ ] Sanity/regression decks (a precon, a Bracket 4 list) with snapshot tests

Pod lab (Forge — Part B)
- [ ] Install Forge locally; confirm sim-mode command and flags; `.dck` exporter
- [ ] Job queue (`sim_job`) + runner (parallel JVMs, timeouts) + log parser → `sim_game`
- [ ] Reference gauntlets per bracket (precons, real corpus decks by bracket, EDHREC average decks as filler,
      EDHTop16 for B5)
- [ ] Seat rotation, win rate with CI, win-turn distribution, end-reason breakdown, TrueSkill-style rating
- [ ] Report Forge-unsupported / AI-unplayable cards per deck
- [ ] Overnight batch command

**Gate 2:** for the 30 benchmark decks, the goldfish win-con turn falls inside the bracket's window for ≥ 90%;
Forge pod ratings run overnight for ≥ 10 decks with sensible bracket ordering.

---

## Phase 3 — Web app (weeks 17–22)

- [ ] React + Vite app served by `apps/server`; REST endpoints for decks, cards, collection, sims
- [ ] Deck library; deck view grouped by role; card sheet ("why it's here", swap options with € and impact Δ)
- [ ] Brief viewer/editor; edit deck manually with live validation
- [ ] Simulation screens: histograms with bracket window, mana-by-turn band, sweeps, card impact, mulligan guide,
      pod lab results
- [ ] Collection import (ManaBox CSV, Moxfield/Archidekt text); owned badges
- [ ] Cardmarket buy list; exports
- [ ] Play log (result, rating, dead cards) linked to deck versions

**Gate 3:** the owner builds and plays 5 real decks with it.

---

## Phase 4 — Polish (weeks 23–26)

- [ ] Optional API-key mode: one-click build in the web app (same pipeline, server-side), prompt caching
- [ ] Preferences learned from the play log (pet cards, disliked cards, preferred land counts)
- [ ] Calibrate pod-lab power score against real play log
- [ ] Hide-and-predict test on 50 human corpus decks; blind comparisons with the playgroup
- [ ] Bracket model trained on corpus decks' player-set brackets; flag disagreements with our rule-based label

**Gate 4:** blind tests prefer the engine's deck over the EDHREC average deck ≥ 60% of the time.
