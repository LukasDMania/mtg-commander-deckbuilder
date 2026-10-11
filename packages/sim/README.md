# @cdb/sim — goldfish lab

v0 simulates lands and mana: mulligans (London + free first), land drops, rocks, dorks, ramp spells, commander
cast turn, screw/flood, mana by turn. Design and roadmap: `docs/SIMULATION.md`.

```ts
import { runGoldfish, compareGoldfish } from '@cdb/sim';

const report = runGoldfish(deck, { games: 10_000, seed: 1 });
report.screw.rate; report.commander?.turnWhenCast.p50; report.manaByTurn[3].mean;

// Paired A/B: same shuffles for both decks; keep the swapped card at the same library index.
const { diffs } = compareGoldfish(deckA, deckB, { games: 10_000 });
diffs.find((d) => d.metric === 'commander_turn'); // meanDiff, ci95, significant
```

A `SimDeck` is `{ commander?: { name, manaValue }, library: SimCard[] }` with `SimCard.kind` one of
`land | rock | dork | ramp | spell`. Mapping real cards to these kinds is a Phase 1 task.
