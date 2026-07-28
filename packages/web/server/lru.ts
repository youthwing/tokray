export class WeightedLru<K, V> {
  readonly #entries = new Map<K, { value: V; weight: number }>();
  readonly #maxEntries: number;
  readonly #maxWeight: number;
  #weight = 0;

  constructor(options: { maxEntries: number; maxWeight: number }) {
    this.#maxEntries = options.maxEntries;
    this.#maxWeight = options.maxWeight;
  }

  get size(): number { return this.#entries.size; }
  get weight(): number { return this.#weight; }

  get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, weight: number): void {
    const previous = this.#entries.get(key);
    if (previous) {
      this.#weight -= previous.weight;
      this.#entries.delete(key);
    }
    const normalizedWeight = Math.max(1, weight);
    this.#entries.set(key, { value, weight: normalizedWeight });
    this.#weight += normalizedWeight;
    while (this.#entries.size > this.#maxEntries || this.#weight > this.#maxWeight) {
      const oldestKey = this.#entries.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.#entries.get(oldestKey);
      this.#entries.delete(oldestKey);
      this.#weight -= oldest?.weight ?? 0;
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#weight = 0;
  }
}
