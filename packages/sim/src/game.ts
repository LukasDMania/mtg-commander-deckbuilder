import type { Rng } from './rng.js';
import type { GameOptions, GameResult, KeepPolicy, SimCard, SimDeck } from './types.js';

export const isManaSource = (c: SimCard) => c.kind === 'rock' || c.kind === 'dork' || c.kind === 'ramp';

/**
 * Default keep policy (docs/SIMULATION.md A2):
 * - 3–5 lands: keep
 * - 2 lands + at least one cheap mana source (MV ≤ 2): keep
 * - at 5 cards or fewer, 2–4 lands is enough
 * The game loop forces a keep at `minHandSize`.
 */
export const defaultKeepPolicy: KeepPolicy = (hand, ctx) => {
  const lands = hand.filter((c) => c.kind === 'land').length;
  const cheapSources = hand.filter((c) => isManaSource(c) && c.manaValue <= 2).length;
  if (ctx.keepCount <= 5) return lands >= 2 && lands <= 4;
  if (lands >= 3 && lands <= 5) return true;
  return lands === 2 && cheapSources >= 1;
};

export const alwaysKeep: KeepPolicy = () => true;
export const neverKeep: KeepPolicy = () => false;

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  maxTurns: 10,
  drawOnFirstTurn: true,
  freeFirstMulligan: true,
  minHandSize: 4,
  keepPolicy: defaultKeepPolicy,
  commanderAsap: true,
  screwTurn: 4,
  screwMaxLands: 2,
  floodTurn: 7,
  floodShare: 0.55,
};

/**
 * Choose which cards go to the bottom after a London mulligan (keep `keepCount` of the 7).
 * Keeps about 3/7 lands (2–4), then mana sources cheapest first, then spells cheapest first.
 */
export function chooseBottom(hand: readonly SimCard[], keepCount: number): { keep: SimCard[]; bottom: SimCard[] } {
  // Work with positions, not objects: a library can hold the same card object many times (e.g. 30 Forests).
  const idx = hand.map((_, i) => i);
  const mv = (i: number) => (hand[i] as SimCard).manaValue;
  const lands = idx.filter((i) => (hand[i] as SimCard).kind === 'land');
  const sources = idx.filter((i) => isManaSource(hand[i] as SimCard)).sort((a, b) => mv(a) - mv(b));
  const spells = idx.filter((i) => (hand[i] as SimCard).kind === 'spell').sort((a, b) => mv(a) - mv(b));
  const desiredLands = Math.min(4, Math.max(2, Math.round((keepCount * 3) / 7)));
  const keptLands = Math.min(desiredLands, keepCount, lands.length);
  const keepIdx: number[] = lands.slice(0, keptLands);
  for (const i of [...sources, ...spells]) if (keepIdx.length < keepCount) keepIdx.push(i);
  for (const i of lands.slice(keptLands)) if (keepIdx.length < keepCount) keepIdx.push(i);
  const kept = new Set(keepIdx);
  return {
    keep: keepIdx.map((i) => hand[i] as SimCard),
    bottom: idx.filter((i) => !kept.has(i)).map((i) => hand[i] as SimCard),
  };
}

/** Plays one goldfish game. `deck.library` is not modified. */
export function playGame(deck: SimDeck, rng: Rng, opts: GameOptions): GameResult {
  // ---------- opening hand (London mulligan, optional free first mulligan) ----------
  let library: SimCard[] = [];
  let hand: SimCard[] = [];
  let mulligans = 0;
  for (;;) {
    library = deck.library.slice();
    if (!opts.noShuffle) rng.shuffle(library);
    hand = library.splice(0, 7);
    const toBottom = Math.max(0, mulligans - (opts.freeFirstMulligan ? 1 : 0));
    const keepCount = 7 - toBottom;
    const nextKeepCount = 7 - Math.max(0, mulligans + 1 - (opts.freeFirstMulligan ? 1 : 0));
    const forced = nextKeepCount < opts.minHandSize;
    if (forced || opts.keepPolicy(hand, { mulligans, keepCount })) {
      if (toBottom > 0) {
        const { keep, bottom } = chooseBottom(hand, keepCount);
        hand = keep;
        library.push(...bottom);
      }
      break;
    }
    mulligans += 1;
  }

  const result: GameResult = {
    mulligans,
    keptHandSize: hand.length,
    openingLands: hand.filter((c) => c.kind === 'land').length,
    landsInPlay: [],
    manaAvailable: [],
    manaSpent: [],
    landsSeen: [],
    cardsSeen: [],
    commanderTurn: null,
    landDropsMissedByScrewTurn: 0,
    screwed: false,
    flooded: false,
  };

  let landsSeen = result.openingLands;
  let cardsSeen = 7; // the 7 we looked at (bottomed cards were seen too)
  let lands = 0; // lands on the battlefield
  let tappedLandsNextTurn = 0; // lands that entered tapped this turn (they untap next turn)
  let rockMana = 0;
  let dorkMana = 0;
  let sickDorkMana = 0;
  let landDrops = 0;
  let commanderCast = !deck.commander;

  const draw = () => {
    const c = library.shift();
    if (!c) return;
    hand.push(c);
    cardsSeen += 1;
    if (c.kind === 'land') landsSeen += 1;
  };
  const fetchBasic = (): SimCard | undefined => {
    const i = library.findIndex((c) => c.kind === 'land' && c.basic);
    return i >= 0 ? library.splice(i, 1)[0] : undefined;
  };

  for (let turn = 1; turn <= opts.maxTurns; turn++) {
    // untap: lands that entered tapped last turn, dorks lose summoning sickness
    tappedLandsNextTurn = 0;
    dorkMana += sickDorkMana;
    sickDorkMana = 0;

    if (turn > 1 || opts.drawOnFirstTurn) draw();

    // land drop: prefer an untapped land
    let available = 0;
    let landPlayedThisTurn = false;
    const landIdx = pickLand(hand);
    if (landIdx >= 0) {
      landPlayedThisTurn = true;
      const land = hand.splice(landIdx, 1)[0] as SimCard;
      lands += 1;
      landDrops += 1;
      if (land.entersTapped) tappedLandsNextTurn += 1;
    }
    available = lands - tappedLandsNextTurn + rockMana + dorkMana;
    result.manaAvailable.push(available);
    let spent = 0;

    // mana sources, cheapest first
    for (;;) {
      const idx = cheapestCastable(hand, available, isManaSource);
      if (idx < 0) break;
      const c = hand.splice(idx, 1)[0] as SimCard;
      available -= c.manaValue;
      spent += c.manaValue;
      if (c.kind === 'rock') {
        rockMana += c.produces ?? 1;
        available += c.produces ?? 1;
      } else if (c.kind === 'dork') {
        sickDorkMana += c.produces ?? 1;
      } else {
        const n = c.rampLands ?? 1;
        for (let i = 0; i < n; i++) {
          const b = fetchBasic();
          if (!b) break;
          lands += 1;
          if (c.rampTapped ?? true) tappedLandsNextTurn += 1;
          else available += 1;
        }
        for (let i = 0; i < (c.rampToHand ?? 0); i++) {
          const b = fetchBasic();
          if (b) hand.push(b);
        }
      }
      // a land fetched to hand can still be played if we haven't made a land drop this turn
      if (!landPlayedThisTurn) {
        const li = pickLand(hand);
        if (li >= 0) {
          landPlayedThisTurn = true;
          const land = hand.splice(li, 1)[0] as SimCard;
          lands += 1;
          landDrops += 1;
          if (land.entersTapped) tappedLandsNextTurn += 1;
          else available += 1;
        }
      }
    }

    // commander
    if (!commanderCast && deck.commander && opts.commanderAsap && available >= deck.commander.manaValue) {
      available -= deck.commander.manaValue;
      spent += deck.commander.manaValue;
      commanderCast = true;
      result.commanderTurn = turn;
    }

    // other spells: biggest that fits, repeatedly
    for (;;) {
      let best = -1;
      for (let i = 0; i < hand.length; i++) {
        const c = hand[i] as SimCard;
        if (c.kind === 'spell' && c.manaValue <= available && (best < 0 || c.manaValue > (hand[best] as SimCard).manaValue)) best = i;
      }
      if (best < 0) break;
      const c = hand.splice(best, 1)[0] as SimCard;
      available -= c.manaValue;
      spent += c.manaValue;
    }

    result.landsInPlay.push(lands);
    result.manaSpent.push(spent);
    result.landsSeen.push(landsSeen);
    result.cardsSeen.push(cardsSeen);
    if (turn === opts.screwTurn) {
      result.landDropsMissedByScrewTurn = turn - landDrops;
      result.screwed = lands <= opts.screwMaxLands;
    }
    if (turn === opts.floodTurn) result.flooded = landsSeen / cardsSeen >= opts.floodShare;
  }
  return result;
}

function pickLand(hand: SimCard[]): number {
  let tapped = -1;
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i] as SimCard;
    if (c.kind !== 'land') continue;
    if (!c.entersTapped) return i;
    if (tapped < 0) tapped = i;
  }
  return tapped;
}

function cheapestCastable(hand: SimCard[], available: number, pred: (c: SimCard) => boolean): number {
  let best = -1;
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i] as SimCard;
    if (pred(c) && c.manaValue <= available && (best < 0 || c.manaValue < (hand[best] as SimCard).manaValue)) best = i;
  }
  return best;
}
