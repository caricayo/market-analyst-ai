export type SeededRng = { seed: number; step: number };

function mix32(value: number): number {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function createSeedFromString(seedText: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function nextFloat(rng: SeededRng): { value: number; rng: SeededRng } {
  const mixed = mix32(rng.seed + rng.step * 2654435761);
  return {
    value: mixed / 4294967296,
    rng: { seed: rng.seed, step: rng.step + 1 },
  };
}

export function rollInt(rng: SeededRng, minInclusive: number, maxInclusive: number): { value: number; rng: SeededRng } {
  const { value, rng: next } = nextFloat(rng);
  const span = maxInclusive - minInclusive + 1;
  return { value: Math.floor(value * span) + minInclusive, rng: next };
}

export function rollD100(rng: SeededRng): { value: number; rng: SeededRng } {
  return rollInt(rng, 1, 100);
}

export function pickOne<T>(rng: SeededRng, items: T[]): { value: T; rng: SeededRng } {
  const { value, rng: next } = rollInt(rng, 0, items.length - 1);
  return { value: items[value], rng: next };
}

export function pickWeighted<T>(rng: SeededRng, entries: Array<{ weight: number; value: T }>): { value: T; rng: SeededRng } {
  const total = entries.reduce((acc, entry) => acc + Math.max(entry.weight, 0), 0);
  if (total <= 0) {
    throw new Error("pickWeighted requires positive total weight");
  }
  const { value: roll, rng: next } = nextFloat(rng);
  const target = roll * total;
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += Math.max(entry.weight, 0);
    if (target <= cumulative) {
      return { value: entry.value, rng: next };
    }
  }
  return { value: entries[entries.length - 1].value, rng: next };
}

