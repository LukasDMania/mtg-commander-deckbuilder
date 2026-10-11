/**
 * Goldfish card model ("sim profile", docs/SIMULATION.md A1). Explicit and small on purpose: each card says only
 * what the simulator needs. Built from real card data by packages/data (Phase 1/2); hand-made in tests.
 */
export type SimCardKind =
  | 'land'
  | 'rock' //        mana artifact: produces mana the turn it's cast
  | 'dork' //        mana creature: produces mana from next turn (summoning sick)
  | 'ramp' //        spell that fetches basic lands to battlefield and/or hand
  | 'draw' //        one-shot card draw (Harmonize)
  | 'engine' //      permanent that draws extra cards each turn (Phyrexian Arena)
  | 'tutor' //       finds the best missing card and puts it in hand
  | 'reducer' //     permanent that reduces generic costs (Dragonspeaker Shaman)
  | 'creature' //    attacks for damage (combat clock)
  | 'interaction' // removal / counterspells / protection: held, never cast in a goldfish
  | 'spell' //       anything else; cast with spare mana
  | 'blank'; //      does nothing and is never cast (used by card-impact analysis)

/** 'W' | 'U' | 'B' | 'R' | 'G' and 'C' for colorless mana. */
export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type Pips = Partial<Record<Exclude<ManaColor, 'C'>, number>> & { C?: number };

export interface SimCard {
  name: string;
  kind: SimCardKind;
  /** Total mana value (generic part = manaValue − sum of pips). */
  manaValue: number;
  /** Colored mana symbols in the cost, e.g. { G: 1 } for Cultivate. `C` = specifically colorless. */
  pips?: Pips;
  /** Tags used by reducers and tutors (creature types, "dragon", …). */
  tags?: string[];
  /** Stays on the battlefield after being cast. Defaults: true except draw, tutor, interaction, ramp. */
  permanent?: boolean;

  // ---- lands ----
  entersTapped?: boolean;
  basic?: boolean;
  /**
   * Colors this land / rock / dork can produce, as a string: 'G', 'WU', 'C', 'WUBRG' (any color).
   * Default: 'C'. With no pips anywhere in the deck, colors don't matter.
   */
  colors?: string;

  // ---- mana sources ----
  /** rock/dork: mana per turn (default 1). */
  produces?: number;
  /** ramp: basics to battlefield (default 1), tapped (default true), and basics to hand (default 0). */
  rampLands?: number;
  rampTapped?: boolean;
  rampToHand?: number;

  // ---- card flow ----
  /** draw: cards drawn on cast. engine: extra cards drawn each turn after it's on the battlefield. */
  draws?: number;

  // ---- reducers ----
  /** Generic mana reduced for matching spells (all spells when reducesTag is unset). */
  reduces?: number;
  reducesTag?: string;

  // ---- creatures / combat ----
  power?: number;
  /** Share of this creature's damage that gets through (0–1). Default: options.groundUnblockedShare. */
  evasion?: number;
  haste?: boolean;
}

export interface CommanderInfo {
  name: string;
  manaValue: number;
  pips?: Pips;
  tags?: string[];
  power?: number;
  evasion?: number;
  haste?: boolean;
}

export interface Combo {
  name: string;
  /** Card names; the commander's name counts as a piece once it's on the battlefield. */
  pieces: string[];
}

export interface SimDeck {
  /** Commander (cast from the command zone; not in the library). Omit to skip commander metrics. */
  commander?: CommanderInfo;
  /** The library: 99 cards (98 with partners). Order matters only for paired A/B (see runner). */
  library: SimCard[];
  /** Win-the-game combos; the game is won the turn all pieces are assembled (see game loop). */
  combos?: Combo[];
}

export interface KeepContext {
  /** Mulligans taken so far (including a free one). */
  mulligans: number;
  /** Cards that will remain after bottoming if this hand is kept. */
  keepCount: number;
  /** Colors the commander's cost needs (helps policies judge color coverage). */
  commanderColors: string;
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
  /** Share of a creature's power that connects when it has no `evasion` value. Default 0.5. */
  groundUnblockedShare: number;
  /** Opponents and their life total (Commander: 3 opponents at 40). */
  opponents: number;
  startingLife: number;
  /** For unit tests: don't shuffle; draw the library in the given order. */
  noShuffle?: boolean;
}

/** Per library position: first turn the card was in hand (0 = opening hand) and turn it was cast; -1 = never. */
export interface CardTrace {
  drawnTurn: Int8Array;
  castTurn: Int8Array;
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
  /** Cumulative damage dealt to opponents by the end of turn t. */
  damageDealt: number[];
  /** Turn the commander was first cast, or null if not within maxTurns. */
  commanderTurn: number | null;
  /** First turn an engine (draw engine or reducer) was on the battlefield. */
  engineTurn: number | null;
  /** Turn a combo was assembled (game won), or null. */
  comboTurn: number | null;
  comboName: string | null;
  /** Turn the first opponent was eliminated by combat / commander damage. */
  firstKillTurn: number | null;
  /** Turn all opponents were eliminated by combat / commander damage. */
  tableKillTurn: number | null;
  /** min(comboTurn, tableKillTurn): the turn this deck wins unopposed, or null within maxTurns. */
  winTurn: number | null;
  landDropsMissedByScrewTurn: number;
  screwed: boolean;
  /** On the screw turn, a card was affordable by amount but not castable because of colors. */
  colorScrewed: boolean;
  flooded: boolean;
  /** Interaction cards held in hand at the end of each turn. */
  heldInteraction: number[];
  /** The kept 7-card opening hand before bottoming (for the mulligan guide). Library indexes. */
  openingHand: number[];
  trace: CardTrace;
}
