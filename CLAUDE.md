# CLAUDE.md — Commander Deck Builder

Personal tool that builds Magic: The Gathering Commander (EDH) decks from a commander, a € budget,
a target bracket and a game plan (or a meme idea). One user (the owner), runs on his own Windows PC.

Read these before starting work:
- `docs/PLAN.md` — the full design (why things are the way they are)
- `docs/ROADMAP.md` — phases, tasks, gates. **Work the next unchecked task of the current phase.**
- `docs/EDHREC.md` — EDHREC JSON endpoint map (unofficial; verify before relying on a field)
- `docs/SIMULATION.md` — goldfish lab + Forge pod lab design (high-priority feature; be thorough here)
- `docs/DECISIONS.md` — decisions already made; don't reopen them without asking

## Golden rules

1. **The AI never invents cards.** Every card in a deck must resolve to a row in `card` (by oracle_id).
   Claude picks only from candidate pools the code built; code validates everything.
2. **The validator (`packages/rules`) is the source of truth** for legality, 100-card count, singleton,
   color identity, € budget and bracket rules. If the validator and anything else disagree, the validator wins
   (or the validator has a bug — fix it with a test).
3. **Be a polite crawler.**
   - Scryfall: use the daily *bulk data* files, not per-card calls. API calls need a `User-Agent`
     (e.g. `commander-deck-builder/0.1`) and `Accept: application/json` header, and 50–100 ms between calls.
     Never paywall or simply republish Scryfall data.
   - EDHREC (`https://json.edhrec.com/pages/...json`): no official API. One request every 2–3 s, cache raw JSON
     in `edhrec_page`, re-fetch at most weekly. Never hammer it.
   - Moxfield: do **not** scrape. Imports from Moxfield are paste-text only.
4. **Prices are euros from Cardmarket** via Scryfall `prices.eur` (fallback `prices.eur_foil`, then converted
   `prices.usd`, flagged as an estimate). Budget = cheapest printing per card.
5. **Brackets** follow the official Commander Brackets (Oct 2025 / Feb 2026 updates): Game Changers 0 in
   Brackets 1–2, max 3 in Bracket 3, unlimited in 4–5; no mass land denial, no chained extra turns and no early
   two-card combos below Bracket 4. Turn targets: B1 ≥ 9, B2 ≥ 8, B3 ≥ 6, B4 ≥ 4 turns before anyone wins.
   Game Changer flag comes from Scryfall data, never a hardcoded list.
6. Never commit secrets (`.env`), raw bulk dumps, or large fixtures (> 1 MB). Small trimmed fixtures are fine.

## Stack

- TypeScript everywhere, Node 22+, npm workspaces.
- **Database: SQL Server 2025 Express** (local, managed in SSMS). Driver: `mssql`. Schema in `db/schema.sql`,
  changes as numbered files in `db/migrations/`. Uses the `VECTOR` type for card embeddings.
- **AI: Claude.** Primary mode = MCP server (`apps/server`) used from **Claude Desktop on the owner's Pro plan**
  (no API key). Optional later mode = Claude API key for one-click builds in the web app.
  Do not put claude.ai login into the app; API mode must use an API key.
- Web app: React + Vite (`apps/web`). No mobile app.
- Simulators: fast goldfish in TypeScript (`packages/sim`); Forge (Java, separate process) for full games (`tools/forge`).

## Layout

```
apps/server      REST API for the web app + MCP server for Claude Desktop
apps/web         React + Vite web app
packages/rules   deck rules + validator (pure, heavily tested)
packages/data    importers: Scryfall, EDHREC, Commander Spellbook, Archidekt; SQL access
packages/sim     fast goldfish simulator
tools/forge      scripts to run Forge simulation mode
db/              schema.sql + migrations
tests/benchmarks the 30-request benchmark set (Phase 1 gate)
docs/            plan, roadmap, EDHREC map, decisions, per-phase notes
```

## How to work

- Pick the next unchecked task in `docs/ROADMAP.md` (current phase only). Tick it when done and note anything
  surprising in `docs/phases/phase-N.md`.
- Pure logic (rules, mana base, scoring, simulator) gets unit tests (Vitest) before it's wired up.
- Importers: save a small trimmed real response as a fixture and test the parser against it.
- When an external source's real shape differs from `docs/EDHREC.md` or `docs/PLAN.md`, update the doc in the same change.
- A phase is done only when its **gate** in `docs/ROADMAP.md` passes; ask the owner before starting the next phase.
- Keep commits small; message format: `phase-N: what changed`.

## Environment notes

- This must run where SQL Server, Scryfall and EDHREC are reachable: the owner's PC (Claude Code locally).
  Cloud sandboxes may block these sites.
- Config via `.env` (see `.env.example`).
