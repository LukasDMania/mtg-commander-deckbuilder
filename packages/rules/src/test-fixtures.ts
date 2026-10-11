// Hand-made card fixtures for unit tests. Oracle ids are fake; card facts are simplified but realistic.
import type { CardInfo, Color } from './types.js';

let n = 0;
function card(name: string, typeLine: string, mv: number, ci: Color[], extra: Partial<CardInfo> = {}): CardInfo {
  n += 1;
  return {
    oracleId: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    name,
    manaValue: mv,
    typeLine,
    colorIdentity: ci,
    legalCommander: true,
    isGameChanger: false,
    canBeCommander: false,
    priceEur: 0.5,
    ...extra,
  };
}
const legendary = (name: string, mv: number, ci: Color[], extra: Partial<CardInfo> = {}) =>
  card(name, 'Legendary Creature — Test', mv, ci, { canBeCommander: true, ...extra });

export const FIXTURE_CARDS: CardInfo[] = [
  legendary('The Ur-Dragon', 9, ['W', 'U', 'B', 'R', 'G'], { priceEur: 8 }),
  legendary("Atraxa, Praetors' Voice", 4, ['W', 'U', 'B', 'G'], { priceEur: 5 }),
  legendary('Tymna the Weaver', 3, ['W', 'B'], { partnerKinds: ['partner'] }),
  legendary("Kraum, Ludevic's Opus", 5, ['U', 'R'], { partnerKinds: ['partner'] }),
  legendary('Pir, Imaginative Rascal', 3, ['G'], { partnerKinds: ['partner-with'], partnerWith: 'Toothy, Imaginary Friend' }),
  legendary('Toothy, Imaginary Friend', 4, ['U'], { partnerKinds: ['partner-with'], partnerWith: 'Pir, Imaginative Rascal' }),
  legendary('Wilson, Refined Grizzly', 2, ['G'], { partnerKinds: ['choose-background'] }),
  card('Raised by Giants', 'Legendary Enchantment — Background', 6, ['G'], { canBeCommander: true, partnerKinds: ['background'] }),
  card('Sol Ring', 'Artifact', 1, [], { priceEur: 1.5, roles: ['ramp', 'mana-rock'] }),
  card('Cultivate', 'Sorcery', 3, ['G'], { priceEur: 0.3, roles: ['ramp'] }),
  card('Lightning Bolt', 'Instant', 1, ['R'], { priceEur: 0.8, roles: ['removal'] }),
  card('Rhystic Study', 'Enchantment', 3, ['U'], { isGameChanger: true, priceEur: 30, roles: ['card-draw'] }),
  card('Smothering Tithe', 'Enchantment', 4, ['W'], { isGameChanger: true, priceEur: 20 }),
  card('Cyclonic Rift', 'Instant', 2, ['U'], { isGameChanger: true, priceEur: 25 }),
  card('Demonic Tutor', 'Sorcery', 2, ['B'], { isGameChanger: true, priceEur: 35, roles: ['tutor'] }),
  card('Vampiric Tutor', 'Instant', 1, ['B'], { isGameChanger: true, priceEur: 40, roles: ['tutor'] }),
  card('Armageddon', 'Sorcery', 4, ['W'], { roles: ['mass-land-denial'] }),
  card('Time Warp', 'Sorcery', 5, ['U'], { roles: ['extra-turn'] }),
  card('Temporal Manipulation', 'Sorcery', 5, ['U'], { roles: ['extra-turn'] }),
  card('Capture of Jingzhou', 'Sorcery', 5, ['U'], { roles: ['extra-turn'] }),
  card("Thassa's Oracle", 'Creature — Merfolk Wizard', 2, ['U']),
  card('Demonic Consultation', 'Instant', 1, ['B']),
  card('Exquisite Blood', 'Enchantment', 5, ['B']),
  card('Sanguine Bond', 'Enchantment', 5, ['B']),
  card('Dockside Extortionist', 'Creature — Goblin Pirate', 2, ['R'], { legalCommander: false }),
  card('Relentless Rats', 'Creature — Rat', 3, ['B'], { anyNumberAllowed: true, priceEur: 0.2 }),
  card('Seven Dwarves', 'Creature — Dwarf', 3, ['R'], { maxCopies: 7, priceEur: 0.2 }),
  card('Fire // Ice', 'Instant // Instant', 4, ['U', 'R']),
  card('Mystery Card', 'Artifact', 2, [], { priceEur: null }),
  card('Converted Card', 'Artifact', 2, [], { priceEur: 3, priceIsEstimate: true }),
  card('Nazgûl', 'Creature — Wraith Knight', 3, ['B'], { maxCopies: 9 }),
  card('Plains', 'Basic Land — Plains', 0, [], { priceEur: 0.05 }),
  card('Island', 'Basic Land — Island', 0, [], { priceEur: 0.05 }),
  card('Swamp', 'Basic Land — Swamp', 0, [], { priceEur: 0.05 }),
  card('Mountain', 'Basic Land — Mountain', 0, [], { priceEur: 0.05 }),
  card('Forest', 'Basic Land — Forest', 0, [], { priceEur: 0.05 }),
  card('Command Tower', 'Land', 0, [], { priceEur: 0.2 }),
];
// Note: basic lands have an empty color identity here for simplicity. The validator uses whatever
// color_identity the card data says, so check what Scryfall reports for basics on the first import.

/** Build a 100-card list: commanders + given cards + Forests/Islands… filler to reach 100. */
export function makeDeck(
  commanders: string[],
  cards: [string, number][],
  filler = 'Forest',
): { commanders: { name: string; qty: number }[]; cards: { name: string; qty: number }[] } {
  const listed = commanders.length + cards.reduce((s, [, q]) => s + q, 0);
  const deckCards = cards.map(([name, qty]) => ({ name, qty }));
  if (listed < 100) deckCards.push({ name: filler, qty: 100 - listed });
  return { commanders: commanders.map((name) => ({ name, qty: 1 })), cards: deckCards };
}
