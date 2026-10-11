import type { Bracket } from './types.js';

/**
 * Bracket policy table, from the official Commander Brackets beta (introduced Feb 2025, updated Oct 21 2025 and
 * Feb 9 2026). VERIFY against the current WotC page when it changes; this table is the single place to edit.
 *
 * - maxGameChangers: null = unlimited
 * - massLandDenial:  allowed?
 * - extraTurns: 'none' = no extra-turn cards; 'few' = low counts, never chained (we warn above maxExtraTurnCards);
 *               'any' = no restriction
 * - twoCardCombos: 'none' = no game-ending two-card combos; 'late-only' = only ones not realistically assembled
 *               early; 'any' = no restriction
 * - minTurns: you should expect to play at least this many turns before anyone wins or loses (Oct 2025 update)
 * The separate tutor restriction was removed in the Oct 2025 update.
 */
export interface BracketPolicy {
  name: string;
  maxGameChangers: number | null;
  massLandDenial: boolean;
  extraTurns: 'none' | 'few' | 'any';
  maxExtraTurnCards: number | null;
  twoCardCombos: 'none' | 'late-only' | 'any';
  minTurns: number | null;
}

export const BRACKET_POLICY: Record<Bracket, BracketPolicy> = {
  1: { name: 'Exhibition', maxGameChangers: 0, massLandDenial: false, extraTurns: 'none', maxExtraTurnCards: 0, twoCardCombos: 'none', minTurns: 9 },
  2: { name: 'Core', maxGameChangers: 0, massLandDenial: false, extraTurns: 'few', maxExtraTurnCards: 2, twoCardCombos: 'none', minTurns: 8 },
  3: { name: 'Upgraded', maxGameChangers: 3, massLandDenial: false, extraTurns: 'few', maxExtraTurnCards: 2, twoCardCombos: 'late-only', minTurns: 6 },
  4: { name: 'Optimized', maxGameChangers: null, massLandDenial: true, extraTurns: 'any', maxExtraTurnCards: null, twoCardCombos: 'any', minTurns: 4 },
  5: { name: 'cEDH', maxGameChangers: null, massLandDenial: true, extraTurns: 'any', maxExtraTurnCards: null, twoCardCombos: 'any', minTurns: null },
};

/** Minimum turns before anyone should win or lose, per bracket. */
export const MIN_TURNS_BY_BRACKET: Record<Bracket, number | null> = {
  1: BRACKET_POLICY[1].minTurns,
  2: BRACKET_POLICY[2].minTurns,
  3: BRACKET_POLICY[3].minTurns,
  4: BRACKET_POLICY[4].minTurns,
  5: BRACKET_POLICY[5].minTurns,
};

/** Max Game Changers per bracket (null = unlimited). */
export const MAX_GAME_CHANGERS: Record<Bracket, number | null> = {
  1: BRACKET_POLICY[1].maxGameChangers,
  2: BRACKET_POLICY[2].maxGameChangers,
  3: BRACKET_POLICY[3].maxGameChangers,
  4: BRACKET_POLICY[4].maxGameChangers,
  5: BRACKET_POLICY[5].maxGameChangers,
};

/** Role tags (card_role.role) the bracket rules read. */
export const ROLE_MASS_LAND_DENIAL = 'mass-land-denial';
export const ROLE_EXTRA_TURN = 'extra-turn';
