import { colorsNeeded, costOf, findPayment, pipList, spend, totalCost, type Cost } from './mana.js';
import type { Rng } from './rng.js';
import type { CommanderInfo, GameOptions, GameResult, KeepPolicy, SimCard, SimDeck } from './types.js';

export const isManaSource = (c: SimCard) => c.kind === 'rock' || c.kind === 'dork' || c.kind === 'ramp';

const DEFAULT_PERMANENT: Record<SimCard['kind'], boolean> = {
  land: true,
  rock: true,
  dork: true,
  ramp: false,
  draw: false,
  engine: true,
  tutor: false,
  reducer: true,
  creature: true,
  interaction: false,
  spell: true,
  blank: false,
};
export const isPermanent = (c: SimCard) => c.permanent ?? DEFAULT_PERMANENT[c.kind];

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
  groundUnblockedShare: 0.5,
  opponents: 3,
  startingLife: 40,
};

/** Positions (indexes into `hand`) to keep after a London mulligan; the rest go to the bottom. */
export function chooseKeepIndexes(hand: readonly SimCard[], keepCount: number): number[] {
  // Work with positions, not objects: a library can hold the same card object many times (e.g. 30 Forests).
  const idx = hand.map((_, i) => i);
  const card = (i: number) => hand[i] as SimCard;
  const lands = idx.filter((i) => card(i).kind === 'land');
  const sources = idx.filter((i) => isManaSource(card(i))).sort((a, b) => card(a).manaValue - card(b).manaValue);
  const others = idx
    .filter((i) => card(i).kind !== 'land' && !isManaSource(card(i)))
    .sort((a, b) => (card(a).kind === 'blank' ? 99 : card(a).manaValue) - (card(b).kind === 'blank' ? 99 : card(b).manaValue));
  const desiredLands = Math.min(4, Math.max(2, Math.round((keepCount * 3) / 7)));
  const keptLands = Math.min(desiredLands, keepCount, lands.length);
  const keep: number[] = lands.slice(0, keptLands);
  for (const i of [...sources, ...others]) if (keep.length < keepCount) keep.push(i);
  for (const i of lands.slice(keptLands)) if (keep.length < keepCount) keep.push(i);
  return keep;
}

/** Choose which cards go to the bottom after a London mulligan (keep `keepCount` of the 7). */
export function chooseBottom(hand: readonly SimCard[], keepCount: number): { keep: SimCard[]; bottom: SimCard[] } {
  const keepIdx = chooseKeepIndexes(hand, keepCount);
  const kept = new Set(keepIdx);
  return {
    keep: keepIdx.map((i) => hand[i] as SimCard),
    bottom: hand.map((_, i) => i).filter((i) => !kept.has(i)).map((i) => hand[i] as SimCard),
  };
}

interface Inst {
  c: SimCard;
  id: number; // library position (stable across games and A/B variants)
}

interface Creature {
  power: number;
  evasion: number;
  readyTurn: number; // first turn it can attack
  isCommander: boolean;
}

/** Plays one goldfish game. `deck.library` is not modified. */
export function playGame(deck: SimDeck, rng: Rng, opts: GameOptions): GameResult {
  const libSize = deck.library.length;
  const cmd: CommanderInfo | undefined = deck.commander;
  const combos = deck.combos ?? [];

  // ---------- opening hand (London mulligan, optional free first mulligan) ----------
  const all: Inst[] = deck.library.map((c, id) => ({ c, id }));
  let library: Inst[] = [];
  let hand: Inst[] = [];
  let mulligans = 0;
  let openingHand: number[] = [];
  for (;;) {
    library = all.slice();
    if (!opts.noShuffle) rng.shuffle(library);
    hand = library.splice(0, 7);
    const toBottom = Math.max(0, mulligans - (opts.freeFirstMulligan ? 1 : 0));
    const keepCount = 7 - toBottom;
    const nextKeepCount = 7 - Math.max(0, mulligans + 1 - (opts.freeFirstMulligan ? 1 : 0));
    const forced = nextKeepCount < opts.minHandSize;
    const handCards = hand.map((h) => h.c);
    if (forced || opts.keepPolicy(handCards, { mulligans, keepCount, commanderColors: cmd ? colorsNeeded(cmd) : '' })) {
      openingHand = hand.map((h) => h.id);
      if (toBottom > 0) {
        const keepIdx = new Set(chooseKeepIndexes(handCards, keepCount));
        const kept = hand.filter((_, i) => keepIdx.has(i));
        const bottom = hand.filter((_, i) => !keepIdx.has(i));
        hand = kept;
        library.push(...bottom);
      }
      break;
    }
    mulligans += 1;
  }

  const trace = { drawnTurn: new Int8Array(libSize).fill(-1), castTurn: new Int8Array(libSize).fill(-1) };
  for (const h of hand) trace.drawnTurn[h.id] = 0;

  const result: GameResult = {
    mulligans,
    keptHandSize: hand.length,
    openingLands: hand.filter((h) => h.c.kind === 'land').length,
    landsInPlay: [],
    manaAvailable: [],
    manaSpent: [],
    landsSeen: [],
    cardsSeen: [],
    damageDealt: [],
    commanderTurn: null,
    engineTurn: null,
    comboTurn: null,
    comboName: null,
    firstKillTurn: null,
    tableKillTurn: null,
    winTurn: null,
    landDropsMissedByScrewTurn: 0,
    screwed: false,
    colorScrewed: false,
    flooded: false,
    heldInteraction: [],
    openingHand,
    trace,
  };

  // ---------- board state ----------
  let landsSeen = result.openingLands;
  let cardsSeen = 7; // the 7 looked at (bottomed cards were seen too)
  const lands: { colors: string; tappedUntil: number }[] = []; // tappedUntil: usable from this turn on
  const rocks: string[] = []; // one entry per mana unit
  const dorks: { colors: string; readyTurn: number }[] = [];
  let engineDraws = 0;
  let pendingEngineDraws = 0; // engines cast this turn draw from next turn
  const reducers: { amount: number; tag?: string }[] = [];
  const creatures: Creature[] = [];
  const onBattlefield = new Map<string, number>(); // permanent name → count (for combos)
  let commanderOnBattlefield = false;
  let landDrops = 0;
  let damageTotal = 0;
  const opponents = Array.from({ length: opts.opponents }, () => ({ life: opts.startingLife, cmdDamage: 0, alive: true }));
  let turn = 0;

  const addToBattlefield = (name: string) => onBattlefield.set(name, (onBattlefield.get(name) ?? 0) + 1);
  const draw = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const inst = library.shift();
      if (!inst) return;
      hand.push(inst);
      cardsSeen += 1;
      if (inst.c.kind === 'land') landsSeen += 1;
      if (trace.drawnTurn[inst.id] === -1) trace.drawnTurn[inst.id] = turn;
    }
  };
  const reductionFor = (tags: string[] | undefined) =>
    reducers.reduce((s, r) => s + (r.tag === undefined || (tags ?? []).includes(r.tag) ? r.amount : 0), 0);
  const cardCost = (c: SimCard): Cost => costOf(c.manaValue, c.pips, reductionFor(c.tags));
  const commanderCost = (): Cost => costOf(cmd?.manaValue ?? 0, cmd?.pips, reductionFor(cmd?.tags));

  /** Colors the cards in hand (and an uncast commander) need that the battlefield can't make yet. */
  const missingColors = (): Map<string, number> => {
    const have = new Set<string>([...lands.map((l) => l.colors), ...rocks, ...dorks.map((d) => d.colors)].join('').split(''));
    const need = new Map<string, number>();
    const add = (pips: string[]) => {
      for (const p of pips) if (!have.has(p)) need.set(p, (need.get(p) ?? 0) + 1);
    };
    for (const h of hand) if (h.c.kind !== 'land') add(pipList(h.c.pips));
    if (cmd && !commanderOnBattlefield) add(pipList(cmd.pips));
    return need;
  };
  const landScore = (c: SimCard, need: Map<string, number>) => {
    const colors = c.colors ?? 'C';
    let s = 0;
    for (const [color, n] of need) if (colors.includes(color)) s += n * 10;
    return s + (c.entersTapped ? 0 : 5) + colors.length * 0.1;
  };
  const playLand = (): boolean => {
    let best = -1;
    let bestScore = -Infinity;
    const need = missingColors();
    hand.forEach((h, i) => {
      if (h.c.kind !== 'land') return;
      const s = landScore(h.c, need);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    if (best < 0) return false;
    const inst = hand.splice(best, 1)[0] as Inst;
    lands.push({ colors: inst.c.colors ?? 'C', tappedUntil: inst.c.entersTapped ? turn + 1 : turn });
    trace.castTurn[inst.id] = turn;
    landDrops += 1;
    return true;
  };
  const fetchBasic = (): Inst | undefined => {
    const need = missingColors();
    let best = -1;
    let bestScore = -Infinity;
    library.forEach((l, i) => {
      if (l.c.kind !== 'land' || !l.c.basic) return;
      const s = landScore(l.c, need);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    return best >= 0 ? (library.splice(best, 1)[0] as Inst) : undefined;
  };
  const comboPieceNames = new Set(combos.flatMap((c) => c.pieces));
  const isHeldComboPiece = (c: SimCard) => comboPieceNames.has(c.name) && !isPermanent(c);

  /** Library card a tutor should find, or -1. */
  const tutorTarget = (): number => {
    // 1. the missing piece of the combo closest to completion
    let bestCombo: { missing: string[] } | undefined;
    for (const combo of combos) {
      if (result.comboTurn !== null) break;
      const missing = combo.pieces.filter(
        (p) => !onBattlefield.has(p) && !(cmd && p === cmd.name) && !hand.some((h) => h.c.name === p),
      );
      if (missing.length === 0 || !missing.every((p) => library.some((l) => l.c.name === p))) continue;
      if (!bestCombo || missing.length < bestCombo.missing.length) bestCombo = { missing };
    }
    if (bestCombo) return library.findIndex((l) => l.c.name === bestCombo!.missing[0]);
    // 2. a mana source while mana is short, 3. an engine, 4. the biggest creature
    const sources = lands.length + rocks.length + dorks.length;
    if (sources < 6) {
      const i = cheapestIndex(library, (c) => c.kind === 'rock' || c.kind === 'dork');
      if (i >= 0) return i;
    }
    const e = library.findIndex((l) => l.c.kind === 'engine' || l.c.kind === 'reducer');
    if (e >= 0) return e;
    let bestPower = -1;
    let idx = -1;
    library.forEach((l, i) => {
      if (l.c.kind === 'creature' && (l.c.power ?? 0) > bestPower) {
        bestPower = l.c.power ?? 0;
        idx = i;
      }
    });
    return idx;
  };

  for (turn = 1; turn <= opts.maxTurns; turn++) {
    // ---- untap / upkeep: engines from earlier turns draw ----
    engineDraws += pendingEngineDraws;
    pendingEngineDraws = 0;

    // ---- draw ----
    if (turn > 1 || opts.drawOnFirstTurn) draw(1);
    if (engineDraws > 0) draw(engineDraws);

    // ---- land drop ----
    let landPlayed = playLand();

    // ---- mana pool for this turn ----
    const pool: string[] = [
      ...lands.filter((l) => l.tappedUntil <= turn).map((l) => l.colors),
      ...rocks,
      ...dorks.filter((d) => d.readyTurn <= turn).map((d) => d.colors),
    ];
    const startPool = pool.slice();
    result.manaAvailable.push(pool.length);
    let spent = 0;

    const pay = (cost: Cost): boolean => {
      const idx = findPayment(pool, cost);
      if (!idx) return false;
      spend(pool, idx);
      spent += totalCost(cost);
      return true;
    };

    const tryCombos = () => {
      if (result.comboTurn !== null) return;
      for (const combo of combos) {
        const needCommander = cmd !== undefined && combo.pieces.includes(cmd.name) && !commanderOnBattlefield;
        const fromHand: number[] = [];
        let ok = true;
        for (const p of combo.pieces) {
          if (onBattlefield.has(p) || (cmd && p === cmd.name)) continue;
          const i = hand.findIndex((h, j) => h.c.name === p && !fromHand.includes(j));
          if (i < 0) {
            ok = false;
            break;
          }
          fromHand.push(i);
        }
        if (!ok) continue;
        // pay for every missing piece (and the commander if it's a piece) on a scratch pool
        const scratch = pool.slice();
        const costs: Cost[] = fromHand.map((i) => cardCost((hand[i] as Inst).c));
        if (needCommander) costs.push(commanderCost());
        let payable = true;
        for (const cost of costs) {
          const idx = findPayment(scratch, cost);
          if (!idx) {
            payable = false;
            break;
          }
          spend(scratch, idx);
        }
        if (!payable) continue;
        for (const cost of costs) pay(cost);
        for (const i of [...fromHand].sort((a, b) => b - a)) {
          const inst = hand.splice(i, 1)[0] as Inst;
          trace.castTurn[inst.id] = turn;
          if (isPermanent(inst.c)) addToBattlefield(inst.c.name);
        }
        if (needCommander) castCommanderEffects();
        result.comboTurn = turn;
        result.comboName = combo.name;
        return;
      }
    };

    const castCommanderEffects = () => {
      commanderOnBattlefield = true;
      if (cmd) addToBattlefield(cmd.name);
      if (result.commanderTurn === null) result.commanderTurn = turn;
      if (cmd?.power) {
        creatures.push({
          power: cmd.power,
          evasion: cmd.evasion ?? opts.groundUnblockedShare,
          readyTurn: cmd.haste ? turn : turn + 1,
          isCommander: true,
        });
      }
    };

    const resolve = (inst: Inst) => {
      const c = inst.c;
      trace.castTurn[inst.id] = turn;
      if (isPermanent(c)) addToBattlefield(c.name);
      switch (c.kind) {
        case 'rock':
          for (let i = 0; i < (c.produces ?? 1); i++) {
            rocks.push(c.colors ?? 'C');
            pool.push(c.colors ?? 'C');
          }
          break;
        case 'dork':
          for (let i = 0; i < (c.produces ?? 1); i++) dorks.push({ colors: c.colors ?? 'C', readyTurn: turn + 1 });
          break;
        case 'ramp': {
          for (let i = 0; i < (c.rampLands ?? 1); i++) {
            const b = fetchBasic();
            if (!b) break;
            trace.castTurn[b.id] = turn;
            const tapped = c.rampTapped ?? true;
            lands.push({ colors: b.c.colors ?? 'C', tappedUntil: tapped ? turn + 1 : turn });
            if (!tapped) pool.push(b.c.colors ?? 'C');
          }
          for (let i = 0; i < (c.rampToHand ?? 0); i++) {
            const b = fetchBasic();
            if (b) {
              hand.push(b);
              if (trace.drawnTurn[b.id] === -1) trace.drawnTurn[b.id] = turn;
            }
          }
          break;
        }
        case 'draw':
          draw(c.draws ?? 1);
          break;
        case 'engine':
          pendingEngineDraws += c.draws ?? 1;
          if (result.engineTurn === null) result.engineTurn = turn;
          break;
        case 'reducer':
          reducers.push(c.reducesTag !== undefined ? { amount: c.reduces ?? 1, tag: c.reducesTag } : { amount: c.reduces ?? 1 });
          if (result.engineTurn === null) result.engineTurn = turn;
          break;
        case 'tutor': {
          const t = tutorTarget();
          if (t >= 0) {
            const found = library.splice(t, 1)[0] as Inst;
            hand.push(found);
            if (trace.drawnTurn[found.id] === -1) trace.drawnTurn[found.id] = turn;
          }
          break;
        }
        case 'creature':
          creatures.push({
            power: c.power ?? 0,
            evasion: c.evasion ?? opts.groundUnblockedShare,
            readyTurn: c.haste ? turn : turn + 1,
            isCommander: false,
          });
          break;
        default:
          break;
      }
      // a land drawn or fetched to hand can still be played this turn
      if (!landPlayed && hand.some((h) => h.c.kind === 'land')) {
        landPlayed = playLand();
        const l = lands[lands.length - 1];
        if (landPlayed && l && l.tappedUntil <= turn) pool.push(l.colors);
      }
    };

    // ---- main phase: cast by priority until nothing fits ----
    tryCombos();
    for (let guard = 0; guard < 200; guard++) {
      const castable = (c: SimCard) => findPayment(pool, cardCost(c)) !== null;
      // 1. mana sources, cheapest first
      let pick = cheapestIndex(hand, (c) => isManaSource(c) && castable(c));
      // 2. commander
      if (pick < 0 && cmd && !commanderOnBattlefield && opts.commanderAsap && findPayment(pool, commanderCost())) {
        pay(commanderCost());
        castCommanderEffects();
        tryCombos();
        continue;
      }
      // 3. tutors (if they'd find something), 4. permanent combo pieces, 5. engines/reducers, 6. draw
      if (pick < 0) pick = cheapestIndex(hand, (c) => c.kind === 'tutor' && castable(c) && tutorTarget() >= 0);
      if (pick < 0) pick = cheapestIndex(hand, (c) => comboPieceNames.has(c.name) && isPermanent(c) && castable(c));
      if (pick < 0) pick = cheapestIndex(hand, (c) => (c.kind === 'engine' || c.kind === 'reducer') && castable(c));
      if (pick < 0) pick = cheapestIndex(hand, (c) => c.kind === 'draw' && castable(c));
      // 7. creatures (most power first), 8. other spells (biggest first)
      if (pick < 0) pick = maxIndex(hand, (c) => (c.kind === 'creature' && castable(c) ? 1000 + (c.power ?? 0) * 10 + c.manaValue : -1));
      if (pick < 0) pick = maxIndex(hand, (c) => (c.kind === 'spell' && !isHeldComboPiece(c) && castable(c) ? c.manaValue : -1));
      if (pick < 0) break;
      const inst = hand.splice(pick, 1)[0] as Inst;
      pay(cardCost(inst.c));
      resolve(inst);
      tryCombos();
    }

    // ---- combat ----
    let dmg = 0;
    let cmdDmg = 0;
    for (const cr of creatures) {
      if (cr.readyTurn > turn) continue;
      const d = cr.power * cr.evasion;
      if (cr.isCommander) cmdDmg += d;
      else dmg += d;
    }
    if (dmg + cmdDmg > 0) {
      damageTotal += dmg + cmdDmg;
      let rest = dmg;
      let restCmd = cmdDmg;
      for (const o of opponents) {
        if (!o.alive) continue;
        if (restCmd > 0) {
          const needCmd = Math.min(restCmd, 21 - o.cmdDamage, o.life);
          o.cmdDamage += needCmd;
          o.life -= needCmd;
          restCmd -= needCmd;
        }
        if (o.life > 0 && o.cmdDamage < 21 && rest > 0) {
          const take = Math.min(rest, o.life);
          o.life -= take;
          rest -= take;
        }
        if (o.life <= 0 || o.cmdDamage >= 21) {
          o.alive = false;
          if (result.firstKillTurn === null) result.firstKillTurn = turn;
        }
        if (rest <= 0 && restCmd <= 0) break;
      }
      if (result.tableKillTurn === null && opponents.every((o) => !o.alive)) result.tableKillTurn = turn;
    }

    // ---- bookkeeping ----
    result.landsInPlay.push(lands.length);
    result.manaSpent.push(spent);
    result.landsSeen.push(landsSeen);
    result.cardsSeen.push(cardsSeen);
    result.damageDealt.push(damageTotal);
    result.heldInteraction.push(hand.filter((h) => h.c.kind === 'interaction').length);
    if (turn === opts.screwTurn) {
      result.landDropsMissedByScrewTurn = turn - landDrops;
      result.screwed = lands.length <= opts.screwMaxLands;
      result.colorScrewed = hand.some((h) => {
        if (h.c.kind === 'land' || h.c.kind === 'interaction' || h.c.kind === 'blank' || isHeldComboPiece(h.c)) return false;
        const cost = cardCost(h.c);
        return totalCost(cost) <= startPool.length && findPayment(startPool, cost) === null;
      });
    }
    if (turn === opts.floodTurn) result.flooded = landsSeen / cardsSeen >= opts.floodShare;
  }

  const wins = [result.comboTurn, result.tableKillTurn].filter((t): t is number => t !== null);
  result.winTurn = wins.length ? Math.min(...wins) : null;
  return result;
}

function cheapestIndex(cards: Inst[], pred: (c: SimCard) => boolean): number {
  let best = -1;
  for (let i = 0; i < cards.length; i++) {
    const c = (cards[i] as Inst).c;
    if (pred(c) && (best < 0 || c.manaValue < (cards[best] as Inst).c.manaValue)) best = i;
  }
  return best;
}

function maxIndex(cards: Inst[], score: (c: SimCard) => number): number {
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < cards.length; i++) {
    const s = score((cards[i] as Inst).c);
    if (s >= 0 && s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}
