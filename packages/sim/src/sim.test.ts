import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_OPTIONS, alwaysKeep, chooseBottom, neverKeep, playGame } from './game.js';
import { Rng, gameSeed } from './rng.js';
import { compareGoldfish, runGoldfish, simulateGames } from './runner.js';
import { hypergeomAtLeast, hypergeomPmf, proportion, quantile, summarize } from './stats.js';
import type { GameOptions, SimCard, SimDeck } from './types.js';

const forest: SimCard = { name: 'Forest', kind: 'land', manaValue: 0, basic: true };
const tapland: SimCard = { name: 'Tapland', kind: 'land', manaValue: 0, entersTapped: true };
const spell = (mv: number, name = `Spell ${mv}`): SimCard => ({ name, kind: 'spell', manaValue: mv });
const solRing: SimCard = { name: 'Sol Ring', kind: 'rock', manaValue: 1, produces: 2 };
const elves: SimCard = { name: 'Llanowar Elves', kind: 'dork', manaValue: 1 };
const cultivate: SimCard = { name: 'Cultivate', kind: 'ramp', manaValue: 3, rampLands: 1, rampTapped: true, rampToHand: 1 };

const repeat = (c: SimCard, n: number) => Array.from({ length: n }, () => c);
/** 37 basic lands + 62 vanilla 3-drops = 99 cards. */
const vanillaDeck = (): SimDeck => ({ library: [...repeat(forest, 37), ...repeat(spell(3), 62)] });
const ordered = (overrides: Partial<GameOptions> = {}): GameOptions => ({
  ...DEFAULT_GAME_OPTIONS,
  keepPolicy: alwaysKeep,
  noShuffle: true,
  ...overrides,
});

describe('Rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 5 }, () => a.nextU32());
    expect(Array.from({ length: 5 }, () => b.nextU32())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.nextU32())).not.toEqual(sa);
    expect(gameSeed(1, 0)).not.toBe(gameSeed(1, 1));
  });

  it('shuffles uniformly enough (each card lands in each position ~equally)', () => {
    const rng = new Rng(7);
    const counts = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
    const trials = 50_000;
    for (let t = 0; t < trials; t++) {
      const arr = rng.shuffle([0, 1, 2, 3, 4]);
      arr.forEach((card, pos) => (counts[card]![pos]! += 1));
    }
    for (const row of counts) for (const c of row) expect(Math.abs(c / trials - 0.2)).toBeLessThan(0.01);
  });
});

describe('stats helpers', () => {
  it('computes quantiles, summaries and Wilson intervals', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const s = summarize([1, 1, 2, 2, 2, 3]);
    expect(s.mean).toBeCloseTo(11 / 6);
    expect(s.histogram).toEqual({ '1': 2, '2': 3, '3': 1 });
    const p = proportion(25, 100);
    expect(p.rate).toBe(0.25);
    expect(p.ci95[0]).toBeGreaterThan(0.17);
    expect(p.ci95[1]).toBeLessThan(0.35);
  });

  it('hypergeometric pmf sums to 1 and matches a known value', () => {
    let total = 0;
    for (let k = 0; k <= 7; k++) total += hypergeomPmf(99, 37, 7, k);
    expect(total).toBeCloseTo(1, 10);
    // P(exactly 3 lands in 7 from 99 with 37 lands) = C(37,3)·C(62,4)/C(99,7)
    expect(hypergeomPmf(99, 37, 7, 3)).toBeCloseTo((7770 * 557845) / 14887031544, 10);
  });
});

describe('mulligans', () => {
  it('London mulligan with a free first mulligan goes 7, 7, 6, 5, 4 and then forces a keep', () => {
    const r = playGame(vanillaDeck(), new Rng(1), { ...DEFAULT_GAME_OPTIONS, keepPolicy: neverKeep });
    expect(r.mulligans).toBe(4);
    expect(r.keptHandSize).toBe(4);
  });

  it('never loses cards: library + hand stays 99 after mulligans with repeated card objects', () => {
    for (let s = 0; s < 50; s++) {
      const r = playGame(vanillaDeck(), new Rng(s), { ...DEFAULT_GAME_OPTIONS, keepPolicy: neverKeep, maxTurns: 1 });
      // 4 kept + 1 draw on turn 1 → 5 seen after the opening 7; cardsSeen counts the 7 looked at plus draws
      expect(r.keptHandSize).toBe(4);
      expect(r.cardsSeen[0]).toBe(8);
    }
    // Full game: by the last turn we must still be drawing real cards (library not shrunk by lost bottoms)
    const deep = playGame(vanillaDeck(), new Rng(3), { ...DEFAULT_GAME_OPTIONS, keepPolicy: neverKeep, maxTurns: 95 });
    // 7 looked at + 95 draws; the library holds 99 - 4 kept = 95 cards, so every draw must succeed
    expect(deep.cardsSeen.at(-1)).toBe(102);
  });

  it('without the free mulligan it goes 7, 6, 5, 4', () => {
    const r = playGame(vanillaDeck(), new Rng(1), { ...DEFAULT_GAME_OPTIONS, keepPolicy: neverKeep, freeFirstMulligan: false });
    expect(r.mulligans).toBe(3);
    expect(r.keptHandSize).toBe(4);
  });

  it('bottoms toward ~3/7 lands, keeping mana sources and cheap spells', () => {
    // Land-heavy hand: keeps both spells, fills the rest with lands, bottoms surplus lands.
    const flood = chooseBottom([forest, forest, forest, forest, forest, spell(6, 'Big'), solRing], 5);
    expect(flood.keep.filter((c) => c.kind === 'land')).toHaveLength(3);
    expect(flood.keep).toContain(solRing);
    expect(flood.keep.map((c) => c.name)).toContain('Big');
    expect(flood.bottom.every((c) => c.kind === 'land')).toBe(true);
    // Spell-heavy hand: 2 lands (≈3/7 of 5), then the cheapest spells; the 6-drop goes to the bottom.
    const spells = chooseBottom([forest, forest, forest, spell(2), spell(3), spell(4), spell(6, 'Big')], 5);
    expect(spells.keep.filter((c) => c.kind === 'land')).toHaveLength(2);
    expect(spells.bottom.map((c) => c.name).sort()).toEqual(['Big', 'Forest']);
  });
});

describe('turn loop (fixed draw order)', () => {
  it('Sol Ring on turn 1 casts a 4-mana commander on turn 2', () => {
    const deck: SimDeck = { commander: { name: 'Cmd', manaValue: 4 }, library: [forest, solRing, forest, forest, forest, forest, spell(5), ...repeat(forest, 92)] };
    const r = playGame(deck, new Rng(1), ordered());
    expect(r.manaAvailable.slice(0, 2)).toEqual([1, 4]);
    expect(r.commanderTurn).toBe(2);
  });

  it('mana dorks are summoning sick for a turn', () => {
    const deck: SimDeck = { library: [forest, elves, spell(6), spell(6), spell(6), spell(6), spell(6), forest, ...repeat(spell(6), 91)] };
    const r = playGame(deck, new Rng(1), ordered());
    // T1: Forest → 1 mana, cast Elves. T2: draw Forest; 2 lands + Elves = 3.
    expect(r.manaAvailable.slice(0, 2)).toEqual([1, 3]);
  });

  it('Cultivate puts a tapped land in play and a land in hand', () => {
    const deck: SimDeck = {
      library: [forest, forest, forest, cultivate, spell(7), spell(7), spell(7), spell(7), spell(7), spell(7), ...repeat(forest, 89)],
    };
    const r = playGame(deck, new Rng(1), ordered({ drawOnFirstTurn: false }));
    // T1–T3: one Forest each; T3: Cultivate (3 mana) → +1 tapped land, +1 Forest to hand.
    // T4: untap 4 lands, play the fetched Forest → 5 lands.
    expect(r.landsInPlay.slice(0, 4)).toEqual([1, 2, 4, 5]);
    expect(r.manaAvailable[3]).toBe(5);
  });

  it('prefers untapped lands and counts tapped lands as no mana that turn', () => {
    const deck: SimDeck = { library: [tapland, forest, ...repeat(spell(9), 97)] };
    const r = playGame(deck, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 2 }));
    expect(r.manaAvailable).toEqual([1, 1]); // T1 Forest (untapped first); T2 Tapland enters tapped
    expect(r.landsInPlay).toEqual([1, 2]);
  });
});

describe('simulator matches exact probability math', () => {
  const games = 60_000;
  const { results } = simulateGames(vanillaDeck(), { games, seed: 123, keepPolicy: alwaysKeep, maxTurns: 6 });

  it('opening-hand land counts follow the hypergeometric distribution', () => {
    for (let k = 0; k <= 7; k++) {
      const observed = results.filter((r) => r.openingLands === k).length / games;
      expect(Math.abs(observed - hypergeomPmf(99, 37, 7, k))).toBeLessThan(0.008);
    }
  });

  it('P(on curve with t lands on turn t) matches P(≥ t lands among the first 7 + t cards)', () => {
    // With one land drop per turn and one draw per turn, lands in play on turn t = min(t, lands seen by turn t).
    for (const t of [2, 3, 4, 5, 6]) {
      const observed = results.filter((r) => (r.landsInPlay[t - 1] ?? 0) >= t).length / games;
      expect(Math.abs(observed - hypergeomAtLeast(99, 37, 7 + t, t))).toBeLessThan(0.008);
    }
  });
});

describe('runner', () => {
  it('is reproducible for the same seed', () => {
    const a = runGoldfish(vanillaDeck(), { games: 2000, seed: 9 });
    const b = runGoldfish(vanillaDeck(), { games: 2000, seed: 9 });
    expect(a).toEqual(b);
    expect(runGoldfish(vanillaDeck(), { games: 2000, seed: 10 })).not.toEqual(a);
  });

  it('reports commander and screw/flood metrics', () => {
    const r = runGoldfish({ ...vanillaDeck(), commander: { name: 'Cmd', manaValue: 4 } }, { games: 5000 });
    expect(r.commander?.castRate.rate).toBeGreaterThan(0.95);
    expect(r.commander?.turnWhenCast.p50).toBe(4);
    expect(r.screw.rate).toBeGreaterThan(0);
    expect(r.screw.rate).toBeLessThan(0.3);
    expect(r.landsByTurn).toHaveLength(10);
  });

  it('paired A/B: identical decks give exactly zero difference', () => {
    const { diffs } = compareGoldfish(vanillaDeck(), vanillaDeck(), { games: 2000 });
    for (const d of diffs) {
      expect(d.meanDiff).toBe(0);
      expect(d.significant).toBe(false);
    }
  });

  it('paired A/B: swapping a 3-drop for Sol Ring speeds up the commander, significantly', () => {
    const base = { ...vanillaDeck(), commander: { name: 'Cmd', manaValue: 5 } };
    const lib = base.library.slice();
    lib[40] = solRing; // same position in B as the 3-drop in A
    const { diffs } = compareGoldfish(base, { ...base, library: lib }, { games: 4000 });
    const cmd = diffs.find((d) => d.metric === 'commander_turn');
    expect(cmd?.meanDiff).toBeLessThan(0);
    expect(cmd?.significant).toBe(true);
  });

  it('runs 10,000 games quickly', () => {
    const t0 = performance.now();
    runGoldfish({ ...vanillaDeck(), commander: { name: 'Cmd', manaValue: 4 } }, { games: 10_000 });
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
