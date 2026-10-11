/** Colors in WUBRG order. */
export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];

export type Bracket = 1 | 2 | 3 | 4 | 5;

/**
 * How a commander can be paired with a second commander.
 * - partner:          generic "Partner" (pairs with any other generic Partner)
 * - partner-with:     "Partner with <name>" (pairs only with that card; see `partnerWith`)
 * - friends-forever:  "Friends forever" (pairs with another Friends forever)
 * - choose-background: "Choose a Background" (pairs with a Background enchantment)
 * - background:       a Background enchantment (only as the second commander of a choose-background creature)
 * - doctors-companion: "Doctor's companion" (pairs with a Time Lord Doctor creature)
 * - doctor:           a Time Lord Doctor creature
 */
export type PartnerKind =
  | 'partner'
  | 'partner-with'
  | 'friends-forever'
  | 'choose-background'
  | 'background'
  | 'doctors-companion'
  | 'doctor';

/**
 * Everything the rules package needs to know about a card. Built from the `card` table (Scryfall data)
 * by packages/data; tests use hand-made fixtures.
 */
export interface CardInfo {
  oracleId: string;
  name: string;
  manaValue: number;
  typeLine: string;
  colorIdentity: Color[];
  /** legalities.commander === 'legal' */
  legalCommander: boolean;
  /** From Scryfall data — never a hardcoded list. */
  isGameChanger: boolean;
  /** Legendary creature, or text "can be your commander", or a Background. */
  canBeCommander: boolean;
  partnerKinds?: PartnerKind[];
  /** For 'partner-with': the exact name of the partner card. */
  partnerWith?: string;
  /** "A deck can have any number of cards named …" (Relentless Rats, Shadowborn Apostle, …). */
  anyNumberAllowed?: boolean;
  /** "A deck can have up to N cards named …" (Seven Dwarves: 7, Nazgûl: 9). */
  maxCopies?: number;
  /** Cheapest Cardmarket € price; null/undefined = unknown. */
  priceEur?: number | null;
  /** True when priceEur was converted from USD (no Cardmarket price). */
  priceIsEstimate?: boolean;
  /**
   * Role tags from card_role (scryfall otags / parser / llm / manual). Bracket rules read:
   * 'mass-land-denial', 'extra-turn'.
   */
  roles?: string[];
}

export interface CardLookup {
  /** Resolve by name (case/punctuation-insensitive; double-faced cards by full or front-face name). */
  get(name: string): CardInfo | undefined;
}

export type Section = 'commander' | 'main' | 'sideboard' | 'maybeboard' | 'companion';

export interface DeckEntry {
  qty: number;
  name: string;
  section: Section;
  setCode?: string;
  collectorNumber?: string;
  foil?: boolean;
  /** Archidekt category labels, e.g. ["Ramp"]. */
  categories?: string[];
}

export interface ParsedDeck {
  entries: DeckEntry[];
  /** Lines that could not be understood (line number is 1-based). */
  problems: { line: number; text: string; reason: string }[];
}

/** A two-or-more-card combo, e.g. from Commander Spellbook. */
export interface ComboInfo {
  id: string;
  cards: string[];
  /** Commander Spellbook classification of how early/strong it is; free-form, used for messages. */
  bracketTag?: string;
  /** True if it wins the game or produces an infinite / game-ending result. */
  gameEnding: boolean;
  /**
   * True if it is realistically assembled in the early game (cheap pieces, e.g. total MV ≤ 6 or tag 'early').
   * Decided by packages/data when importing; the rules package only reads it.
   */
  early: boolean;
}
