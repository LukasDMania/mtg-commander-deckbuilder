import type { Pips, SimCard } from './types.js';

/**
 * Mana payment with colors. A pool is a list of mana units; each unit is the set of colors it can be, as a string
 * ('G', 'WU', 'C', 'WUBRG' = any color). Colored pips are matched to units with a bipartite matching (so a
 * payment is found whenever one exists); generic mana is then paid with the least flexible units left.
 */
export interface Cost {
  generic: number;
  pips: string[]; // one entry per colored (or C) symbol, e.g. ['G', 'G', 'U']
}

export function pipList(pips: Pips | undefined): string[] {
  const out: string[] = [];
  if (!pips) return out;
  for (const [color, n] of Object.entries(pips)) for (let i = 0; i < (n ?? 0); i++) out.push(color);
  return out;
}

export function costOf(manaValue: number, pips: Pips | undefined, reduction = 0): Cost {
  const list = pipList(pips);
  const generic = Math.max(0, manaValue - list.length - reduction);
  return { generic, pips: list };
}

export function totalCost(c: Cost): number {
  return c.generic + c.pips.length;
}

/** Indexes of pool units used to pay `cost`, or null if it can't be paid. Does not modify the pool. */
export function findPayment(pool: readonly string[], cost: Cost): number[] | null {
  if (totalCost(cost) > pool.length) return null;
  // Order units least-flexible first so matching prefers e.g. a Forest over a Command Tower for a G pip.
  const order = pool.map((_, i) => i).sort((a, b) => (pool[a] as string).length - (pool[b] as string).length);
  const unitOwner = new Array<number>(pool.length).fill(-1); // unit → pip index
  const pips = [...cost.pips].sort(
    (x, y) => pool.filter((u) => u.includes(x)).length - pool.filter((u) => u.includes(y)).length,
  );
  const tryAssign = (p: number, seen: boolean[]): boolean => {
    const color = pips[p] as string;
    for (const u of order) {
      if (seen[u] || !(pool[u] as string).includes(color)) continue;
      seen[u] = true;
      if (unitOwner[u] === -1 || tryAssign(unitOwner[u] as number, seen)) {
        unitOwner[u] = p;
        return true;
      }
    }
    return false;
  };
  for (let p = 0; p < pips.length; p++) if (!tryAssign(p, new Array<boolean>(pool.length).fill(false))) return null;
  const used = unitOwner.map((o, u) => (o >= 0 ? u : -1)).filter((u) => u >= 0);
  const free = order.filter((u) => unitOwner[u] === -1);
  if (free.length < cost.generic) return null;
  return [...used, ...free.slice(0, cost.generic)];
}

/** Remove the units at `idx` from the pool (in place). */
export function spend(pool: string[], idx: number[]): void {
  for (const i of [...idx].sort((a, b) => b - a)) pool.splice(i, 1);
}

/** Colors a card's cost needs, e.g. 'GU'. */
export function colorsNeeded(card: Pick<SimCard, 'pips'>): string {
  return pipList(card.pips)
    .filter((c) => c !== 'C')
    .filter((c, i, a) => a.indexOf(c) === i)
    .join('');
}
