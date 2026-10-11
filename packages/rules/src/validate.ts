import { BRACKET_POLICY, ROLE_EXTRA_TURN, ROLE_MASS_LAND_DENIAL } from './brackets.js';
import { normalizeCardName, type DeckList } from './parse.js';
import { COLORS, type Bracket, type CardInfo, type CardLookup, type Color, type ComboInfo } from './types.js';

export type IssueCode =
  | 'UNKNOWN_CARD'
  | 'NO_COMMANDER'
  | 'TOO_MANY_COMMANDERS'
  | 'NOT_A_COMMANDER'
  | 'INVALID_PAIRING'
  | 'DECK_SIZE'
  | 'SINGLETON'
  | 'COMMANDER_IN_DECK'
  | 'COLOR_IDENTITY'
  | 'NOT_LEGAL'
  | 'OVER_BUDGET'
  | 'PRICE_MISSING'
  | 'PRICE_ESTIMATED'
  | 'GAME_CHANGERS'
  | 'MASS_LAND_DENIAL'
  | 'EXTRA_TURNS'
  | 'TWO_CARD_COMBO';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
  cards?: string[];
}

export interface ValidateOptions {
  /** Target bracket; when set, bracket rules for that bracket are enforced. */
  bracket?: Bracket;
  /** Budget cap in €. */
  budgetEur?: number;
  /** Count the commander(s) toward the budget (default true). */
  includeCommanderInBudget?: boolean;
  /** Known combos (e.g. Commander Spellbook); those fully present in the deck are evaluated. */
  combos?: ComboInfo[];
}

export interface DeckStats {
  lands: number;
  nonlands: number;
  averageManaValueNonland: number;
  /** Nonland mana curve; key 7 = 7 or more. */
  curve: Record<number, number>;
  types: Record<string, number>;
  roles: Record<string, number>;
}

export interface BracketReport {
  target?: Bracket;
  /** The lowest bracket this list is allowed in by the deckbuilding rules (speed is checked by the simulator). */
  minimumByRules: Bracket;
  reasons: string[];
}

export interface ValidationReport {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  cardCount: number;
  colorIdentity: Color[];
  price: { totalEur: number; missing: string[]; estimated: string[] };
  gameChangers: string[];
  extraTurnCards: string[];
  massLandDenial: string[];
  combosPresent: ComboInfo[];
  stats: DeckStats;
  bracket: BracketReport;
}

interface Resolved {
  info: CardInfo;
  qty: number;
  asCommander: boolean;
}

export function validateDeck(deck: DeckList, lookup: CardLookup, opts: ValidateOptions = {}): ValidationReport {
  const issues: Issue[] = [];
  const add = (code: IssueCode, severity: Issue['severity'], message: string, cards?: string[]) =>
    issues.push(cards && cards.length ? { code, severity, message, cards } : { code, severity, message });

  // ---- resolve names ----
  const unknown: string[] = [];
  const commanders: Resolved[] = [];
  const mainByOracle = new Map<string, Resolved>();
  for (const c of deck.commanders) {
    const info = lookup.get(c.name);
    if (!info) unknown.push(c.name);
    else commanders.push({ info, qty: c.qty, asCommander: true });
  }
  for (const c of deck.cards) {
    const info = lookup.get(c.name);
    if (!info) {
      unknown.push(c.name);
      continue;
    }
    const existing = mainByOracle.get(info.oracleId);
    if (existing) existing.qty += c.qty;
    else mainByOracle.set(info.oracleId, { info, qty: c.qty, asCommander: false });
  }
  if (unknown.length) add('UNKNOWN_CARD', 'error', `${unknown.length} card name(s) not found in the card database`, unknown);
  const main = [...mainByOracle.values()];
  const all = [...commanders, ...main];

  // ---- commanders ----
  const commanderQty = deck.commanders.reduce((n, c) => n + c.qty, 0);
  if (deck.commanders.length === 0) add('NO_COMMANDER', 'error', 'No commander given');
  if (deck.commanders.length > 2 || commanderQty > 2)
    add('TOO_MANY_COMMANDERS', 'error', 'At most two commanders (a valid pair) are allowed');
  for (const c of commanders) {
    const kinds = c.info.partnerKinds ?? [];
    const isBackground = kinds.includes('background');
    if (!c.info.canBeCommander || (isBackground && commanders.length === 1))
      add('NOT_A_COMMANDER', 'error', `${c.info.name} can't be your commander`, [c.info.name]);
  }
  if (commanders.length === 2) {
    const [a, b] = commanders as [Resolved, Resolved];
    if (!canPair(a.info, b.info))
      add('INVALID_PAIRING', 'error', `${a.info.name} and ${b.info.name} can't be paired as commanders`, [a.info.name, b.info.name]);
  }
  const commanderIds = new Set(commanders.map((c) => c.info.oracleId));
  const dupCommander = main.filter((m) => commanderIds.has(m.info.oracleId)).map((m) => m.info.name);
  if (dupCommander.length) add('COMMANDER_IN_DECK', 'error', 'Commander also listed in the main deck', dupCommander);

  // ---- size ----
  // Count every listed card, resolved or not, so an unknown name doesn't also show up as a size error.
  const cardCount = commanderQty + deck.cards.reduce((n, c) => n + c.qty, 0);
  if (cardCount !== 100) add('DECK_SIZE', 'error', `Deck has ${cardCount} cards including commander(s); it must have exactly 100`);

  // ---- singleton ----
  const tooMany = main.filter((m) => m.qty > allowedCopies(m.info)).map((m) => `${m.info.name} ×${m.qty}`);
  if (tooMany.length) add('SINGLETON', 'error', 'Only one copy of each card (basic lands and a few named exceptions aside)', tooMany);

  // ---- color identity ----
  const identity = new Set<Color>(commanders.flatMap((c) => c.info.colorIdentity));
  const offColor = main.filter((m) => m.info.colorIdentity.some((col) => !identity.has(col))).map((m) => m.info.name);
  if (offColor.length && commanders.length)
    add('COLOR_IDENTITY', 'error', `Cards outside the commander's color identity (${fmtIdentity(identity)})`, offColor);

  // ---- legality ----
  const illegal = all.filter((r) => !r.info.legalCommander).map((r) => r.info.name);
  if (illegal.length) add('NOT_LEGAL', 'error', 'Not legal in Commander (banned or not a Commander-legal card)', illegal);

  // ---- price ----
  const includeCmd = opts.includeCommanderInBudget ?? true;
  let totalEur = 0;
  const missing: string[] = [];
  const estimated: string[] = [];
  for (const r of includeCmd ? all : main) {
    const p = r.info.priceEur;
    if (p === undefined || p === null) {
      missing.push(r.info.name);
      continue;
    }
    totalEur += p * r.qty;
    if (r.info.priceIsEstimate) estimated.push(r.info.name);
  }
  totalEur = Math.round(totalEur * 100) / 100;
  if (opts.budgetEur !== undefined && totalEur > opts.budgetEur)
    add('OVER_BUDGET', 'error', `Deck costs €${totalEur.toFixed(2)}, over the €${opts.budgetEur.toFixed(2)} budget`);
  if (missing.length) add('PRICE_MISSING', 'warning', 'No price known; not counted in the total', missing);
  if (estimated.length) add('PRICE_ESTIMATED', 'warning', 'Price converted from USD (no Cardmarket price)', estimated);

  // ---- bracket ----
  const gameChangers = all.filter((r) => r.info.isGameChanger).map((r) => r.info.name);
  const extraTurnCards = main.filter((r) => hasRole(r.info, ROLE_EXTRA_TURN)).map((r) => r.info.name);
  const massLandDenial = main.filter((r) => hasRole(r.info, ROLE_MASS_LAND_DENIAL)).map((r) => r.info.name);
  const deckNames = new Set(all.map((r) => normalizeCardName(r.info.name)));
  const combosPresent = (opts.combos ?? []).filter(
    (c) => c.cards.length >= 2 && c.cards.every((n) => deckNames.has(normalizeCardName(n))),
  );
  const twoCard = combosPresent.filter((c) => c.cards.length === 2 && c.gameEnding);

  const bracket = minimumBracket(gameChangers.length, massLandDenial.length, extraTurnCards.length, twoCard);
  if (opts.bracket !== undefined) {
    bracket.target = opts.bracket;
    const pol = BRACKET_POLICY[opts.bracket];
    if (pol.maxGameChangers !== null && gameChangers.length > pol.maxGameChangers)
      add('GAME_CHANGERS', 'error', `${gameChangers.length} Game Changers; Bracket ${opts.bracket} allows ${pol.maxGameChangers}`, gameChangers);
    if (!pol.massLandDenial && massLandDenial.length)
      add('MASS_LAND_DENIAL', 'error', `Mass land denial isn't allowed in Bracket ${opts.bracket}`, massLandDenial);
    if (pol.extraTurns === 'none' && extraTurnCards.length)
      add('EXTRA_TURNS', 'error', `Extra-turn cards aren't expected in Bracket ${opts.bracket}`, extraTurnCards);
    else if (pol.extraTurns === 'few' && pol.maxExtraTurnCards !== null && extraTurnCards.length > pol.maxExtraTurnCards)
      add('EXTRA_TURNS', 'warning', `${extraTurnCards.length} extra-turn cards; Bracket ${opts.bracket} expects few and never chained`, extraTurnCards);
    const badCombos =
      pol.twoCardCombos === 'none' ? twoCard : pol.twoCardCombos === 'late-only' ? twoCard.filter((c) => c.early) : [];
    if (badCombos.length)
      add(
        'TWO_CARD_COMBO',
        'error',
        pol.twoCardCombos === 'none'
          ? `Game-ending two-card combos aren't allowed in Bracket ${opts.bracket}`
          : `Early-game two-card combos aren't allowed in Bracket ${opts.bracket}`,
        badCombos.map((c) => c.cards.join(' + ')),
      );
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    cardCount,
    colorIdentity: COLORS.filter((c) => identity.has(c)),
    price: { totalEur, missing, estimated },
    gameChangers,
    extraTurnCards,
    massLandDenial,
    combosPresent,
    stats: deckStats(main),
    bracket,
  };
}

function minimumBracket(gcCount: number, mldCount: number, extraTurns: number, twoCard: ComboInfo[]): BracketReport {
  let min: Bracket = 1;
  const reasons: string[] = [];
  const raise = (b: Bracket, why: string) => {
    if (b > min) min = b;
    reasons.push(why);
  };
  if (extraTurns > 0) raise(2, `${extraTurns} extra-turn card(s)`);
  if (extraTurns > 2) raise(4, `${extraTurns} extra-turn cards (chaining likely)`);
  if (gcCount > 0) raise(3, `${gcCount} Game Changer(s)`);
  if (gcCount > 3) raise(4, `more than 3 Game Changers`);
  if (mldCount > 0) raise(4, 'mass land denial');
  if (twoCard.some((c) => !c.early)) raise(3, 'late-game two-card combo');
  if (twoCard.some((c) => c.early)) raise(4, 'early-game two-card combo');
  return { minimumByRules: min, reasons };
}

export function canPair(a: CardInfo, b: CardInfo): boolean {
  const ka = a.partnerKinds ?? [];
  const kb = b.partnerKinds ?? [];
  if (ka.includes('partner') && kb.includes('partner')) return true;
  if (
    ka.includes('partner-with') &&
    kb.includes('partner-with') &&
    a.partnerWith !== undefined &&
    b.partnerWith !== undefined &&
    normalizeCardName(a.partnerWith) === normalizeCardName(b.name) &&
    normalizeCardName(b.partnerWith) === normalizeCardName(a.name)
  )
    return true;
  if (ka.includes('friends-forever') && kb.includes('friends-forever')) return true;
  if ((ka.includes('choose-background') && kb.includes('background')) || (kb.includes('choose-background') && ka.includes('background')))
    return true;
  if ((ka.includes('doctors-companion') && kb.includes('doctor')) || (kb.includes('doctors-companion') && ka.includes('doctor')))
    return true;
  return false;
}

export function allowedCopies(info: CardInfo): number {
  if (isBasicLand(info) || info.anyNumberAllowed) return Number.POSITIVE_INFINITY;
  return info.maxCopies ?? 1;
}

export function isBasicLand(info: CardInfo): boolean {
  return /^Basic\b/.test(info.typeLine) && /\bLand\b/.test(info.typeLine);
}

/** Land if the front face is a land (modal DFCs with a land back count as spells). */
export function isLand(info: CardInfo): boolean {
  const front = info.typeLine.split(' // ')[0] ?? info.typeLine;
  return /\bLand\b/.test(front);
}

function hasRole(info: CardInfo, role: string): boolean {
  return (info.roles ?? []).includes(role);
}

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Land'] as const;

function deckStats(main: Resolved[]): DeckStats {
  const curve: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  const types: Record<string, number> = {};
  const roles: Record<string, number> = {};
  let lands = 0;
  let nonlands = 0;
  let mvSum = 0;
  for (const r of main) {
    const front = r.info.typeLine.split(' // ')[0] ?? r.info.typeLine;
    const t = TYPE_ORDER.find((x) => new RegExp(`\\b${x}\\b`).test(front)) ?? 'Other';
    types[t] = (types[t] ?? 0) + r.qty;
    for (const role of r.info.roles ?? []) roles[role] = (roles[role] ?? 0) + r.qty;
    if (isLand(r.info)) {
      lands += r.qty;
      continue;
    }
    nonlands += r.qty;
    mvSum += r.info.manaValue * r.qty;
    const bucket = Math.min(7, Math.floor(r.info.manaValue));
    curve[bucket] = (curve[bucket] ?? 0) + r.qty;
  }
  return {
    lands,
    nonlands,
    averageManaValueNonland: nonlands ? Math.round((mvSum / nonlands) * 100) / 100 : 0,
    curve,
    types,
    roles,
  };
}

function fmtIdentity(identity: Set<Color>): string {
  const s = COLORS.filter((c) => identity.has(c)).join('');
  return s || 'colorless';
}
