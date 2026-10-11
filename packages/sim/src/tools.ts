import { MIN_TURNS_BY_BRACKET, type Bracket } from '@cdb/rules';
import { alwaysKeep, isManaSource } from './game.js';
import { buildReport, simulateGames, type GoldfishReport, type RunOptions } from './runner.js';
import { pairedDifference, proportion, quantile, type Proportion } from './stats.js';
import type { GameResult, KeepPolicy, SimCard, SimDeck } from './types.js';

// ---------------------------------------------------------------------------------------------------------------
// Objective: what "better" means for a deck. Turn metrics: lower is better.
// ---------------------------------------------------------------------------------------------------------------

export type Objective = 'win_turn' | 'commander_turn' | 'mana_spent_total' | 'screw_plus_flood';

/**
 * Pick a sensible objective: win turn if the deck wins unopposed in ≥ 20% of goldfish games, else total mana spent
 * (it punishes both screw and flood). 'commander_turn' is available explicitly but favours ever more lands.
 */
export function defaultObjective(_deck: SimDeck, base: GameResult[]): Objective {
  const winRate = base.filter((r) => r.winTurn !== null).length / Math.max(1, base.length);
  return winRate >= 0.2 ? 'win_turn' : 'mana_spent_total';
}

function objectiveValue(objective: Objective, maxTurns: number): (r: GameResult) => number {
  const never = maxTurns + 2;
  switch (objective) {
    case 'win_turn':
      return (r) => r.winTurn ?? never;
    case 'commander_turn':
      return (r) => r.commanderTurn ?? never;
    case 'mana_spent_total':
      return (r) => -r.manaSpent.reduce((s, v) => s + v, 0); // negated so lower is better everywhere
    case 'screw_plus_flood':
      return (r) => (r.screwed ? 1 : 0) + (r.flooded ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Land sweep
// ---------------------------------------------------------------------------------------------------------------

export interface LandSweepRow {
  lands: number;
  screw: number;
  colorScrew: number;
  flood: number;
  manaTurn4: number;
  manaTurn6: number;
  commanderTurnP50: number | null;
  winRate: number;
  winTurnP50: number | null;
  /** Mean objective value (lower is better), paired against the original deck. */
  objective: number;
  objectiveVsCurrent: { meanDiff: number; ci95: [number, number]; significant: boolean };
}

export interface LandSweepResult {
  objective: Objective;
  currentLands: number;
  rows: LandSweepRow[];
  /** Fewest lands whose objective is not significantly worse than the best row. */
  recommended: number;
  note: string;
}

/**
 * Re-runs the deck at different land counts. Fewer lands: basic lands become `filler` spells (default: a spell at
 * the deck's average nonland mana value). More lands: the highest-mana-value plain spells/creatures become the
 * deck's most common basic land. Positions are kept, so every row is paired against the current deck.
 */
export function landSweep(
  deck: SimDeck,
  opts: RunOptions & { from?: number; to?: number; objective?: Objective; filler?: SimCard } = {},
): LandSweepResult {
  const games = opts.games ?? 4000;
  const base = simulateGames(deck, { ...opts, games });
  const objective = opts.objective ?? defaultObjective(deck, base.results);
  const value = objectiveValue(objective, base.options.maxTurns);
  const baseVals = base.results.map(value);

  const lib = deck.library;
  const landIdx = lib.map((c, i) => (c.kind === 'land' ? i : -1)).filter((i) => i >= 0);
  const current = landIdx.length;
  const basicIdx = landIdx.filter((i) => lib[i]?.basic).reverse();
  const nonlands = lib.filter((c) => c.kind !== 'land' && c.kind !== 'blank');
  const avgMv = Math.round(nonlands.reduce((s, c) => s + c.manaValue, 0) / Math.max(1, nonlands.length));
  const filler: SimCard = opts.filler ?? { name: 'Sweep filler', kind: 'spell', manaValue: avgMv };
  const basicCounts = new Map<string, { card: SimCard; n: number }>();
  for (const i of basicIdx) {
    const c = lib[i] as SimCard;
    const e = basicCounts.get(c.name);
    if (e) e.n += 1;
    else basicCounts.set(c.name, { card: c, n: 1 });
  }
  const addBasic = [...basicCounts.values()].sort((a, b) => b.n - a.n)[0]?.card ?? { name: 'Wastes', kind: 'land', manaValue: 0, basic: true };
  const cuttable = lib
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => (c.kind === 'spell' || c.kind === 'creature') && !(deck.combos ?? []).some((k) => k.pieces.includes(c.name)))
    .sort((a, b) => b.c.manaValue - a.c.manaValue)
    .map(({ i }) => i);

  const from = opts.from ?? Math.max(28, current - 4);
  const to = opts.to ?? Math.min(44, current + 4);
  const rows: LandSweepRow[] = [];
  for (let k = from; k <= to; k++) {
    const variant = lib.slice();
    if (k < current) {
      if (current - k > basicIdx.length) continue;
      for (const i of basicIdx.slice(0, current - k)) variant[i] = filler;
    } else if (k > current) {
      if (k - current > cuttable.length) continue;
      for (const i of cuttable.slice(0, k - current)) variant[i] = addBasic;
    }
    const v = k === current ? base : simulateGames({ ...deck, library: variant }, { ...opts, games });
    const rep = buildReport({ ...deck, library: variant }, v.options, v.seed, v.results);
    const vals = v.results.map(value);
    const d = pairedDifference(baseVals, vals);
    rows.push({
      lands: k,
      screw: rep.screw.rate,
      colorScrew: rep.colorScrew.rate,
      flood: rep.flood.rate,
      manaTurn4: rep.manaByTurn[3]?.mean ?? 0,
      manaTurn6: rep.manaByTurn[5]?.mean ?? 0,
      commanderTurnP50: rep.commander ? rep.commander.turnWhenCast.p50 : null,
      winRate: rep.win.rate.rate,
      winTurnP50: rep.win.turnWhenWon.n ? rep.win.turnWhenWon.p50 : null,
      objective: vals.reduce((s, x) => s + x, 0) / vals.length,
      objectiveVsCurrent: { meanDiff: d.meanDiff, ci95: d.ci95, significant: d.ci95[0] > 0 || d.ci95[1] < 0 },
    });
  }
  // best row, then the fewest lands within that row's noise (≈ CI half-width of the paired difference)
  const best = rows.reduce((a, b) => (b.objective < a.objective ? b : a));
  const tolerance = Math.max(...rows.map((r) => (r.objectiveVsCurrent.ci95[1] - r.objectiveVsCurrent.ci95[0]) / 2));
  const recommended = rows.filter((r) => r.objective <= best.objective + tolerance).reduce((a, b) => (b.lands < a.lands ? b : a)).lands;
  return {
    objective,
    currentLands: current,
    rows,
    recommended,
    note:
      recommended === current
        ? `Keep ${current} lands.`
        : `${recommended} lands scores as well as the best option (${best.lands}) on ${objective}; you play ${current}.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Card impact (leave-one-out)
// ---------------------------------------------------------------------------------------------------------------

export interface CardImpact {
  name: string;
  kind: SimCard['kind'];
  copies: number;
  /** How much worse the objective gets when this card is replaced by a blank (positive = the card helps). */
  impact: number;
  ci95: [number, number];
  significant: boolean;
}

/**
 * Replace every copy of one card with a blank (a card that does nothing), replay the same games, and measure how
 * much the objective suffers. Basic lands and interaction (which a goldfish never casts) are skipped.
 */
export function cardImpact(deck: SimDeck, opts: RunOptions & { objective?: Objective } = {}): { objective: Objective; cards: CardImpact[] } {
  const games = opts.games ?? 2000;
  const base = simulateGames(deck, { ...opts, games });
  const objective = opts.objective ?? defaultObjective(deck, base.results);
  const value = objectiveValue(objective, base.options.maxTurns);
  const baseVals = base.results.map(value);
  const names = new Map<string, { kind: SimCard['kind']; positions: number[] }>();
  deck.library.forEach((c, i) => {
    if (c.basic || c.kind === 'interaction' || c.kind === 'blank') return;
    const e = names.get(c.name);
    if (e) e.positions.push(i);
    else names.set(c.name, { kind: c.kind, positions: [i] });
  });
  const cards: CardImpact[] = [];
  for (const [name, { kind, positions }] of names) {
    const variant = deck.library.slice();
    for (const p of positions) variant[p] = { name: `${name} (blank)`, kind: 'blank', manaValue: 0 };
    const v = simulateGames({ ...deck, library: variant }, { ...opts, games });
    const d = pairedDifference(baseVals, v.results.map(value));
    cards.push({ name, kind, copies: positions.length, impact: d.meanDiff, ci95: d.ci95, significant: d.ci95[0] > 0 || d.ci95[1] < 0 });
  }
  cards.sort((a, b) => b.impact - a.impact);
  return { objective, cards };
}

// ---------------------------------------------------------------------------------------------------------------
// Mulligan guide
// ---------------------------------------------------------------------------------------------------------------

export interface MulliganBucket {
  lands: number;
  /** Cheap (MV ≤ 2) mana sources in hand, capped at 2 ("2" means 2 or more). */
  cheapSources: number;
  /** Share of opening 7s that look like this. */
  share: number;
  hands: number;
  goodRate: Proportion;
  /** Keep this as your first 7 (a free mulligan would give a fresh 7)? */
  keepFirst7: 'keep' | 'mulligan' | 'too rare to tell';
  /** Keep this 7 when the next hand would have to bottom a card (6 cards)? */
  keepVsSix: 'keep' | 'mulligan' | 'too rare to tell';
}

export interface MulliganGuide {
  goodGame: string;
  baselineFresh7: number;
  baselineSix: number;
  buckets: MulliganBucket[];
  rules: string[];
}

/**
 * Learns which opening hands are worth keeping for THIS deck: plays games keeping every 7, scores each game as
 * good/bad, and compares each hand type with what a fresh 7 (free mulligan) or a 6-card hand achieves on average.
 */
export function mulliganGuide(
  deck: SimDeck,
  opts: RunOptions & { goodTurn?: number; goodGame?: 'auto' | 'commander' | 'mana' } = {},
): MulliganGuide {
  const games = opts.games ?? 20_000;
  const raw = simulateGames(deck, { ...opts, games, keepPolicy: alwaysKeep });
  const { good, label } = goodGameRule(deck, raw.results, opts.goodTurn, opts.goodGame ?? 'auto');
  const baselineFresh7 = raw.results.filter(good).length / games;
  const mullOnce: KeepPolicy = (_h, ctx) => ctx.mulligans >= 1;
  const six = simulateGames(deck, { ...opts, games: Math.round(games / 2), keepPolicy: mullOnce, freeFirstMulligan: false });
  const baselineSix = six.results.filter(good).length / six.results.length;

  const buckets = new Map<string, { lands: number; cheap: number; n: number; good: number }>();
  for (const r of raw.results) {
    const hand = r.openingHand.map((i) => deck.library[i] as SimCard);
    const lands = hand.filter((c) => c.kind === 'land').length;
    const cheap = Math.min(2, hand.filter((c) => isManaSource(c) && c.manaValue <= 2).length);
    const key = `${lands}/${cheap}`;
    const b = buckets.get(key) ?? { lands, cheap, n: 0, good: 0 };
    b.n += 1;
    if (good(r)) b.good += 1;
    buckets.set(key, b);
  }
  const minHands = 50;
  const verdict = (rate: number, n: number, baseline: number) =>
    n < minHands ? ('too rare to tell' as const) : rate >= baseline ? ('keep' as const) : ('mulligan' as const);
  const out: MulliganBucket[] = [...buckets.values()]
    .sort((a, b) => a.lands - b.lands || a.cheap - b.cheap)
    .map((b) => {
      const p = proportion(b.good, b.n);
      return {
        lands: b.lands,
        cheapSources: b.cheap,
        share: b.n / games,
        hands: b.n,
        goodRate: p,
        keepFirst7: verdict(p.rate, b.n, baselineFresh7),
        keepVsSix: verdict(p.rate, b.n, baselineSix),
      };
    });

  const rules: string[] = [];
  for (const cheap of [0, 1, 2]) {
    const keepLands = out.filter((b) => b.cheapSources === cheap && b.keepFirst7 === 'keep').map((b) => b.lands);
    const label2 = cheap === 0 ? 'no cheap mana rock/dork/ramp' : cheap === 1 ? '1 cheap mana source' : '2+ cheap mana sources';
    if (keepLands.length) rules.push(`First 7 with ${label2}: keep with ${rangeText(keepLands)} lands.`);
    else rules.push(`First 7 with ${label2}: usually take the free mulligan.`);
  }
  const looser = out.filter((b) => b.keepVsSix === 'keep' && b.keepFirst7 === 'mulligan');
  if (looser.length)
    rules.push(`After the free mulligan, also keep: ${looser.map((b) => `${b.lands} lands + ${b.cheapSources}${b.cheapSources === 2 ? '+' : ''} cheap sources`).join('; ')}.`);
  return { goodGame: label, baselineFresh7, baselineSix, buckets: out, rules };
}

/**
 * What counts as a good game. 'auto': wins by the median win turn if the deck wins in ≥ 20% of games, else spends at
 * least the median amount of mana by turn 6 (punishes screw and flood alike). 'commander': commander cast by the
 * median commander turn.
 */
function goodGameRule(
  deck: SimDeck,
  results: GameResult[],
  goodTurn: number | undefined,
  mode: 'auto' | 'commander' | 'mana',
): { good: (r: GameResult) => boolean; label: string } {
  const winTurns = results.map((r) => r.winTurn).filter((t): t is number => t !== null).sort((a, b) => a - b);
  if (mode === 'auto' && winTurns.length / results.length >= 0.2) {
    const t = goodTurn ?? Math.round(quantile(winTurns, 0.5));
    return { good: (r) => r.winTurn !== null && r.winTurn <= t, label: `wins by turn ${t}` };
  }
  if (mode === 'commander' && deck.commander) {
    const ct = results.map((r) => r.commanderTurn).filter((t): t is number => t !== null).sort((a, b) => a - b);
    const t = goodTurn ?? Math.round(quantile(ct, 0.5));
    return { good: (r) => r.commanderTurn !== null && r.commanderTurn <= t, label: `commander cast by turn ${t}` };
  }
  const spent = results.map((r) => r.manaSpent.slice(0, 6).reduce((s, v) => s + v, 0)).sort((a, b) => a - b);
  const m = quantile(spent, 0.5);
  return { good: (r) => r.manaSpent.slice(0, 6).reduce((s, v) => s + v, 0) >= m, label: `spends at least ${m} mana by turn 6` };
}

function rangeText(ns: number[]): string {
  const s = [...ns].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = s[0] as number;
  let prev = start;
  for (const n of s.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  return parts.join(' or ');
}

// ---------------------------------------------------------------------------------------------------------------
// Bracket speed check
// ---------------------------------------------------------------------------------------------------------------

export interface SpeedCheck {
  bracket: Bracket;
  minTurns: number | null;
  /** Share of all games where the deck wins unopposed before the bracket's minimum turn. */
  tooFastRate: number;
  winRate: number;
  medianWinTurn: number | null;
  verdict: 'ok' | 'too fast' | 'no wins found';
  message: string;
}

/**
 * Official guidance: you should get at least N turns before anyone wins (B1 9, B2 8, B3 6, B4 4). A goldfish has no
 * opponents slowing it down, so more than `threshold` (default 10%) of unopposed wins before that turn means the
 * deck plays above its bracket.
 */
export function bracketSpeedCheck(report: GoldfishReport, bracket: Bracket, threshold = 0.1): SpeedCheck {
  const minTurns = MIN_TURNS_BY_BRACKET[bracket];
  const hist = report.win.turnWhenWon.histogram;
  const early = minTurns === null ? 0 : Object.entries(hist).filter(([t]) => Number(t) < minTurns).reduce((s, [, n]) => s + n, 0);
  const tooFastRate = early / report.games;
  const winRate = report.win.rate.rate;
  const medianWinTurn = report.win.turnWhenWon.n ? report.win.turnWhenWon.p50 : null;
  if (report.win.turnWhenWon.n === 0)
    return { bracket, minTurns, tooFastRate: 0, winRate, medianWinTurn, verdict: 'no wins found', message: `No unopposed wins within ${report.options.maxTurns} turns — check that win conditions and combos are modelled.` };
  const verdict = tooFastRate > threshold ? 'too fast' : 'ok';
  const message =
    minTurns === null
      ? `Bracket ${bracket} has no minimum turn; median unopposed win on turn ${medianWinTurn}.`
      : verdict === 'too fast'
        ? `Wins before turn ${minTurns} in ${(tooFastRate * 100).toFixed(1)}% of goldfish games — faster than Bracket ${bracket} expects.`
        : `Wins before turn ${minTurns} in only ${(tooFastRate * 100).toFixed(1)}% of goldfish games — fits Bracket ${bracket}.`;
  return { bracket, minTurns, tooFastRate, winRate, medianWinTurn, verdict, message };
}

