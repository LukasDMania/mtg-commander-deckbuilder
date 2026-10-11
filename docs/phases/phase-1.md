# Phase 1 — notes

Log surprises, verified facts, and decisions made while working this phase. Newest first.

## 2026-10-11 — pure-logic slice built early (cloud session, no card data access)

Built and tested (`npm run check`: 47 tests passing):

### `packages/rules`
- `parseDecklist(text)` — plain / MTGO / Arena / Moxfield / Archidekt lines: `1 X`, `1x X`, `X`, `(SET) 123`,
  `*F*`, Archidekt `[Category{flags}]` and `^label^`; section headers (Commander, Deck, Sideboard, Maybeboard,
  Companion, About). Blank lines never switch sections (MTGO's "sideboard after blank line" is ambiguous) — pass
  `commanders` to `toDeckList` for such lists.
- `toDeckList(parsed, { commanders })` — commanders + main deck, duplicates merged, side/maybe boards dropped,
  companion kept separately.
- `exportDeckList(deck, 'text' | 'archidekt', roles)` — round-trips through the parser.
- `normalizeCardName` — case, accents (Nazgûl → nazgul), curly quotes, spacing around `//`.
- `createLookup(cards)` — in-memory `CardLookup` (full name + front face of `A // B`).
- `validateDeck(deck, lookup, { bracket, budgetEur, includeCommanderInBudget, combos })` → report with
  errors/warnings (codes: UNKNOWN_CARD, NO_COMMANDER, TOO_MANY_COMMANDERS, NOT_A_COMMANDER, INVALID_PAIRING,
  DECK_SIZE, SINGLETON, COMMANDER_IN_DECK, COLOR_IDENTITY, NOT_LEGAL, OVER_BUDGET, PRICE_MISSING, PRICE_ESTIMATED,
  GAME_CHANGERS, MASS_LAND_DENIAL, EXTRA_TURNS, TWO_CARD_COMBO), color identity, € total, Game Changers, combos
  present, stats (lands, curve, types, roles), and `bracket.minimumByRules` with reasons.
- `BRACKET_POLICY` in `brackets.ts` is the single place to edit when WotC updates brackets.

Decisions:
- Different spellings of one card (e.g. `Fire // Ice` and `Fire`) are merged by oracle id before the singleton check.
- Deck size counts every listed card, resolved or not, so an unknown name gives one error, not two.
- Minimum bracket by rules: any extra-turn card → ≥ 2; > 2 extra-turn cards → ≥ 4 (chaining likely);
  1–3 Game Changers → ≥ 3; > 3 → ≥ 4; mass land denial → ≥ 4; late two-card combo → ≥ 3; early → ≥ 4.
  Bracket 5 is never assigned by rules. Speed is the simulator's job.
- Extra turns in B2/B3: warning (not error) above 2 cards — "few, never chained" is about play patterns.

To verify on the PC with real data:
- What Scryfall reports as color identity for basic lands (the validator just trusts the data).
- How to derive `partnerKinds` / `partnerWith`, `canBeCommander`, `anyNumberAllowed`, `maxCopies` from Scryfall
  (keywords array + oracle text) — Phase 0 task.
- Whether Moxfield's paste import accepts our `text` export's "Commander" section, or needs the commander set in
  the UI.
- `ComboInfo.early`: choose the rule (Spellbook's own classification if it has one, else total MV ≤ 6).

### `packages/sim` (goldfish v0 — lands and mana only)
- `Rng` (xoshiro128** + splitmix32), `gameSeed(runSeed, i)`.
- `playGame` — London mulligan with free first mulligan (7, 7, 6, 5, 4, then forced keep), multiplayer draw on
  turn 1, one land drop per turn (untapped preferred), rocks (mana the same turn), dorks (summoning sick),
  ramp spells (basics to battlefield tapped/untapped and to hand, fetched from the library), commander cast ASAP,
  remaining mana spent on the biggest spells that fit.
- `runGoldfish(deck, { games, seed, ... })` → report: mulligans, kept-7 rate, opening lands, lands and mana by turn
  (mean/P10/P50/P90), commander cast rate and turn, screw and flood rates (Wilson CIs), missed land drops,
  mana efficiency.
- `compareGoldfish(a, b)` — paired A/B with common random numbers; per-metric mean difference with 95% CI and a
  `significant` flag. Identical decks give exactly 0.
- Validated against exact hypergeometric math (opening hand lands; on-curve land drops for turns 2–6) within
  0.8 percentage points over 60,000 games.
- Speed: 10,000 games ≈ 0.15–0.25 s for a 99-card deck in Node.

Decisions / definitions (also reflected in `docs/SIMULATION.md`):
- Default keep: 3–5 lands, or 2 lands + at least **one** cheap (MV ≤ 2) mana source; at ≤ 5 cards keep 2–4 lands.
- Bottoming after a mulligan keeps ≈ 3/7 lands (2–4), then mana sources cheapest first, then spells cheapest first.
- Screw = ≤ 2 lands in play on turn 4. Flood = lands are ≥ 55% of cards seen by turn 7.
- `cardsSeen` counts the 7 looked at plus draws (cards bottomed and redrawn count twice — negligible).
- Bug found and fixed while testing: bottoming by object identity lost cards when a library held the same card
  object many times. Bottoming now works by hand position; a test guards it.

Sample (synthetic deck, 5-MV commander, Sol Ring + Signets/Cultivates, 10k games each):
33 lands + 11 ramp → screw 3.6%, flood 4.3%, commander median turn 4;
36 + 9 → 2.3% / 8.2% / turn 4; 38 + 7 → 1.8% / 11.6% / turn 5.

Next for the sim: map real cards to `SimCard` kinds (Phase 1 task), then Phase 2's full profiles.
