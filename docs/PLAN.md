# Project plan

Status: agreed design as of 2026-10-11. Source of truth for *why*; `ROADMAP.md` is the source of truth for *what next*.

## 1. Goal

A personal web app, running on the owner's PC, that turns a commander, a € budget, a bracket and a game plan
(or a meme idea) into a legal, playable 100-card deck it can explain card by card.

Core idea: **the AI plans the deck and picks from real candidate cards; code enforces every rule.**

The owner is a strong player but not a confident deckbuilder; the tool should do ~95% of the work, with the owner
steering through the deck brief. Most decks are Bracket 2–3. Meme/theme decks are a first-class use case.

## 2. The bar to clear

Version 1.0 must match the best features of existing tools combined (as of May–Oct 2026):

| Feature | Best existing tool | What this app must do |
| --- | --- | --- |
| Full 100-card deck from a plain-English request | CommanderBracket, Spellweave | Same, plus a written game plan and a reason for every card |
| Refine by chat ("cut counterspells", "bracket 3") | CommanderBracket, Farseek | Same, with a diff of every change |
| Target a bracket | Spellweave, CommanderBracket | Hard rule checks plus a simulated win turn |
| Power by win turn, with opponents interacting | DeckCheck | Same, from our own simulator |
| Goldfish games for consistency | Spellweave | Same, plus mulligan and keep rates |
| Power tune up or down | DeckCheck | Same, inside a € budget |
| Combo detection | Spellweave, CommanderBracket (Commander Spellbook) | Same, plus a warning when a combo breaks the bracket |
| Role benchmarks (ramp, draw, removal, curve) | Farseek | Targets that shift with bracket and game plan |
| Data-driven card suggestions | EDHREC, Moxfield | Candidate pools by bracket and theme, ranked by inclusion and lift |
| Build from my collection | Spellweave, Farseek, CommanderBracket | ManaBox / Moxfield / Archidekt import; owned cards ranked first |
| Budget cap | CommanderBracket (USD) | Hard cap in € on Cardmarket prices, with cheaper swaps |
| Meme and theme decks | nobody | Dedicated mode: the joke stays the point, the deck still functions |

Where this app can win: meme mode, staying faithful to odd themes, explaining every pick, euro pricing,
and measured quality (section 9).

## 3. Architecture

```
 Web app (React)            Claude Desktop (Pro plan)
 decks, collection, sims    builds decks via MCP tools
            \                    /
             Local server (TypeScript)
             REST API for web  +  MCP server for Claude
                       |
   ┌──────────────── Deck engine ─────────────────┐
   │ AI planner        Rules & validator   Simulators │
   │ (Claude via MCP   100 cards, identity, fast goldfish │
   │  or API key)      legality, €, bracket  + Forge     │
   └──────────────────────────────────────────────┘
                       |
            SQL Server 2025 Express
     cards, € prices, EDHREC stats, decks, vectors
                       ^
             Scheduled import jobs
  Scryfall · EDHREC · Commander Spellbook · Archidekt · EDHTop16
```

The apps never call external sites directly; a source going down never breaks a build.

## 4. Data layer

| Source | Gives | How | Refresh | Risk |
| --- | --- | --- | --- | --- |
| Scryfall bulk data | All cards: oracle text, types, color identity, legality, Game Changer flag, Cardmarket € prices | Daily bulk files (no rate limit on *.scryfall.io) | Prices daily; cards weekly + set release | Low. No paywalling/repackaging; API calls need User-Agent + Accept |
| Scryfall search API | Function tags (`otag:` ramp, removal, …), art tags for meme mode | 50–100 ms between calls | Weekly | Low |
| EDHREC JSON | Per commander × bracket × theme × budget: top cards, high-lift cards, counts, themes, average decks, combos | Unofficial `json.edhrec.com/pages/…json`, cached, slow crawl. See `EDHREC.md` | Weekly | Medium-high: undocumented, may change/block. Ask permission before any public release |
| Commander Spellbook | All combos, combos in a list, bracket estimate | Open-source REST API (`find-my-combos`, `estimate-bracket`) | Weekly | Low |
| Archidekt | Public decks with player-set bracket + tags | Undocumented JSON API; max 1,000 decks per search | Monthly sample | Medium |
| Moxfield | Imports only | **Paste text only** — no scraping (no official API, blocks datacenter IPs) | On demand | High if scraped |
| EDHTop16 / TopDeck.gg | cEDH results, staples (Bracket 4–5 reference) | Public GraphQL; free API 200 req/min | Weekly | Low |
| Owner's collection | What he owns | CSV/text import from ManaBox, Moxfield, Archidekt | On demand | None |

If ever released: Wizards' Fan Content Policy requires free access (ads/donations OK) and an "unofficial" notice;
Scryfall forbids paywalling its data.

### 4b. Deck corpus (real human decks)

EDHREC already *is* aggregated human decks, so it does the heavy lifting for "which cards". A corpus of
individual decks adds what averages hide. It is a calibration layer, not the main signal.

| Use | What the corpus gives that EDHREC averages don't | Phase |
| --- | --- | --- |
| Role targets | Real land / ramp / draw / removal counts and curves per bracket and archetype, instead of rules of thumb | 1 |
| Card packages | Card-to-card lift *within* one commander's decks (which cards travel together, which exclude each other) | 1 |
| Discovery picks | Unusual cards that show up in well-liked decks (high views/likes) but not in averages | 1 |
| Forge opponents | Real, coherent decks per bracket for the pod-lab gauntlets (averages can be incoherent) | 2 |
| Bracket check | A model trained on decks players labelled B1–B5; flags when our label disagrees with how humans label similar decks | 4 |
| Hide-and-predict test | The test set for the quality benchmark | 4 |
| Insurance | Own inclusion and lift stats if EDHREC blocks or changes its JSON | any |

Sources: Archidekt public decks (player-set bracket, tags, views; max 1,000 per search) as the main sample;
EDHTop16/TopDeck.gg tournament lists for Brackets 4–5; Moxfield only via paste. Sampling: for each commander in
use, up to ~300 decks with a player-set bracket, recent (last 12 months) and complete (100 cards, legal);
weight by views/likes as a rough quality signal. Stored in `corpus_deck` / `corpus_deck_card`; refreshed monthly.

## 5. Deck engine (pipeline)

1. **Intake.** Commander (or partners/background), € budget, bracket, game plan or vibe, collection on/off,
   meme mode on/off, must-include / never-include cards.
2. **Deck brief (AI).** Three sentences on how the deck wins, win conditions, expected win turn for the bracket,
   weak points, role targets (lands, ramp, draw, removal, wipes, protection, win cons, theme cards).
   The owner can edit the brief before anything is built — this is where his player knowledge steers.
3. **Candidate pool (code).** Cards legal for color identity and bracket, under a per-card price ceiling.
   From EDHREC lists for that commander/bracket/theme (inclusion + lift), Scryfall function tags, and semantic
   search over card text (finds cards nobody plays yet). Owned cards boosted. Every card has role tags + a score.
4. **Fill slots (AI, structured output).** Picks per role, from the pool only, each with a one-line reason.
   **10–15 discovery slots** reserved for low-inclusion/high-lift or semantic finds — where the human feel comes from.
5. **Mana base (code).** Land count from curve and ramp; colored sources weighted by mana symbols; nonbasics
   bought with leftover budget.
6. **Validate and repair (code → AI loop).** 100 cards, singleton, identity, legality, € total, bracket rules,
   role counts, curve, colored sources. Failures go back to the AI as a precise error list; max 5 loops.
7. **Simulate.** Thousands of goldfish games: mana screw rate, commander cast turn, estimated win turn.
8. **Critic pass (second AI call).** Harsh reviewer names the 5 weakest cards and anti-synergies, proposes swaps;
   code re-validates.
9. **Output.** Deck by category, reason per card, short primer (plan, mulligan guide, key lines), budget upgrade
   path, exports: Moxfield/Archidekt text, Cardmarket wants list.

**Meme mode** flips priorities: theme = hard rule, power = soft rule. Themes can use anything Scryfall can search
(names, flavor text, creature types, art tags: "only cards with frogs in the art"). A playability floor stays on
by default (≥ 33 lands, some ramp and draw). Show a theme-fidelity score.

### Deck brief format (JSON the AI produces, the owner edits)

```json
{
  "commander": ["The Ur-Dragon"],
  "bracket": 3,
  "budget_eur": 150,
  "mode": "normal",
  "plan": "Ramp into 5-7 drop dragons with cost reduction; win with a wide flying board and Dragon Tempest.",
  "win_conditions": ["Dragon Tempest + ETB dragons", "Combat with evasive dragons"],
  "expected_win_turn": [7, 9],
  "weak_points": ["Board wipes", "Slow starts without ramp"],
  "role_targets": { "lands": 36, "ramp": 12, "draw": 9, "removal": 7, "wipes": 2, "protection": 3, "wincons": 4, "theme": 25 },
  "must_include": [], "never_include": [], "pet_cards": []
}
```

## 6. MCP tools (Phase 1)

Exposed by `apps/server` to Claude Desktop. All return compact JSON; all card references are oracle_ids + names.

| Tool | Does |
| --- | --- |
| `get_commander` | Identity, EDHREC deck counts per bracket, top themes, similar commanders |
| `get_edhrec_cards` | Top / high-lift / per-type lists for commander × bracket × theme × budget, with inclusion %, lift, € price |
| `search_cards` | Filtered search: color identity, roles, type, mana value, max €, text, owned-only |
| `semantic_search` | Vector search over card text (and names/flavor for meme mode) |
| `get_combos` | Combos for a commander or a card list (Commander Spellbook), with bracket tags |
| `validate_deck` | Full validator report: errors, warnings, € total, role counts, curve, bracket report |
| `build_mana_base` | Land package for a nonland list + budget |
| `simulate` | Fast goldfish stats (Phase 2: Forge option) |
| `save_deck` | Save brief + list + reasons to SQL Server; returns the web app link |
| `get_collection` | Owned cards, filterable |

Plus a **deckbuilding skill / project instructions** for Claude Desktop that encodes the pipeline above, the
brief format, discovery slots, meme mode, and "only cards returned by tools".

## 7. Bracket and power

Every deck gets two labels: bracket by the rules, and how fast it actually plays
("Bracket 3 by rules · plays like a 2 (wins around turn 9)").

- **Rule check (instant):** Game Changers via Scryfall flag; mass land denial; chained extra turns; two-card combos
  classified by Commander Spellbook `estimate-bracket`. No separate tutor limit since Oct 2025.
- **Speed check vs official turn targets:** B1 ≥ 9, B2 ≥ 8, B3 ≥ 6, B4 ≥ 4 turns before anyone wins or loses.

| Simulator | How | Speed | Use |
| --- | --- | --- | --- |
| Fast goldfish (`packages/sim`) | Simplified solo games: lands, ramp, draw, casting by mana value, when the win con/combo assembles | Thousands of games in seconds | Every build and swap |
| Deep sim (Forge) | Forge sim mode: `sim -d deck1 deck2 deck3 -f commander`, vs 3 reference decks of the target bracket | Minutes per batch | On demand, interaction-adjusted win turn |

Forge's AI misplays and may lag on new cards → show ranges. Run Forge as a separate process (copyleft licence).

## 8. Web app, backend, AI access

- **Web app:** React + TypeScript (Vite), served by the local server, shares `packages/rules`.
  Screens: deck library → new-deck wizard + brief editor → deck view by role → card sheet ("why it's here", swaps)
  → simulation results → collection → Cardmarket buy list → settings (default bracket, € budget, pet cards).
- **Database:** SQL Server 2025 Express in SSMS (free; 50 GB/db, 4 cores, ~1.4 GB buffer — plenty).
  `VECTOR` type for embeddings; no separate vector store.
- **Server:** TypeScript (Node) + `mssql`: REST API + MCP server.
- **Jobs:** Scryfall daily; EDHREC, Spellbook, Archidekt weekly (Windows Task Scheduler or node-cron).
- **Embeddings:** a local embedding model (e.g. transformers.js) so semantic search needs no extra API.
- **Remote access:** not needed at home; Tailscale or Cloudflare Tunnel only if wanted away from home.
- **AI access:**
  - Claude Pro does **not** include API access (separate pay-per-use product).
  - **Mode A (start here): Claude Desktop + local MCP server** on the Pro plan. Builds happen in chat; decks appear
    in the web app. Counts against Pro usage limits. No public URL needed.
  - **Mode B (optional, Phase 4): Claude API key** for one-click builds in the web app. Pay per token.
    Rough load per deck (estimate): 60–80k input tokens, ~10k output. Use prompt caching for static parts.
  - Do not wire the Pro login into the web app: Anthropic requires apps (incl. Agent SDK) to use API keys.

## 9. Quality testing

- **Benchmark set (30 requests):** 10 popular commanders at Brackets 2 and 3, 10 niche themes (e.g. Temur goad),
  5 meme prompts, 5 tight budgets (€50–100). Re-run after every engine change. Lives in `tests/benchmarks`.
- **Hide-and-predict:** 50 well-rated, bracket-tagged human decks; hide 15 non-staple cards; score the engine's picks.
- **Blind comparison:** owner + playgroup pick between engine deck, EDHREC average deck, a competitor's deck.
- **Play log:** after real games, rate the deck and flag dead cards; feeds preferences.

| Metric | Target |
| --- | --- |
| Decks passing every hard rule | 100% |
| Simulated win turn inside the bracket window | ≥ 90% |
| Blind picks over the EDHREC average deck | ≥ 60% |
| Theme fidelity in meme mode | ≥ 80% of non-land cards on theme |

## 10. Risks

| Risk | Impact | Fallback |
| --- | --- | --- |
| EDHREC changes/blocks JSON | Lose inclusion + lift | Own stats from sampled Archidekt decks; keep last good cache |
| Decks come out bland | Fails the main goal | Discovery slots, critic pass, blind tests |
| Forge misplays / lacks new cards | Noisy win-turn estimates | Ranges; rely on fast sim day to day |
| Scope creep | Never ships | Strict phases; engine useful before any UI exists |
| Card missing € price | Budget check fails | Converted USD, flagged as estimate |
| Brackets/bans/Game Changers change | Wrong labels | Weekly sync from Scryfall flags + release-day job |
| Pro usage limits too tight for full builds | Builds stall mid-chat | Measure on first 5 decks; Mode B fallback |

Open questions: is the EDHREC `id` a Scryfall card ID (confirm in Phase 0)? Will anyone besides the owner use it?

## Sources

- Scryfall API docs — https://scryfall.com/docs/api
- Scryfall: User-Agent and Accept headers required — https://scryfall.com/blog/category/api
- Wizards Fan Content Policy — https://company.wizards.com/en/legal/fancontentpolicy
- Commander Brackets Beta Update, Oct 21 2025 — https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025
- Commander Brackets Beta Update, Feb 9 2026 — https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026
- EDHREC: From Synergy to Lift — https://edhrec.com/articles/from-synergy-to-lift-the-math-behind-edhrecs-new-era
- Commander Spellbook backend — https://github.com/SpaceCowMedia/commander-spellbook-backend
- Commander Spellbook bracket endpoint — https://moxfield.nolt.io/367
- Archidekt API notes — https://www.npmjs.org/package/archidekt
- EDHTop16 API — https://edhtop16.com/llms.txt
- TopDeck.gg API — https://topdeck.gg/docs/tournaments-v2
- Forge AI / simulation mode — https://github.com/Card-Forge/forge/wiki/ai
- Draftsim: Best Deck Builders for Commander (May 2026) — https://draftsim.com/mtg-edh-deck-builder/
- DeckCheck rubric — https://deckcheck.co/rubric
- SQL Server Express 2025 — https://www.bacloud.com/en/blog/234/sql-server-express-2025-free-version-new-features-for-developers.html
- Claude paid plans don't include API — https://support.claude.com/en/articles/9876003
- Remote MCP connectors (Pro+) — https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
- Agent SDK (API keys, not claude.ai login) — https://code.claude.com/docs/en/agent-sdk/overview
