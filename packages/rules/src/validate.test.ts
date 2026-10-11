import { describe, expect, it } from 'vitest';
import { createLookup } from './lookup.js';
import { FIXTURE_CARDS, makeDeck } from './test-fixtures.js';
import type { ComboInfo } from './types.js';
import { validateDeck, type IssueCode } from './validate.js';

const lookup = createLookup(FIXTURE_CARDS);
const codes = (r: { errors: { code: IssueCode }[] }) => r.errors.map((e) => e.code);
const warnCodes = (r: { warnings: { code: IssueCode }[] }) => r.warnings.map((e) => e.code);

describe('validateDeck — basics', () => {
  it('accepts a legal 100-card deck and totals the price', () => {
    const r = validateDeck(makeDeck(['The Ur-Dragon'], [['Sol Ring', 1], ['Cultivate', 1], ['Lightning Bolt', 1]]), lookup);
    expect(r.ok).toBe(true);
    expect(r.cardCount).toBe(100);
    expect(r.colorIdentity).toEqual(['W', 'U', 'B', 'R', 'G']);
    // 8 + 1.5 + 0.3 + 0.8 + 96 Forests × 0.05
    expect(r.price.totalEur).toBeCloseTo(15.4, 2);
    expect(r.stats.lands).toBe(96);
    expect(r.stats.nonlands).toBe(3);
    expect(r.stats.curve[1]).toBe(2);
    expect(r.stats.curve[3]).toBe(1);
  });

  it('rejects the wrong deck size', () => {
    const deck = makeDeck(['The Ur-Dragon'], [['Sol Ring', 1]]);
    deck.cards[1]!.qty -= 1; // 99 cards
    expect(codes(validateDeck(deck, lookup))).toEqual(['DECK_SIZE']);
  });

  it('reports unknown cards without a duplicate size error', () => {
    const r = validateDeck(makeDeck(['The Ur-Dragon'], [['Not A Real Card', 1]]), lookup);
    expect(codes(r)).toEqual(['UNKNOWN_CARD']);
    expect(r.errors[0]?.cards).toEqual(['Not A Real Card']);
  });

  it('enforces singleton but allows basics, any-number cards and up-to-N cards', () => {
    expect(codes(validateDeck(makeDeck(['The Ur-Dragon'], [['Sol Ring', 2]]), lookup))).toEqual(['SINGLETON']);
    expect(validateDeck(makeDeck(['The Ur-Dragon'], [['Relentless Rats', 30]]), lookup).ok).toBe(true);
    expect(validateDeck(makeDeck(['The Ur-Dragon'], [['Seven Dwarves', 7]]), lookup).ok).toBe(true);
    expect(codes(validateDeck(makeDeck(['The Ur-Dragon'], [['Seven Dwarves', 8]]), lookup))).toEqual(['SINGLETON']);
    expect(validateDeck(makeDeck(['The Ur-Dragon'], [['Nazgul', 9]]), lookup).ok).toBe(true);
  });

  it('merges different spellings of the same card before the singleton check', () => {
    const r = validateDeck(makeDeck(['The Ur-Dragon'], [['Fire // Ice', 1], ['Fire', 1]]), lookup);
    expect(codes(r)).toEqual(['SINGLETON']);
  });

  it('rejects cards outside the color identity', () => {
    const r = validateDeck(makeDeck(["Atraxa, Praetors' Voice"], [['Lightning Bolt', 1]]), lookup);
    expect(codes(r)).toEqual(['COLOR_IDENTITY']);
    expect(r.errors[0]?.cards).toEqual(['Lightning Bolt']);
  });

  it('rejects banned cards', () => {
    expect(codes(validateDeck(makeDeck(['The Ur-Dragon'], [['Dockside Extortionist', 1]]), lookup))).toEqual(['NOT_LEGAL']);
  });

  it('rejects the commander also listed in the deck', () => {
    expect(codes(validateDeck(makeDeck(['The Ur-Dragon'], [['The Ur-Dragon', 1]]), lookup))).toEqual(['COMMANDER_IN_DECK']);
  });

  it('enforces the budget and warns about missing or converted prices', () => {
    const r = validateDeck(makeDeck(['The Ur-Dragon'], [['Mystery Card', 1], ['Converted Card', 1]]), lookup, { budgetEur: 10 });
    expect(codes(r)).toEqual(['OVER_BUDGET']);
    expect(warnCodes(r)).toEqual(['PRICE_MISSING', 'PRICE_ESTIMATED']);
    expect(r.price.missing).toEqual(['Mystery Card']);
  });

  it('can leave the commander out of the budget', () => {
    const deck = makeDeck(['The Ur-Dragon'], []);
    expect(validateDeck(deck, lookup, { budgetEur: 5 }).ok).toBe(false);
    expect(validateDeck(deck, lookup, { budgetEur: 5, includeCommanderInBudget: false }).ok).toBe(true);
  });
});

describe('validateDeck — commanders and pairings', () => {
  it('accepts generic partners and unions their identities', () => {
    const r = validateDeck(makeDeck(['Tymna the Weaver', "Kraum, Ludevic's Opus"], [['Lightning Bolt', 1]], 'Swamp'), lookup);
    expect(r.ok).toBe(true);
    expect(r.colorIdentity).toEqual(['W', 'U', 'B', 'R']);
  });

  it('accepts "partner with" pairs and backgrounds; rejects other pairs', () => {
    expect(validateDeck(makeDeck(['Pir, Imaginative Rascal', 'Toothy, Imaginary Friend'], []), lookup).ok).toBe(true);
    expect(validateDeck(makeDeck(['Wilson, Refined Grizzly', 'Raised by Giants'], []), lookup).ok).toBe(true);
    expect(codes(validateDeck(makeDeck(['Tymna the Weaver', 'The Ur-Dragon'], []), lookup))).toEqual(['INVALID_PAIRING']);
    expect(codes(validateDeck(makeDeck(['Pir, Imaginative Rascal', 'Tymna the Weaver'], []), lookup))).toEqual(['INVALID_PAIRING']);
  });

  it('rejects non-commanders, a lone Background, and missing or extra commanders', () => {
    expect(codes(validateDeck(makeDeck(['Sol Ring'], []), lookup))).toEqual(['NOT_A_COMMANDER']);
    expect(codes(validateDeck(makeDeck(['Raised by Giants'], []), lookup))).toEqual(['NOT_A_COMMANDER']);
    expect(codes(validateDeck(makeDeck([], []), lookup))).toEqual(['NO_COMMANDER']);
    expect(codes(validateDeck(makeDeck(['Tymna the Weaver', "Kraum, Ludevic's Opus", 'The Ur-Dragon'], []), lookup))).toContain(
      'TOO_MANY_COMMANDERS',
    );
  });
});

describe('validateDeck — brackets', () => {
  const fiveGameChangers: [string, number][] = [
    ['Rhystic Study', 1],
    ['Smothering Tithe', 1],
    ['Cyclonic Rift', 1],
    ['Demonic Tutor', 1],
    ['Vampiric Tutor', 1],
  ];
  const oracleCombo: ComboInfo = { id: 'c1', cards: ["Thassa's Oracle", 'Demonic Consultation'], gameEnding: true, early: true };
  const bloodCombo: ComboInfo = { id: 'c2', cards: ['Exquisite Blood', 'Sanguine Bond'], gameEnding: true, early: false };

  it('counts Game Changers against the target bracket', () => {
    const deck = makeDeck(['The Ur-Dragon'], fiveGameChangers);
    const b3 = validateDeck(deck, lookup, { bracket: 3 });
    expect(codes(b3)).toEqual(['GAME_CHANGERS']);
    expect(b3.gameChangers).toHaveLength(5);
    expect(b3.bracket.minimumByRules).toBe(4);
    expect(validateDeck(deck, lookup, { bracket: 4 }).ok).toBe(true);
    const three = makeDeck(['The Ur-Dragon'], fiveGameChangers.slice(0, 3));
    expect(validateDeck(three, lookup, { bracket: 3 }).ok).toBe(true);
    expect(codes(validateDeck(three, lookup, { bracket: 2 }))).toEqual(['GAME_CHANGERS']);
  });

  it('blocks mass land denial below Bracket 4', () => {
    const deck = makeDeck(['The Ur-Dragon'], [['Armageddon', 1]]);
    expect(codes(validateDeck(deck, lookup, { bracket: 3 }))).toEqual(['MASS_LAND_DENIAL']);
    expect(validateDeck(deck, lookup, { bracket: 4 }).ok).toBe(true);
  });

  it('handles extra turns: none in B1, a warning above the soft cap in B2/B3', () => {
    const one = makeDeck(['The Ur-Dragon'], [['Time Warp', 1]]);
    expect(codes(validateDeck(one, lookup, { bracket: 1 }))).toEqual(['EXTRA_TURNS']);
    expect(validateDeck(one, lookup, { bracket: 2 }).warnings).toEqual([]);
    const three = makeDeck(['The Ur-Dragon'], [['Time Warp', 1], ['Temporal Manipulation', 1], ['Capture of Jingzhou', 1]]);
    const r = validateDeck(three, lookup, { bracket: 3 });
    expect(r.ok).toBe(true);
    expect(warnCodes(r)).toEqual(['EXTRA_TURNS']);
    expect(r.bracket.minimumByRules).toBe(4);
  });

  it('allows only late two-card combos in B3 and none in B2', () => {
    const early = makeDeck(['The Ur-Dragon'], [["Thassa's Oracle", 1], ['Demonic Consultation', 1]]);
    const late = makeDeck(['The Ur-Dragon'], [['Exquisite Blood', 1], ['Sanguine Bond', 1]]);
    const combos = [oracleCombo, bloodCombo];
    expect(codes(validateDeck(early, lookup, { bracket: 3, combos }))).toEqual(['TWO_CARD_COMBO']);
    expect(validateDeck(late, lookup, { bracket: 3, combos }).ok).toBe(true);
    expect(codes(validateDeck(late, lookup, { bracket: 2, combos }))).toEqual(['TWO_CARD_COMBO']);
    expect(validateDeck(late, lookup, { combos }).combosPresent.map((c) => c.id)).toEqual(['c2']);
  });

  it('reports the minimum bracket with reasons even without a target', () => {
    const r = validateDeck(makeDeck(['The Ur-Dragon'], [['Rhystic Study', 1]]), lookup);
    expect(r.bracket.minimumByRules).toBe(3);
    expect(r.bracket.reasons).toEqual(['1 Game Changer(s)']);
    expect(validateDeck(makeDeck(['The Ur-Dragon'], []), lookup).bracket.minimumByRules).toBe(1);
  });
});
