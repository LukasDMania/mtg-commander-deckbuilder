import { DEFAULT_GAME_OPTIONS, playGame } from './game.js';
import { Rng, gameSeed } from './rng.js';
import { pairedDifference, proportion, summarize, type Proportion, type Summary } from './stats.js';
import type { GameOptions, GameResult, SimCard, SimDeck } from './types.js';

export interface RunOptions extends Partial<GameOptions> {
  /** Number of games (default 10,000). */
  games?: number;
  /** Run seed (default 1). Same seed + same deck → identical report. */
  seed?: number;
}

export interface TurnPoint {
  turn: number;
  mean: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface CardStat {
  name: string;
  kind: SimCard['kind'];
  copies: number;
  /** Share of games where a copy reached your hand (opening hand, draws, tutors, ramp-to-hand). */
  drawnRate: number;
  /** Of the games where it was drawn: share where it was cast/played by the last turn. */
  castWhenDrawn: number;
  /** Of the games where it was drawn: share where it sat in hand uncast (not counted for held interaction). */
  deadWhenDrawn: number;
  /** Average turn it was cast, when cast. */
  avgCastTurn: number | null;
}

export interface GoldfishReport {
  games: number;
  seed: number;
  options: Omit<GameOptions, 'keepPolicy'>;
  mulligans: Summary;
  /** Share of games where the kept hand had 7 cards (no paid mulligan). */
  keptSeven: Proportion;
  openingLands: Summary;
  landsByTurn: TurnPoint[];
  manaByTurn: TurnPoint[];
  damageByTurn: TurnPoint[];
  commander?: { castRate: Proportion; turnWhenCast: Summary };
  /** The deck wins unopposed (combo or all opponents dead) by the last simulated turn. */
  win: { rate: Proportion; turnWhenWon: Summary; byCombo: Proportion; byCombat: Proportion };
  firstKill: { rate: Proportion; turnWhenKilled: Summary };
  engine: { rate: Proportion; turnOnline: Summary };
  screw: Proportion;
  colorScrew: Proportion;
  flood: Proportion;
  landDropsMissed: Summary;
  /** Mana spent ÷ mana available over all turns (how much of the mana the hand could use). */
  manaEfficiency: Summary;
  heldInteractionEndOfGame: Summary;
  cards: CardStat[];
}

export function resolveOptions(opts: RunOptions): GameOptions {
  const o: GameOptions = { ...DEFAULT_GAME_OPTIONS };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined && k !== 'games' && k !== 'seed') (o as unknown as Record<string, unknown>)[k] = v;
  return o;
}

/**
 * Plays `games` goldfish games. Game i uses seed gameSeed(seed, i), so two decks run with the same seed see
 * the same shuffles of their library *positions* (common random numbers): swapping one card for another in the
 * same position changes only what that card does. Mulligan decisions can still make the games diverge.
 */
export function simulateGames(deck: SimDeck, opts: RunOptions = {}): { options: GameOptions; seed: number; results: GameResult[] } {
  const options = resolveOptions(opts);
  const games = opts.games ?? 10_000;
  const seed = opts.seed ?? 1;
  const results: GameResult[] = [];
  for (let i = 0; i < games; i++) results.push(playGame(deck, new Rng(gameSeed(seed, i)), options));
  return { options, seed, results };
}

export function runGoldfish(deck: SimDeck, opts: RunOptions = {}): GoldfishReport {
  const { options, seed, results } = simulateGames(deck, opts);
  return buildReport(deck, options, seed, results);
}

export function buildReport(deck: SimDeck, options: GameOptions, seed: number, results: GameResult[]): GoldfishReport {
  const n = results.length;
  const perTurn = (pick: (r: GameResult) => number[]): TurnPoint[] => {
    const out: TurnPoint[] = [];
    for (let t = 1; t <= options.maxTurns; t++) {
      const s = summarize(results.map((r) => pick(r)[t - 1] ?? 0), false);
      out.push({ turn: t, mean: s.mean, p10: s.p10, p50: s.p50, p90: s.p90 });
    }
    return out;
  };
  const turnsOf = (f: (r: GameResult) => number | null) => results.map(f).filter((t): t is number => t !== null);
  const { keepPolicy: _kp, ...optionSummary } = options;
  const won = turnsOf((r) => r.winTurn);
  const report: GoldfishReport = {
    games: n,
    seed,
    options: optionSummary,
    mulligans: summarize(results.map((r) => r.mulligans)),
    keptSeven: proportion(results.filter((r) => r.keptHandSize === 7).length, n),
    openingLands: summarize(results.map((r) => r.openingLands)),
    landsByTurn: perTurn((r) => r.landsInPlay),
    manaByTurn: perTurn((r) => r.manaAvailable),
    damageByTurn: perTurn((r) => r.damageDealt),
    win: {
      rate: proportion(won.length, n),
      turnWhenWon: summarize(won),
      byCombo: proportion(results.filter((r) => r.winTurn !== null && r.winTurn === r.comboTurn).length, n),
      byCombat: proportion(results.filter((r) => r.winTurn !== null && r.winTurn !== r.comboTurn).length, n),
    },
    firstKill: (() => {
      const k = turnsOf((r) => r.firstKillTurn ?? r.comboTurn);
      return { rate: proportion(k.length, n), turnWhenKilled: summarize(k) };
    })(),
    engine: (() => {
      const e = turnsOf((r) => r.engineTurn);
      return { rate: proportion(e.length, n), turnOnline: summarize(e) };
    })(),
    screw: proportion(results.filter((r) => r.screwed).length, n),
    colorScrew: proportion(results.filter((r) => r.colorScrewed).length, n),
    flood: proportion(results.filter((r) => r.flooded).length, n),
    landDropsMissed: summarize(results.map((r) => r.landDropsMissedByScrewTurn)),
    manaEfficiency: summarize(
      results.map((r) => {
        const avail = r.manaAvailable.reduce((s, v) => s + v, 0);
        return avail > 0 ? r.manaSpent.reduce((s, v) => s + v, 0) / avail : 0;
      }),
      false,
    ),
    heldInteractionEndOfGame: summarize(results.map((r) => r.heldInteraction.at(-1) ?? 0)),
    cards: cardStats(deck, results),
  };
  if (deck.commander) {
    const cast = turnsOf((r) => r.commanderTurn);
    report.commander = { castRate: proportion(cast.length, n), turnWhenCast: summarize(cast) };
  }
  return report;
}

function cardStats(deck: SimDeck, results: GameResult[]): CardStat[] {
  const byName = new Map<string, { kind: SimCard['kind']; positions: number[] }>();
  deck.library.forEach((c, i) => {
    const e = byName.get(c.name);
    if (e) e.positions.push(i);
    else byName.set(c.name, { kind: c.kind, positions: [i] });
  });
  const out: CardStat[] = [];
  for (const [name, { kind, positions }] of byName) {
    let drawnGames = 0;
    let castGames = 0;
    let deadGames = 0;
    let castTurnSum = 0;
    let castCount = 0;
    for (const r of results) {
      let drawn = false;
      let cast = false;
      for (const p of positions) {
        if ((r.trace.drawnTurn[p] as number) >= 0) drawn = true;
        const ct = r.trace.castTurn[p] as number;
        if (ct >= 0) {
          cast = true;
          castTurnSum += ct;
          castCount += 1;
        }
      }
      if (drawn) drawnGames += 1;
      if (drawn && cast) castGames += 1;
      if (drawn && !cast && kind !== 'interaction') deadGames += 1;
    }
    out.push({
      name,
      kind,
      copies: positions.length,
      drawnRate: drawnGames / results.length,
      castWhenDrawn: drawnGames ? castGames / drawnGames : 0,
      deadWhenDrawn: drawnGames ? deadGames / drawnGames : 0,
      avgCastTurn: castCount ? castTurnSum / castCount : null,
    });
  }
  return out.sort((a, b) => b.deadWhenDrawn - a.deadWhenDrawn);
}

export interface MetricDiff {
  metric: string;
  /** Mean of (B − A) per paired game. */
  meanDiff: number;
  ci95: [number, number];
  /** True when the 95% CI excludes zero. */
  significant: boolean;
}

/** Per-game numbers used for paired comparisons. Games without a win count as maxTurns + 2. */
export function pairedMetrics(maxTurns: number, withCommander: boolean): [string, (r: GameResult) => number][] {
  const never = maxTurns + 2;
  const m: [string, (r: GameResult) => number][] = [
    ['win_turn', (r) => r.winTurn ?? never],
    ['first_kill_turn', (r) => r.firstKillTurn ?? r.comboTurn ?? never],
    ['lands_turn_4', (r) => r.landsInPlay[3] ?? 0],
    ['mana_turn_4', (r) => r.manaAvailable[3] ?? 0],
    ['mana_turn_6', (r) => r.manaAvailable[5] ?? 0],
    ['damage_turn_8', (r) => r.damageDealt[Math.min(7, maxTurns - 1)] ?? 0],
    ['screw', (r) => (r.screwed ? 1 : 0)],
    ['color_screw', (r) => (r.colorScrewed ? 1 : 0)],
    ['flood', (r) => (r.flooded ? 1 : 0)],
    ['mana_spent_total', (r) => r.manaSpent.reduce((s, v) => s + v, 0)],
  ];
  if (withCommander) m.push(['commander_turn', (r) => r.commanderTurn ?? never]);
  return m;
}

/**
 * Paired A/B comparison with common random numbers (see simulateGames). Keep the two libraries aligned:
 * the swapped card should sit at the same index in both decks.
 */
export function compareGoldfish(a: SimDeck, b: SimDeck, opts: RunOptions = {}): { a: GoldfishReport; b: GoldfishReport; diffs: MetricDiff[] } {
  const ra = simulateGames(a, opts);
  const rb = simulateGames(b, opts);
  const diffs = pairedMetrics(ra.options.maxTurns, !!(a.commander && b.commander)).map(([metric, f]) => {
    const d = pairedDifference(ra.results.map(f), rb.results.map(f));
    return { metric, meanDiff: d.meanDiff, ci95: d.ci95, significant: d.ci95[0] > 0 || d.ci95[1] < 0 };
  });
  return {
    a: buildReport(a, ra.options, ra.seed, ra.results),
    b: buildReport(b, rb.options, rb.seed, rb.results),
    diffs,
  };
}
