/**
 * Goldfish v0 card model: only what matters for lands and mana. Everything that isn't a land or a mana source
 * is a 'spell' with a mana value. Phase 2 replaces this with full sim profiles (docs/SIMULATION.md A1).
 */
export type SimCardKind = 'land' | 'rock' | 'dork' | 'ramp' | 'spell';

export interface SimCard {
  name: string;
  kind: SimCardKind;
  manaValue: number;
  /** land: enters the battlefield tapped. */
  entersTapped?: boolean;
  /** land: a basic land (ramp spells can fetch it from the library). */
  basic?: boolean;
  /** rock/dork: mana produced per turn (default 1). Rocks produce the turn they're cast; dorks from next turn. */
  produces?: number;
  /** ramp: basic lands put onto the battlefield from the library (default 1). */
  rampLands?: number;
  /** ramp: those lands enter tapped (default true). */
  rampTapped?: boolean;
  /** ramp: basic lands put into hand from the library (e.g. Cultivate: 1). */
  rampToHand?: number;
}

export interface SimDeck {
  /** Commander (cast from the command zone; not in the library). Omit to skip commander metrics. */
  commander?: { name: string; manaValue: number };
  /** The library: 99 cards (98 with partners). Order matters only for paired A/B (see runner). */
  library: SimCard[];
}

export interface KeepContext {
  /** Mulligans taken so far (including a free one). */
  mulligans: number;
  /** Cards that will remain after bottoming if this hand is kept. */
  keepCount: number;
}

/** Return true to keep this 7-card hand. */
export type KeepPolicy = (hand: readonly SimCard[], ctx: KeepContext) => boolean;

export interface GameOptions {
  maxTurns: number;
  /** Multiplayer: nobody skips the first draw (CR 103.8). Default true. */
  drawOnFirstTurn: boolean;
  /** First mulligan is free in multiplayer Commander (CR 103.5c). Default true. */
  freeFirstMulligan: boolean;
  /** Smallest hand you'll go down to; that hand is kept no matter what. Default 4. */
  minHandSize: number;
  keepPolicy: KeepPolicy;
  /** Cast the commander as soon as possible (after mana sources). Default true. */
  commanderAsap: boolean;
  /** Turn on which to judge mana screw (lands in play ≤ screwMaxLands). Default turn 4, ≤ 2 lands. */
  screwTurn: number;
  screwMaxLands: number;
  /** Turn on which to judge flood: share of lands among cards seen ≥ floodShare. Default turn 7, 0.55. */
  floodTurn: number;
  floodShare: number;
  /** For unit tests: don't shuffle; draw the library in the given order. */
  noShuffle?: boolean;
}

export interface GameResult {
  mulligans: number;
  keptHandSize: number;
  openingLands: number;
  /** Index t-1 → value at the end of turn t's main phase. */
  landsInPlay: number[];
  /** Mana available on turn t after the land drop and before casting (lands + rocks + dorks ready). */
  manaAvailable: number[];
  manaSpent: number[];
  landsSeen: number[];
  cardsSeen: number[];
  /** Turn the commander was first cast, or null if not within maxTurns. */
  commanderTurn: number | null;
  landDropsMissedByScrewTurn: number;
  screwed: boolean;
  flooded: boolean;
}
