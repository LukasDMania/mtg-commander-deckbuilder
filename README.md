# Commander Deck Builder

A personal tool that turns **a commander, a € budget, a bracket and a game plan — or a meme idea —**
into a legal, playable 100-card Commander deck, and explains every card.

- Data: Scryfall (cards, Cardmarket € prices), EDHREC (top / high-lift cards per commander, bracket and theme),
  Commander Spellbook (combos, bracket estimates), Archidekt (bracket-tagged decks).
- Brain: Claude, through an MCP server used from Claude Desktop (Pro plan). Optional API key mode later.
- Rules: code enforces legality, budget and bracket — the AI only plans and picks from real candidates.
- Storage: SQL Server 2025 Express, local.
- UI: web app (React + Vite).

## Docs

| File | What it is |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | Full design: architecture, data layer, deck engine, brackets, AI access, testing, risks |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases 0–4 with task checklists and gates |
| [docs/EDHREC.md](docs/EDHREC.md) | EDHREC JSON endpoint map and crawl plan |
| [docs/SIMULATION.md](docs/SIMULATION.md) | Simulation lab: goldfish engine + Forge 1v1v1v1 pods |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log |
| [CLAUDE.md](CLAUDE.md) | Working rules for Claude Code |

## Getting started (Phase 0)

1. Install Node 22+, SQL Server 2025 Express + SSMS, Git.
2. `cp .env.example .env` and fill in the SQL Server connection.
3. Create the database and run `db/schema.sql` in SSMS (or via the migration script once it exists).
4. `npm install`
5. Open the repo in Claude Code **on your PC** and run `/next-task`.

---
Commander Deck Builder is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by
Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
Card data from Scryfall; not affiliated with or endorsed by Scryfall, EDHREC, or Commander Spellbook.
