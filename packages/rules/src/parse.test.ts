import { describe, expect, it } from 'vitest';
import { exportDeckList, normalizeCardName, parseDecklist, toDeckList } from './parse.js';

describe('parseDecklist', () => {
  it('reads quantities in every common form, set codes, collector numbers and foil markers', () => {
    const { entries, problems } = parseDecklist(
      ['1 Sol Ring', '1x Arcane Signet', 'Command Tower', '1 Cultivate (C21) 263', '1 Swords to Plowshares (STA) 10 *F*', '12 Forest'].join('\n'),
    );
    expect(problems).toEqual([]);
    expect(entries.map((e) => [e.qty, e.name])).toEqual([
      [1, 'Sol Ring'],
      [1, 'Arcane Signet'],
      [1, 'Command Tower'],
      [1, 'Cultivate'],
      [1, 'Swords to Plowshares'],
      [12, 'Forest'],
    ]);
    expect(entries[3]).toMatchObject({ setCode: 'c21', collectorNumber: '263' });
    expect(entries[4]).toMatchObject({ setCode: 'sta', collectorNumber: '10', foil: true });
  });

  it('follows section headers with or without // and :', () => {
    const { entries } = parseDecklist(
      ['Commander', '1 The Ur-Dragon', '', '// Deck', '1 Sol Ring', 'SIDEBOARD:', '1 Lightning Bolt', 'Maybeboard', '1 Cyclonic Rift'].join('\n'),
    );
    expect(entries.map((e) => [e.name, e.section])).toEqual([
      ['The Ur-Dragon', 'commander'],
      ['Sol Ring', 'main'],
      ['Lightning Bolt', 'sideboard'],
      ['Cyclonic Rift', 'maybeboard'],
    ]);
  });

  it('understands Archidekt categories, flags and labels', () => {
    const { entries } = parseDecklist(
      [
        '1x The Ur-Dragon (cmm) 361 [Commander{top}]',
        '1x Sol Ring (c21) 263 [Ramp,Artifact] ^Have,#37d67a^',
        '1x Lightning Bolt [Maybeboard{noDeck}{noPrice}]',
        '1x Cultivate [Sideboard{noDeck}]',
      ].join('\n'),
    );
    expect(entries.map((e) => [e.name, e.section])).toEqual([
      ['The Ur-Dragon', 'commander'],
      ['Sol Ring', 'main'],
      ['Lightning Bolt', 'maybeboard'],
      ['Cultivate', 'sideboard'],
    ]);
    expect(entries[1]?.categories).toEqual(['Ramp', 'Artifact']);
    expect(entries[1]?.setCode).toBe('c21');
  });

  it('skips comments and the Arena "About" block', () => {
    const { entries, problems } = parseDecklist(['About', 'Name My Deck', '# a comment', 'Deck', '1 Sol Ring'].join('\n'));
    expect(problems).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring']);
  });

  it('keeps split/double-faced names intact', () => {
    const { entries } = parseDecklist('1 Fire // Ice (MH2) 290');
    expect(entries[0]?.name).toBe('Fire // Ice');
  });
});

describe('toDeckList', () => {
  it('merges duplicates, drops side/maybe boards, keeps companion separate', () => {
    const parsed = parseDecklist(
      ['Commander', '1 The Ur-Dragon', 'Deck', '10 Forest', '5 Forest', '1 Sol Ring', 'Companion', '1 Jegantha, the Wellspring', 'Sideboard', '1 Lightning Bolt'].join('\n'),
    );
    const deck = toDeckList(parsed);
    expect(deck.commanders).toEqual([{ name: 'The Ur-Dragon', qty: 1 }]);
    expect(deck.cards).toEqual([
      { name: 'Forest', qty: 15 },
      { name: 'Sol Ring', qty: 1 },
    ]);
    expect(deck.companion).toBe('Jegantha, the Wellspring');
  });

  it('lets the caller name the commander when the list has no commander section', () => {
    const deck = toDeckList(parseDecklist('1 The Ur-Dragon\n1 Sol Ring'), { commanders: ['the ur-dragon'] });
    expect(deck.commanders.map((c) => c.name)).toEqual(['The Ur-Dragon']);
    expect(deck.cards.map((c) => c.name)).toEqual(['Sol Ring']);
  });
});

describe('normalizeCardName', () => {
  it('ignores case, accents, curly apostrophes and spacing around //', () => {
    expect(normalizeCardName('Nazgûl')).toBe('nazgul');
    expect(normalizeCardName('Atraxa, Praetors’ Voice')).toBe("atraxa, praetors' voice");
    expect(normalizeCardName('Fire//Ice')).toBe('fire // ice');
    expect(normalizeCardName('  Sol   Ring ')).toBe('sol ring');
  });
});

describe('exportDeckList', () => {
  const deck = { commanders: [{ name: 'The Ur-Dragon', qty: 1 }], cards: [{ name: 'Sol Ring', qty: 1 }, { name: 'Forest', qty: 98 }] };

  it('round-trips through the text format', () => {
    expect(toDeckList(parseDecklist(exportDeckList(deck)))).toEqual(deck);
  });

  it('round-trips through the Archidekt format and writes role categories', () => {
    const text = exportDeckList(deck, 'archidekt', { 'Sol Ring': 'Ramp' });
    expect(text).toContain('1x The Ur-Dragon [Commander{top}]');
    expect(text).toContain('1x Sol Ring [Ramp]');
    expect(toDeckList(parseDecklist(text))).toEqual(deck);
  });
});
