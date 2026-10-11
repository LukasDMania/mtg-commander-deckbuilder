import { describe, expect, it } from 'vitest';
import { runGoldfish } from './runner.js';
import { bracketSpeedCheck, cardImpact, landSweep, mulliganGuide } from './tools.js';
import type { SimCard, SimDeck } from './types.js';

const forest: SimCard = { name: 'Forest', kind: 'land', manaValue: 0, colors: 'G', basic: true };
const island: SimCard = { name: 'Island', kind: 'land', manaValue: 0, colors: 'U', basic: true };
const solRing: SimCard = { name: 'Sol Ring', kind: 'rock', manaValue: 1, produces: 2 };
const signet: SimCard = { name: 'Signet', kind: 'rock', manaValue: 2, colors: 'GU' };
const elves: SimCard = { name: 'Elves', kind: 'dork', manaValue: 1, pips: { G: 1 }, colors: 'G' };
const brick: SimCard = { name: 'Brick', kind: 'spell', manaValue: 15 };
const repeat = (c: SimCard, n: number) => Array.from({ length: n }, () => c);
const creature = (mv: number, power: number): SimCard => ({ name: `Beast ${mv}`, kind: 'creature', manaValue: mv, pips: { G: 1 }, power });

/** A plain Simic creature deck with `lands` lands (Forests and Islands), a few rocks/dorks, and filler creatures. */
function simicDeck(lands: number): SimDeck {
  const nonland = [solRing, signet, elves, elves, brick];
  const creatures: SimCard[] = [];
  while (lands + nonland.length + creatures.length < 99) creatures.push(creature(2 + (creatures.length % 5), 2 + (creatures.length % 4)));
  return {
    commander: { name: 'Simic Commander', manaValue: 4, pips: { G: 1, U: 1 }, power: 4 },
    library: [...repeat(forest, Math.ceil(lands / 2)), ...repeat(island, Math.floor(lands / 2)), ...nonland, ...creatures],
  };
}

describe('landSweep', () => {
  it('recommends more lands for a land-light deck and shows screw falling as lands rise', () => {
    const r = landSweep(simicDeck(28), { games: 1500, from: 28, to: 38, objective: 'commander_turn' });
    expect(r.currentLands).toBe(28);
    expect(r.recommended).toBeGreaterThan(30);
    const screws = r.rows.map((row) => row.screw);
    expect(screws[0]).toBeGreaterThan(screws.at(-1) as number);
    expect(r.rows.find((row) => row.lands === 28)?.objectiveVsCurrent.meanDiff).toBe(0);
  });
});

describe('cardImpact', () => {
  it('ranks Sol Ring as helpful and a never-castable brick as exactly neutral', () => {
    const { objective, cards } = cardImpact(simicDeck(36), { games: 1500, objective: 'commander_turn' });
    expect(objective).toBe('commander_turn');
    const sol = cards.find((c) => c.name === 'Sol Ring');
    expect(sol?.impact).toBeGreaterThan(0);
    expect(sol?.significant).toBe(true);
    const b = cards.find((c) => c.name === 'Brick');
    expect(b?.impact).toBe(0);
    expect(cards.find((c) => c.name === 'Forest')).toBeUndefined(); // basics are skipped
  });
});

describe('mulliganGuide', () => {
  it('can judge hands by commander speed instead', () => {
    const g = mulliganGuide(simicDeck(36), { games: 4000, goodGame: 'commander' });
    expect(g.goodGame).toMatch(/commander cast by turn/);
  });

  it('says to mulligan 0–1 landers and keep 3–4 landers, with plain-language rules', () => {
    const g = mulliganGuide(simicDeck(36), { games: 8000 });
    expect(g.goodGame).toMatch(/spends at least \d+(\.\d+)? mana by turn 6/);
    const verdict = (lands: number, cheap: number) => g.buckets.find((b) => b.lands === lands && b.cheapSources === cheap)?.keepFirst7;
    expect(verdict(0, 0)).toBe('mulligan');
    expect(verdict(1, 0)).toBe('mulligan');
    expect(verdict(3, 0)).toBe('keep');
    expect(verdict(4, 0)).toBe('keep');
    expect(g.baselineSix).toBeLessThan(g.baselineFresh7);
    expect(g.rules.length).toBeGreaterThanOrEqual(3);
    expect(g.rules[0]).toMatch(/keep with .*lands/);
  });
});

describe('bracketSpeedCheck', () => {
  const tutor: SimCard = { name: 'Tutor', kind: 'tutor', manaValue: 1 };
  const pieceA: SimCard = { name: 'Piece A', kind: 'spell', manaValue: 1 };
  const pieceB: SimCard = { name: 'Piece B', kind: 'spell', manaValue: 1, permanent: false };
  const fastCombo = (): SimDeck => ({
    library: [...repeat(forest, 33), solRing, ...repeat(tutor, 8), pieceA, pieceB, ...repeat(creature(3, 2), 55)],
    combos: [{ name: 'A + B', pieces: ['Piece A', 'Piece B'] }],
  });

  it('flags a cheap tutor-heavy combo deck as too fast for Brackets 2 and 4 (it often wins before turn 4), fine for cEDH', () => {
    const report = runGoldfish(fastCombo(), { games: 3000 });
    // Each tutor finds one piece, so it needs 2 hits among 10 cards in ~17 seen: about a coin flip by turn 10.
    expect(report.win.byCombo.rate).toBeGreaterThan(0.4);
    expect(bracketSpeedCheck(report, 2).verdict).toBe('too fast');
    expect(bracketSpeedCheck(report, 4).verdict).toBe('too fast');
    expect(bracketSpeedCheck(report, 5).verdict).toBe('ok');
  });

  it('reports when no wins were modelled', () => {
    const report = runGoldfish({ library: [...repeat(forest, 40), ...repeat(brick, 59)] }, { games: 500 });
    expect(bracketSpeedCheck(report, 3).verdict).toBe('no wins found');
  });
});
