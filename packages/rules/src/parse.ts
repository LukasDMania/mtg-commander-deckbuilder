import type { DeckEntry, ParsedDeck, Section } from './types.js';

/**
 * Parses decklists pasted from Moxfield, Archidekt, MTGO/Arena or plain text.
 *
 * Supported line shapes (quantity optional, defaults to 1):
 *   1 Sol Ring
 *   1x Sol Ring
 *   Sol Ring
 *   1 Sol Ring (C21) 263
 *   1 Sol Ring (C21) 263 *F*
 *   1x Sol Ring (c21) 263 [Ramp]                      ← Archidekt
 *   1x The Ur-Dragon (cmm) 361 [Commander{top}]      ← Archidekt commander
 *   1x Lightning Bolt [Maybeboard{noDeck}{noPrice}]  ← Archidekt maybeboard
 *
 * Section headers (optional "//" prefix and ":" suffix, any case): Commander(s), Deck, Main, Mainboard,
 * Sideboard, Maybeboard, Maybe, Considering, Companion, About (ignored until the next header).
 * Lines starting with "#" are comments. Blank lines do NOT change sections (MTGO-style "sideboard after a
 * blank line" is ambiguous for Commander, so pass commanders explicitly in that case).
 */
const HEADER_MAP: Record<string, Section | 'ignore'> = {
  commander: 'commander',
  commanders: 'commander',
  deck: 'main',
  main: 'main',
  mainboard: 'main',
  'main deck': 'main',
  sideboard: 'sideboard',
  maybeboard: 'maybeboard',
  maybe: 'maybeboard',
  considering: 'maybeboard',
  companion: 'companion',
  about: 'ignore',
};

const LINE_RE = /^(?:(\d+)\s*[xX]?\s+)?(.+)$/;
const CATEGORY_RE = /\s*\[([^\]]*)\]\s*$/;
const LABEL_RE = /\s*\^[^^]*\^\s*$/;
const FOIL_RE = /\s*\*(F|E|Foil|Etched)\*\s*$/i;
const SET_RE = /\s*\(([A-Za-z0-9]{2,8})\)\s*([A-Za-z0-9\-★†]+)?\s*$/;

export function parseDecklist(text: string): ParsedDeck {
  const entries: DeckEntry[] = [];
  const problems: ParsedDeck['problems'] = [];
  let section: Section | 'ignore' = 'main';

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    const headerKey = line.replace(/^\/\/\s*/, '').replace(/:\s*$/, '').trim().toLowerCase();
    const header = HEADER_MAP[headerKey];
    if (header !== undefined) {
      section = header;
      return;
    }
    if (line.startsWith('//')) return; // other comment
    if (section === 'ignore') return;

    const m = LINE_RE.exec(line);
    if (!m || m[2] === undefined) {
      problems.push({ line: i + 1, text: raw, reason: 'not a card line' });
      return;
    }
    const qty = m[1] !== undefined ? Number(m[1]) : 1;
    let rest = m[2].trim();

    // Archidekt label (^Tag,#color^) and categories ([A,B{flag}])
    rest = rest.replace(LABEL_RE, '');
    let categories: string[] | undefined;
    let entrySection: Section = section;
    const cat = CATEGORY_RE.exec(rest);
    if (cat && cat[1] !== undefined) {
      rest = rest.slice(0, cat.index).trim();
      const parsed = parseArchidektCategories(cat[1]);
      categories = parsed.names;
      if (parsed.section) entrySection = parsed.section;
    }
    rest = rest.replace(LABEL_RE, '');

    let foil: boolean | undefined;
    const f = FOIL_RE.exec(rest);
    if (f) {
      foil = true;
      rest = rest.slice(0, f.index).trim();
    }

    let setCode: string | undefined;
    let collectorNumber: string | undefined;
    const s = SET_RE.exec(rest);
    if (s && s[1] !== undefined) {
      setCode = s[1].toLowerCase();
      if (s[2] !== undefined) collectorNumber = s[2];
      rest = rest.slice(0, s.index).trim();
    }

    const name = rest.replace(/\s+/g, ' ').trim();
    if (name === '' || !Number.isInteger(qty) || qty < 1) {
      problems.push({ line: i + 1, text: raw, reason: 'missing card name or bad quantity' });
      return;
    }

    const entry: DeckEntry = { qty, name, section: entrySection };
    if (setCode !== undefined) entry.setCode = setCode;
    if (collectorNumber !== undefined) entry.collectorNumber = collectorNumber;
    if (foil) entry.foil = true;
    if (categories && categories.length > 0) entry.categories = categories;
    entries.push(entry);
  });

  return { entries, problems };
}

function parseArchidektCategories(raw: string): { names: string[]; section?: Section } {
  const names: string[] = [];
  let section: Section | undefined;
  for (const part of raw.split(',')) {
    const flags = [...part.matchAll(/\{([^}]*)\}/g)].map((x) => (x[1] ?? '').toLowerCase());
    const name = part.replace(/\{[^}]*\}/g, '').trim();
    if (name) names.push(name);
    const lower = name.toLowerCase();
    if (lower === 'commander') section = 'commander';
    else if (lower === 'sideboard' && section !== 'commander') section = 'sideboard';
    else if ((lower === 'maybeboard' || flags.includes('nodeck')) && section === undefined) section = 'maybeboard';
  }
  return section ? { names, section } : { names };
}

/** The 100-card part of a parsed list: commanders + main deck, duplicates merged by name. */
export interface DeckList {
  commanders: { name: string; qty: number }[];
  cards: { name: string; qty: number }[];
  companion?: string;
}

export interface ToDeckOptions {
  /** Names to treat as commanders when the list has no commander section (e.g. MTGO exports). */
  commanders?: string[];
}

export function toDeckList(parsed: ParsedDeck, opts: ToDeckOptions = {}): DeckList {
  const forced = new Set((opts.commanders ?? []).map(normalizeCardName));
  const commanders = new Map<string, { name: string; qty: number }>();
  const cards = new Map<string, { name: string; qty: number }>();
  let companion: string | undefined;

  for (const e of parsed.entries) {
    const key = normalizeCardName(e.name);
    if (e.section === 'sideboard' || e.section === 'maybeboard') continue;
    if (e.section === 'companion') {
      companion = e.name;
      continue;
    }
    const target = e.section === 'commander' || forced.has(key) ? commanders : cards;
    const existing = target.get(key);
    if (existing) existing.qty += e.qty;
    else target.set(key, { name: e.name, qty: e.qty });
  }
  const list: DeckList = { commanders: [...commanders.values()], cards: [...cards.values()] };
  if (companion !== undefined) list.companion = companion;
  return list;
}

/** Lowercase, strip accents, unify apostrophes/quotes and whitespace. "Nazgûl" → "nazgul". */
export function normalizeCardName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*\/\/\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export type ExportFormat = 'text' | 'archidekt';

/**
 * Export a deck list.
 * - 'text': "Commander" section then "Deck" section, "1 Name" lines. Plain enough for Moxfield/Archidekt/MTGO
 *   paste importers (verify Moxfield's commander handling on the PC).
 * - 'archidekt': "1x Name [Category]" with commanders as "[Commander{top}]"; `roles` maps name → category.
 */
export function exportDeckList(
  deck: DeckList,
  format: ExportFormat = 'text',
  roles: Record<string, string> = {},
): string {
  if (format === 'archidekt') {
    const lines = deck.commanders.map((c) => `${c.qty}x ${c.name} [Commander{top}]`);
    for (const c of deck.cards) {
      const role = roles[c.name];
      lines.push(role ? `${c.qty}x ${c.name} [${role}]` : `${c.qty}x ${c.name}`);
    }
    return lines.join('\n') + '\n';
  }
  const out = ['Commander', ...deck.commanders.map((c) => `${c.qty} ${c.name}`), '', 'Deck'];
  out.push(...deck.cards.map((c) => `${c.qty} ${c.name}`));
  return out.join('\n') + '\n';
}
