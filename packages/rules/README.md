# @cdb/rules

Pure deck logic — no I/O. Source of truth for legality, deck size, singleton, color identity, € budget and
bracket rules.

```ts
import { parseDecklist, toDeckList, validateDeck, exportDeckList } from '@cdb/rules';

const deck = toDeckList(parseDecklist(pastedText));            // or { commanders: ['…'] } for MTGO lists
const report = validateDeck(deck, lookup, { bracket: 3, budgetEur: 150, combos });
report.ok; report.errors; report.warnings; report.price.totalEur; report.bracket.minimumByRules;
exportDeckList(deck, 'archidekt', { 'Sol Ring': 'Ramp' });
```

- `lookup` is a `CardLookup` (`get(name) → CardInfo`). Tests use `createLookup(FIXTURE_CARDS)`; the app will use a
  SQL-backed lookup from `@cdb/data`.
- Bracket rules live in `src/brackets.ts` (`BRACKET_POLICY`) — edit there when WotC updates the brackets.
- Notes, decisions and open questions: `docs/phases/phase-1.md`.
