import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_OPTIONS, alwaysKeep, playGame } from './game.js';
import { costOf, findPayment } from './mana.js';
import { Rng } from './rng.js';
import { runGoldfish } from './runner.js';
import type { GameOptions, SimCard, SimDeck } from './types.js';

const land = (colors: string, extra: Partial<SimCard> = {}): SimCard => ({ name: `Land ${colors}`, kind: 'land', manaValue: 0, colors, basic: colors.length === 1, ...extra });
const forest = land('G');
const island = land('U');
const filler = (mv: number): SimCard => ({ name: `Filler ${mv}`, kind: 'spell', manaValue: mv, pips: {} });
const repeat = (c: SimCard, n: number) => Array.from({ length: n }, () => c);
const ordered = (overrides: Partial<GameOptions> = {}): GameOptions => ({
  ...DEFAULT_GAME_OPTIONS,
  keepPolicy: alwaysKeep,
  noShuffle: true,
  ...overrides,
});
const pad = (cards: SimCard[], to = 99): SimCard[] => [...cards, ...repeat(filler(30), to - cards.length)];

describe('mana payment with colors', () => {
  it('finds a payment whenever one exists (matching, not greedy)', () => {
    // Greedy would spend the any-color unit on G and fail U.
    expect(findPayment(['WUBRG', 'G'], costOf(2, { G: 1, U: 1 }))).not.toBeNull();
    expect(findPayment(['G', 'U', 'WUBRG'], costOf(3, { U: 1, G: 1 }))).not.toBeNull();
    expect(findPayment(['G', 'WUBRG'], costOf(2, { B: 2 }))).toBeNull();
  });

  it('pays {C} only with colorless mana and generic with the least flexible units', () => {
    expect(findPayment(['WUBRG'], costOf(1, { C: 1 }))).toBeNull();
    expect(findPayment(['C'], costOf(1, { C: 1 }))).not.toBeNull();
    const used = findPayment(['WUBRG', 'C', 'G'], costOf(2, { G: 1 }));
    expect(used?.sort()).toEqual([1, 2]); // G for the pip, C for generic; the any-color land is saved
  });

  it('applies cost reduction to the generic part only', () => {
    expect(costOf(6, { R: 2 }, 2)).toEqual({ generic: 2, pips: ['R', 'R'] });
    expect(costOf(2, { R: 2 }, 5)).toEqual({ generic: 0, pips: ['R', 'R'] });
  });
});

describe('colors in games', () => {
  it('flags color screw when the lands make the wrong color', () => {
    const blue: SimCard = { name: 'Blue 2-drop', kind: 'spell', manaValue: 2, pips: { U: 1 } };
    const deck: SimDeck = { library: [...repeat(forest, 40), ...repeat(blue, 59)] };
    const r = runGoldfish(deck, { games: 2000, keepPolicy: alwaysKeep });
    expect(r.colorScrew.rate).toBeGreaterThan(0.9);
    const fixed = runGoldfish({ library: [...repeat(forest, 20), ...repeat(island, 20), ...repeat(blue, 59)] }, { games: 2000, keepPolicy: alwaysKeep });
    expect(fixed.colorScrew.rate).toBeLessThan(0.1);
  });

  it('plays the land that adds a missing color first', () => {
    const blue: SimCard = { name: 'Blue', kind: 'spell', manaValue: 1, pips: { U: 1 } };
    const deck: SimDeck = { library: pad([forest, island, blue, filler(30), filler(30), filler(30), filler(30)]) };
    const r = playGame(deck, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 1 }));
    expect(r.trace.castTurn[1]).toBe(1); // Island played turn 1
    expect(r.trace.castTurn[0]).toBe(-1); // Forest still in hand
    expect(r.trace.castTurn[2]).toBe(1); // blue spell cast
  });
});

describe('card behaviors', () => {
  it('draw spells draw immediately; engines draw from the next turn', () => {
    const harmonize: SimCard = { name: 'Harmonize', kind: 'draw', manaValue: 1, draws: 3 };
    const arena: SimCard = { name: 'Arena', kind: 'engine', manaValue: 1, draws: 1 };
    const d1 = playGame({ library: pad([forest, harmonize, filler(30), filler(30), filler(30), filler(30), filler(30)]) }, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 1 }));
    expect(d1.cardsSeen[0]).toBe(10);
    const d2 = playGame({ library: pad([forest, arena, filler(30), filler(30), filler(30), filler(30), filler(30)]) }, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 2 }));
    expect(d2.cardsSeen).toEqual([7, 9]); // T2: normal draw + engine draw
    expect(d2.engineTurn).toBe(1);
  });

  it('reducers make matching spells cheaper', () => {
    const shaman: SimCard = { name: 'Shaman', kind: 'reducer', manaValue: 1, reduces: 2, reducesTag: 'dragon' };
    const dragon: SimCard = { name: 'Dragon', kind: 'creature', manaValue: 5, power: 5, tags: ['dragon'] };
    const deck: SimDeck = { library: pad([forest, forest, forest, shaman, dragon, filler(30), filler(30)]) };
    const r = playGame(deck, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 3 }));
    expect(r.trace.castTurn[3]).toBe(1); // Shaman turn 1
    expect(r.trace.castTurn[4]).toBe(3); // Dragon (5 − 2) on turn 3 with 3 lands
  });

  it('holds interaction and never casts it', () => {
    const removal: SimCard = { name: 'Removal', kind: 'interaction', manaValue: 1 };
    const r = playGame({ library: pad([forest, forest, removal, filler(30), filler(30), filler(30), filler(30)]) }, new Rng(1), ordered({ maxTurns: 3 }));
    expect(r.trace.castTurn[2]).toBe(-1);
    expect(r.heldInteraction).toEqual([1, 1, 1]);
  });
});

describe('combos and tutors', () => {
  const oracle: SimCard = { name: "Thassa's Oracle", kind: 'creature', manaValue: 2, pips: { U: 2 }, power: 1 };
  const consult: SimCard = { name: 'Demonic Consultation', kind: 'spell', manaValue: 1, pips: { B: 1 }, permanent: false };
  const swamp = land('B');
  const combos = [{ name: 'Oracle + Consultation', pieces: ["Thassa's Oracle", 'Demonic Consultation'] }];

  it('holds a non-permanent combo piece and wins when all pieces are castable together', () => {
    const deck: SimDeck = { library: pad([island, island, swamp, oracle, consult, filler(30), filler(30)]), combos };
    const r = playGame(deck, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 4 }));
    // T1 Island, T2 Island → Oracle castable (UU) but it's a combo piece: cast as a permanent piece on T2;
    // T3 Swamp → Consultation (B) completes the combo.
    expect(r.trace.castTurn[4]).toBe(3);
    expect(r.comboTurn).toBe(3);
    expect(r.winTurn).toBe(3);
    expect(r.comboName).toBe('Oracle + Consultation');
  });

  it('tutors find the missing combo piece', () => {
    const tutor: SimCard = { name: 'Tutor', kind: 'tutor', manaValue: 1, pips: { B: 1 } };
    const deck: SimDeck = {
      library: pad([swamp, island, island, tutor, oracle, filler(30), filler(30), ...repeat(island, 20), consult]),
      combos,
    };
    const r = playGame(deck, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 5 }));
    // T1: Island first (Oracle needs UU, the bigger color need). T2: Swamp → Tutor (B) finds Consultation.
    // T3: Island → U, U, B: Oracle + Consultation together → combo.
    expect(r.trace.castTurn[3]).toBe(2);
    expect(r.trace.drawnTurn[27]).toBe(2);
    expect(r.comboTurn).toBe(3);
  });

  it('counts the commander as a combo piece', () => {
    const deck: SimDeck = {
      commander: { name: 'Cmd', manaValue: 2 },
      library: pad([forest, forest, forest, { name: 'Piece', kind: 'spell', manaValue: 1 }, filler(30), filler(30), filler(30)]),
      combos: [{ name: 'Cmd combo', pieces: ['Cmd', 'Piece'] }],
    };
    const r = playGame(deck, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 3 }));
    expect(r.comboTurn).toBe(2); // T2: 2 lands → commander; T1 Piece (permanent spell) already down
    expect(r.commanderTurn).toBe(2);
  });
});

describe('combat clock', () => {
  it('commander damage kills one opponent per three hits of 7', () => {
    const deck: SimDeck = { commander: { name: 'Beater', manaValue: 1, power: 7, evasion: 1 }, library: pad([forest, ...repeat(filler(30), 6)]) };
    const r = playGame(deck, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 10 }));
    expect(r.commanderTurn).toBe(1);
    expect(r.firstKillTurn).toBe(4); // hits on T2, T3, T4 = 21 commander damage
    expect(r.tableKillTurn).toBe(10);
    expect(r.winTurn).toBe(10);
    expect(r.damageDealt[9]).toBe(63);
  });

  it('regular damage overflows to the next opponent; summoning sickness and haste apply', () => {
    const big: SimCard = { name: 'Big', kind: 'creature', manaValue: 1, power: 50, evasion: 1 };
    const hasty: SimCard = { name: 'Hasty', kind: 'creature', manaValue: 1, power: 10, evasion: 1, haste: true };
    const r = playGame({ library: pad([forest, big, hasty, filler(30), filler(30), filler(30), filler(30)]) }, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 3 }));
    // T1: one land → cast Big (1 mana) only. T2: no land, still 1 mana → Hasty attacks for 10 + Big for 50.
    expect(r.damageDealt).toEqual([0, 60, 120]);
    expect(r.firstKillTurn).toBe(2);
    expect(r.tableKillTurn).toBe(3);
  });

  it('applies the unblocked share to creatures without evasion', () => {
    const bear: SimCard = { name: 'Bear', kind: 'creature', manaValue: 1, power: 4 };
    const r = playGame({ library: pad([forest, bear, filler(30), filler(30), filler(30), filler(30), filler(30)]) }, new Rng(1), ordered({ drawOnFirstTurn: false, maxTurns: 2, groundUnblockedShare: 0.25 }));
    expect(r.damageDealt).toEqual([0, 1]);
  });
});

describe('per-card stats', () => {
  it('reports dead cards and cast rates', () => {
    const brick: SimCard = { name: 'Brick', kind: 'spell', manaValue: 20 };
    const deck: SimDeck = { library: [...repeat(forest, 38), brick, ...repeat(filler(2), 60)] };
    const r = runGoldfish(deck, { games: 3000 });
    const brickStat = r.cards.find((c) => c.name === 'Brick');
    expect(brickStat?.deadWhenDrawn).toBe(1);
    expect(brickStat?.drawnRate).toBeGreaterThan(0.1);
    expect(brickStat?.drawnRate).toBeLessThan(0.3); // ~17 of 99 cards seen by turn 10
    expect(r.cards.find((c) => c.name === 'Filler 2')?.castWhenDrawn).toBeGreaterThan(0.95);
    expect(r.cards[0]?.name).toBe('Brick'); // sorted by dead rate
  });
});
