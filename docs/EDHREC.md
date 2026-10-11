# EDHREC JSON endpoint map

Unofficial. EDHREC serves each site page as JSON at:

```
https://json.edhrec.com/pages/<site path>.json
```

No key needed. Probed on 2026-10-11 through a fetch tool that **truncated long pages**, so every shape below
must be confirmed with full downloads (Phase 0 task). Update this file when reality differs.

## Endpoints

| Path pattern | Returns | Example (The Ur-Dragon) |
| --- | --- | --- |
| `commanders/{slug}.json` | All decks for a commander: `cardlists`, `bracket_counts`, `budget_counts`, `tag_counts` (themes), `similar`, `panels.mana_curve`, `panels.combocounts`, `panels.taglinks` | `bracket_counts` = `{"1":144,"2":2865,"3":5241,"4":3682,"5":232}` |
| `commanders/{slug}/{bracket}.json` | Same shape, one bracket. `upgraded` confirmed. `exhibition`, `core`, `optimized`, `cedh` expected from site URLs — **confirm** | Upgraded: 5,241 decks |
| `commanders/{slug}/{theme}.json` | Same shape, one theme; theme slugs from `tag_counts[].slug` | `dragons`: 4,785 decks |
| `commanders/{slug}/{bracket}/{theme}.json` | Bracket × theme | Upgraded Dragons: 146 decks |
| `commanders/{slug}/budget.json` | Budget-tier decks; `expensive.json` likely mirrors it — **confirm** | 5,116 decks |
| `average-decks/{slug}.json` (+ `/{bracket}`, `/{bracket}/{theme}`) | Average deck: `deck.cards` = `{ "<Type>": [["<name>", <count>], …] }`, `deck.commander`, `deck.commander_v2`; `container.json_dict.card.prices` with `cardmarket`, `cardkingdom`, `tcgplayer`, `manapool` (`price`, `slug`); top-level `archidekt` = `[{c,f,q,u}]` (u = UUID) | `["Sol Ring",1]`, `["Forest",2]` |
| `combos/{slug}.json` | Combos seen with the commander: `container.json_dict.cardlists[]` each with `combo.{comboId, colors, count, maxCount, percentage, rank, cardIds, results, nonCardPrerequisiteCount, comboVote{bracket, controversial, earlyScore, prereqScore, resultScore, voteCount}}`, `cardviews` | 1,730 combos; e.g. Dragon Tempest + Ancient Gold Dragon, 27,700 decks, `comboVote.bracket` "3" |
| `commanders/year.json` | Top commanders (past 2 years), 100 per page at `container.json_dict.cardlists[0].cardviews`; `total_pages` 68; next page in `more` = `commanders/year-past2years-1.json` | Rank 1: Y'shtola, Night's Blessed, 56,492 decks |
| `cards/{slug}.json` | Cards often played with a card, `similar`; no prices or oracle text (use Scryfall) | Sol Ring → Mana Vault, Grim Monolith, … |

`comboId` is EDHREC's own id (e.g. `2855-5982`), not a Commander Spellbook id.

## Card lists

Location: `container.json_dict.cardlists[]`, each `{ header, tag, cardviews[] }`.

Tags seen: `newcards`, `topcards`, `highliftcards`, `creatures`, `instants`, `sorceries`, `utilityartifacts`,
`enchantments`, `battles`, `planeswalkers` (+ lands/mana artifacts expected further down — confirm).
Theme pages had no `highliftcards` list in the visible part — confirm.

Card object (`cardviews[]` item):

```json
{
  "id": "a934590b-5c70-4f07-af67-fbe817a99531",
  "name": "Miirym, Sentinel Wyrm",
  "sanitized": "miirym-sentinel-wyrm",
  "slug": "miirym-sentinel-wyrm",
  "url": "/cards/miirym-sentinel-wyrm",
  "synergy": 0.7331448720476411,
  "lift": 7.374791130848962,
  "num_decks": 4302,
  "potential_decks": 5241,
  "trend_zscore": 0.3811386578610339
}
```

- **Inclusion is not stored**: `inclusion = num_decks / potential_decks` (Miirym in Upgraded: 82%).
- `id` looks like a Scryfall card (printing) ID → **confirm** and decide join key (printing id → oracle_id).
- `lift` replaced the old `synergy` score on the site (lift > 1 = played together more than chance;
  median lift across pairs ≈ 1.58 per EDHREC's article). Both fields are present.
- Commander slugs: lowercase, punctuation removed, spaces → `-` (`yshtola-nights-blessed`).
  Partner pairs: `{a}-{b}` — confirm ordering rule.

## Crawl plan

1. Weekly: `commanders/year.json` + all `more` pages → `commander` table.
2. For each commander the owner uses (on demand) and the top ~300 (weekly):
   base page, 5 bracket pages, top 5 theme pages, bracket × theme for Brackets 2 and 3, budget page.
3. Combos page per commander used.
4. Pace: 1 request every 2–3 s, `User-Agent: commander-deck-builder/0.1 (personal)`.
   Store raw JSON in `edhrec_page` (path, fetched_at, status, raw_json); skip if fetched < 7 days ago.
5. Parse into `edhrec_card_stat` (one row per commander × bracket × theme × budget × card × list tag),
   `edhrec_theme`, `edhrec_bracket_count`.

## To investigate

- Deck-based recommendations: Moxfield/Archidekt show "EDHREC suggestions" for a partial list; check edhrec.com
  network traffic for a recommendations endpoint (likely POST). Don't rely on it until confirmed.
- Whether `cardlists` pages paginate (`more`) for long lists.
