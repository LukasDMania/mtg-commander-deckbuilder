# @cdb/sim — goldfish lab

Plays your deck alone thousands of times and measures it. Design: `docs/SIMULATION.md`; notes: `docs/phases/phase-2.md`.

```ts
import { runGoldfish, compareGoldfish, landSweep, cardImpact, mulliganGuide, bracketSpeedCheck } from '@cdb/sim';

const report = runGoldfish(deck, { games: 10_000, seed: 1 });
report.win.turnWhenWon.p50; report.firstKill; report.commander?.turnWhenCast.p50;
report.screw.rate; report.colorScrew.rate; report.flood.rate; report.manaByTurn; report.cards; // per-card dead rates

compareGoldfish(deckA, deckB);         // paired A/B on the same shuffles; diffs with 95% CI + significant flag
landSweep(deck, { from: 32, to: 40 }); // rows per land count + recommendation
cardImpact(deck);                       // leave-one-out ranking of what each card is worth
mulliganGuide(deck);                    // keep/mulligan table by lands × cheap mana sources + plain rules
bracketSpeedCheck(report, 3);           // "too fast" if > 10% of unopposed wins come before the bracket's minimum turn
```

A `SimDeck` is `{ commander?, library: SimCard[], combos?: { name, pieces }[] }`. `SimCard.kind` is one of
`land | rock | dork | ramp | draw | engine | tutor | reducer | creature | interaction | spell | blank`, with colors,
pips, power and so on (see `src/types.ts`). Building these from real card data is a Phase 1/2 task in
`packages/data`.

Determinism: same deck + same seed → identical report. Paired comparisons need the swapped card at the same
library index in both decks.
