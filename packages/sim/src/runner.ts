import { DEFAULT_GAME_OPTIONS, playGame } from './game.js';
import { Rng, gameSeed } from './rng.js';
import { pairedDifference, proportion, summarize, type Proportion, type Summary } from './stats.js';
import type { GameOptions, GameResult, SimDeck } from './types.js';

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
  commander?: { castRate: Proportion; turnWhenCast: Summary };
  screw: Proportion;
  flood: Proportion;
  landDropsMissed: Summary;
  /** Mana spent ÷ mana available over all turns (how much of the mana the hand could use). */
  manaEfficiency: Summary;
}

function resolveOptions(opts: RunOptions): GameOptions {
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
  const { keepPolicy: _kp, ...optionSummary } = options;
  const report: GoldfishReport = {
    games: n,
    seed,
    options: optionSummary,
    mulligans: summarize(results.map((r) => r.mulligans)),
    keptSeven: proportion(results.filter((r) => r.keptHandSize === 7).length, n),
    openingLands: summarize(results.map((r) => r.openingLands)),
    landsByTurn: perTurn((r) => r.landsInPlay),
    manaByTurn: perTurn((r) => r.manaAvailable),
    screw: proportion(results.filter((r) => r.screwed).length, n),
    flood: proportion(results.filter((r) => r.flooded).length, n),
    landDropsMissed: summarize(results.map((r) => r.landDropsMissedByScrewTurn)),
    manaEfficiency: summarize(
      results.map((r) => {
        const avail = r.manaAvailable.reduce((s, v) => s + v, 0);
        return avail > 0 ? r.manaSpent.reduce((s, v) => s + v, 0) / avail : 0;
      }),
      false,
    ),
  };
  if (deck.commander) {
    const cast = results.filter((r) => r.commanderTurn !== null);
    report.commander = {
      castRate: proportion(cast.length, n),
      turnWhenCast: summarize(cast.map((r) => r.commanderTurn as number)),
    };
  }
  return report;
}

export interface MetricDiff {
  metric: string;
  /** Mean of (B − A) per paired game. */
  meanDiff: number;
  ci95: [number, number];
  /** True when the 95% CI excludes zero. */
  significant: boolean;
}

/**
 * Paired A/B comparison with common random numbers (see simulateGames). Keep the two libraries aligned:
 * the swapped card should sit at the same index in both decks.
 */
export function compareGoldfish(a: SimDeck, b: SimDeck, opts: RunOptions = {}): { a: GoldfishReport; b: GoldfishReport; diffs: MetricDiff[] } {
  const ra = simulateGames(a, opts);
  const rb = simulateGames(b, opts);
  const maxT = ra.options.maxTurns;
  const metrics: [string, (r: GameResult) => number][] = [
    ['lands_turn_4', (r) => r.landsInPlay[3] ?? 0],
    ['mana_turn_4', (r) => r.manaAvailable[3] ?? 0],
    ['mana_turn_6', (r) => r.manaAvailable[5] ?? 0],
    ['screw', (r) => (r.screwed ? 1 : 0)],
    ['flood', (r) => (r.flooded ? 1 : 0)],
    ['mana_spent_total', (r) => r.manaSpent.reduce((s, v) => s + v, 0)],
  ];
  if (a.commander && b.commander) metrics.push(['commander_turn', (r) => r.commanderTurn ?? maxT + 1]);
  const diffs = metrics.map(([metric, f]) => {
    const d = pairedDifference(ra.results.map(f), rb.results.map(f));
    return { metric, meanDiff: d.meanDiff, ci95: d.ci95, significant: d.ci95[0] > 0 || d.ci95[1] < 0 };
  });
  return {
    a: buildReport(a, ra.options, ra.seed, ra.results),
    b: buildReport(b, rb.options, rb.seed, rb.results),
    diffs,
  };
}
