/** Summary of a numeric metric across games. */
export interface Summary {
  n: number;
  mean: number;
  /** 95% confidence interval of the mean (normal approximation). */
  ci95: [number, number];
  p10: number;
  p50: number;
  p90: number;
  /** Counts per value, for integer-valued metrics (rounded). */
  histogram: Record<string, number>;
}

/** A rate with a Wilson 95% confidence interval. */
export interface Proportion {
  n: number;
  rate: number;
  ci95: [number, number];
}

export function summarize(values: readonly number[], histogram = true): Summary {
  const n = values.length;
  if (n === 0) return { n: 0, mean: NaN, ci95: [NaN, NaN], p10: NaN, p50: NaN, p90: NaN, histogram: {} };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const half = 1.96 * Math.sqrt(variance / n);
  const hist: Record<string, number> = {};
  if (histogram) for (const v of sorted) hist[String(Math.round(v))] = (hist[String(Math.round(v))] ?? 0) + 1;
  return {
    n,
    mean,
    ci95: [mean - half, mean + half],
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    histogram: hist,
  };
}

/** Quantile of an ascending-sorted array (linear interpolation, type 7). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function proportion(successes: number, n: number): Proportion {
  if (n === 0) return { n: 0, rate: NaN, ci95: [NaN, NaN] };
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { n, rate: p, ci95: [Math.max(0, centre - half), Math.min(1, centre + half)] };
}

/** Mean of paired differences (b − a) with a 95% CI. */
export function pairedDifference(a: readonly number[], b: readonly number[]): { n: number; meanDiff: number; ci95: [number, number] } {
  const n = Math.min(a.length, b.length);
  const d: number[] = [];
  for (let i = 0; i < n; i++) d.push((b[i] as number) - (a[i] as number));
  const s = summarize(d, false);
  return { n, meanDiff: s.mean, ci95: s.ci95 };
}

// ---------- exact probabilities (used to validate the simulator) ----------

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** P(X = k) for X ~ Hypergeometric(population N, successes K, draws n). */
export function hypergeomPmf(N: number, K: number, n: number, k: number): number {
  const v = logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n);
  return Number.isFinite(v) ? Math.exp(v) : 0;
}

/** P(X ≥ k). */
export function hypergeomAtLeast(N: number, K: number, n: number, k: number): number {
  let p = 0;
  for (let i = Math.max(0, k); i <= Math.min(K, n); i++) p += hypergeomPmf(N, K, n, i);
  return p;
}
