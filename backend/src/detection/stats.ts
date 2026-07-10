// Small, dependency-free statistics helpers shared by the detection modules.
// Kept pure and unit-testable in isolation from any OnchainOS data shape.

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Coefficient of variation: low CoV = suspiciously regular (bot-like) cadence. */
export function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return stddev(xs) / m;
}

/** Sorted ascending deltas between consecutive timestamps (ms). */
export function interArrivalDeltas(timestampsMs: number[]): number[] {
  const sorted = [...timestampsMs].sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    deltas.push(sorted[i]! - sorted[i - 1]!);
  }
  return deltas;
}

export function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Share of total held by the top-k groups, sorted by group size descending. */
export function topKShare(groupSizes: number[], k: number): number {
  const total = groupSizes.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const top = [...groupSizes].sort((a, b) => b - a).slice(0, k);
  return top.reduce((a, b) => a + b, 0) / total;
}

/** Normalize free text for near-duplicate comparison: lowercase, strip punctuation/whitespace runs. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shingles(text: string, size = 3): Set<string> {
  const words = text.split(" ").filter(Boolean);
  if (words.length < size) return new Set(words.length ? [words.join(" ")] : []);
  const result = new Set<string>();
  for (let i = 0; i <= words.length - size; i++) {
    result.add(words.slice(i, i + size).join(" "));
  }
  return result;
}

/** Jaccard similarity of word-shingle sets, 0 (disjoint) .. 1 (identical). */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sa = shingles(na);
  const sb = shingles(nb);
  if (sa.size === 0 || sb.size === 0) return na === nb ? 1 : 0;
  let intersection = 0;
  for (const s of sa) if (sb.has(s)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
