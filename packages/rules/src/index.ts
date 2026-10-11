// Phase 1: deck model, validator, bracket rules. See docs/PLAN.md §5 and §7.
export type Bracket = 1 | 2 | 3 | 4 | 5;

/** Minimum turns before anyone should win or lose, per official Commander Brackets guidance (Oct 2025). */
export const MIN_TURNS_BY_BRACKET: Record<Bracket, number | null> = { 1: 9, 2: 8, 3: 6, 4: 4, 5: null };

/** Max Game Changers per bracket (null = unlimited). */
export const MAX_GAME_CHANGERS: Record<Bracket, number | null> = { 1: 0, 2: 0, 3: 3, 4: null, 5: null };
