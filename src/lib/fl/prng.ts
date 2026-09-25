/** mulberry32: small, fast, deterministic 32-bit PRNG. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Mixes several integers into one 32-bit seed, so every (round, client,
 * purpose) gets its own independent stream. That keeps a client's shuffle
 * in round r unchanged when some *other* client's settings change. */
export function deriveSeed(...parts: number[]): number {
	let h = 0x9e3779b9;
	for (const p of parts) {
		h = Math.imul(h ^ (p >>> 0), 0x85ebca6b);
		h ^= h >>> 13;
		h = Math.imul(h, 0xc2b2ae35);
		h ^= h >>> 16;
	}
	return h >>> 0;
}

/** Standard normal sample via Box-Muller. */
export function gaussian(rand: () => number): number {
	let u = 0;
	while (u === 0) u = rand();
	const v = rand();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** In-place Fisher-Yates shuffle. */
export function shuffle<T>(items: T[], rand: () => number): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}
