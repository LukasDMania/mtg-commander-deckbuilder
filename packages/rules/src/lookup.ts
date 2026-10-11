import { normalizeCardName } from './parse.js';
import type { CardInfo, CardLookup } from './types.js';

/** In-memory lookup over a list of cards; indexes full names and front faces of "A // B" cards. */
export function createLookup(cards: Iterable<CardInfo>): CardLookup {
  const byName = new Map<string, CardInfo>();
  for (const c of cards) {
    const full = normalizeCardName(c.name);
    byName.set(full, c);
    const front = full.split(' // ')[0];
    if (front !== undefined && front !== full && !byName.has(front)) byName.set(front, c);
  }
  return { get: (name) => byName.get(normalizeCardName(name)) };
}
