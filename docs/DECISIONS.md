# Decision log

| Date | Decision | Why | Alternatives rejected |
| --- | --- | --- | --- |
| 2026-10-11 | Build our own tool instead of using Spellweave/DeckCheck/CommanderBracket/Farseek | Owner wants meme mode, € pricing, explanations, and measured quality; nobody has all features | Using an existing tool |
| 2026-10-11 | AI plans and picks only from code-built candidate pools; code validates everything | Plain LLM deckbuilding produces wrong counts, off-color cards, generic picks | LLM-only generation |
| 2026-10-11 | Web app only (React + Vite), no mobile app | Owner builds decks rarely; web is enough | Expo/React Native, Kotlin Multiplatform, Flutter |
| 2026-10-11 | SQL Server 2025 Express, local, managed in SSMS | Owner's preference; free; 50 GB/db; native VECTOR type | Postgres + pgvector |
| 2026-10-11 | TypeScript everywhere, npm workspaces | One language for rules, server, web, sim | Python backend |
| 2026-10-11 | AI via MCP server in Claude Desktop on the Pro plan; API key optional later | Pro has no API access; MCP lets Pro do the reasoning at no extra cost | Wiring Pro login into the app (not allowed) |
| 2026-10-11 | EDHREC via unofficial JSON pages, polite weekly crawl, raw cache | Most valuable signal (top + high-lift per commander/bracket/theme); no official API | Scraping HTML; skipping EDHREC |
| 2026-10-11 | No Moxfield scraping; paste-text import only | No official API, blocks datacenter IPs | Unofficial API scraping |
| 2026-10-11 | Prices = Cardmarket € via Scryfall `prices.eur`, cheapest printing | Owner buys in Belgium | TCGplayer / Card Kingdom USD |
| 2026-10-11 | Simulation lab is a full phase: goldfish (own engine) + Forge 1v1v1v1 pods | Measured averages over thousands of games are the highest-return feature | Heuristic power scores only |
| 2026-10-11 | Forge runs as a separate process | Copyleft licence + crash isolation | Embedding Forge code |
