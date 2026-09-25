/**
 * Server-side aggregation rules for federated learning. Every rule takes
 * the per-client update vectors (local model minus current global model)
 * and returns one aggregated update, plus which clients were excluded, so
 * the UI can show exactly what the server threw away.
 */

export type AggregatorId = 'fedavg' | 'median' | 'trimmed_mean' | 'krum';

export interface AggregationResult {
	update: Float64Array;
	/** True when a client's update was left out of the aggregate. */
	rejected: boolean[];
	/** Fraction of coordinates in which that client's value was discarded
	 * (1 or 0 for whole-update rules like Multi-Krum). */
	excludedFraction: number[];
}

export interface AggregatorParams {
	/** Trimmed mean: fraction trimmed from EACH end, per coordinate. */
	trimBeta: number;
	/** Multi-Krum: number of Byzantine clients to tolerate. */
	krumF: number;
}

function dims(updates: Float64Array[]): number {
	return updates[0]?.length ?? 0;
}

/** Sample-count weighted mean (FedAvg). Rejects nobody. */
export function fedAvg(updates: Float64Array[], weights: number[]): AggregationResult {
	const d = dims(updates);
	const total = weights.reduce((s, w) => s + w, 0);
	const update = new Float64Array(d);
	updates.forEach((u, i) => {
		for (let k = 0; k < d; k++) update[k] += (u[k] * weights[i]) / total;
	});
	return { update, rejected: updates.map(() => false), excludedFraction: updates.map(() => 0) };
}

/**
 * Coordinate-wise trimmed mean: per coordinate, sort the client values,
 * drop floor(beta * n) from each end, average the rest. beta = 0 is the
 * plain unweighted mean. A client counts as "rejected" when it was trimmed
 * in more than half of the coordinates: trimming is per coordinate, so
 * honest clients get trimmed now and then too, and only a consistent
 * outlier gets dropped nearly everywhere.
 */
export function trimmedMean(updates: Float64Array[], beta: number): AggregationResult {
	const n = updates.length;
	const d = dims(updates);
	const trim = Math.min(Math.floor(beta * n), Math.floor((n - 1) / 2));
	const update = new Float64Array(d);
	const trimmedCount = new Array(n).fill(0);

	for (let k = 0; k < d; k++) {
		const order = updates.map((u, i) => ({ v: u[k], i })).sort((a, b) => a.v - b.v || a.i - b.i);
		const kept = order.slice(trim, n - trim);
		for (const { i } of order.slice(0, trim)) trimmedCount[i]++;
		for (const { i } of order.slice(n - trim)) trimmedCount[i]++;
		update[k] = kept.reduce((s, x) => s + x.v, 0) / kept.length;
	}

	const excludedFraction = trimmedCount.map((c) => (d === 0 ? 0 : c / d));
	return { update, rejected: excludedFraction.map((f) => f > 0.5), excludedFraction };
}

/**
 * Coordinate-wise median. With an even client count the median of a
 * coordinate is the mean of the two middle values, so 6 of 8 clients are
 * "excluded" in every coordinate by construction; marking them all as
 * rejected would say nothing, so median reports the fractions but rejects
 * nobody outright.
 */
export function coordinateMedian(updates: Float64Array[]): AggregationResult {
	const n = updates.length;
	const d = dims(updates);
	const update = new Float64Array(d);
	const usedCount = new Array(n).fill(0);

	for (let k = 0; k < d; k++) {
		const order = updates.map((u, i) => ({ v: u[k], i })).sort((a, b) => a.v - b.v || a.i - b.i);
		const mid = Math.floor(n / 2);
		const middle = n % 2 === 1 ? [order[mid]] : [order[mid - 1], order[mid]];
		update[k] = middle.reduce((s, x) => s + x.v, 0) / middle.length;
		for (const { i } of middle) usedCount[i]++;
	}

	return {
		update,
		rejected: updates.map(() => false),
		excludedFraction: usedCount.map((c) => (d === 0 ? 0 : 1 - c / d)),
	};
}

function squaredDistance(a: Float64Array, b: Float64Array): number {
	let s = 0;
	for (let k = 0; k < a.length; k++) {
		const diff = a[k] - b[k];
		s += diff * diff;
	}
	return s;
}

/**
 * Multi-Krum (Blanchard et al., 2017). Each client's score is the sum of
 * squared distances to its n - f - 2 nearest neighbours; the n - f
 * lowest-scoring updates are averaged and the f highest are rejected.
 * Classic Krum keeps only the single best update, which would mark 7 of 8
 * honest clients as "rejected" and make the picture useless, so this uses
 * the Multi-Krum variant and says so in the UI. Requires n > 2f + 2.
 */
export function multiKrum(updates: Float64Array[], f: number): AggregationResult {
	const n = updates.length;
	if (n <= 2 * f + 2) {
		throw new Error(`Multi-Krum needs n > 2f + 2 (got n=${n}, f=${f})`);
	}
	const neighbours = n - f - 2;
	const scores = updates.map((u, i) => {
		const dists = updates
			.map((v, j) => (i === j ? Infinity : squaredDistance(u, v)))
			.sort((a, b) => a - b);
		return dists.slice(0, neighbours).reduce((s, x) => s + x, 0);
	});

	const ranked = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s || a.i - b.i);
	const selected = new Set(ranked.slice(0, n - f).map((x) => x.i));

	const d = dims(updates);
	const update = new Float64Array(d);
	for (const i of selected) {
		for (let k = 0; k < d; k++) update[k] += updates[i][k] / selected.size;
	}

	const rejected = updates.map((_, i) => !selected.has(i));
	return { update, rejected, excludedFraction: rejected.map((r) => (r ? 1 : 0)) };
}

export function aggregate(
	id: AggregatorId,
	updates: Float64Array[],
	weights: number[],
	params: AggregatorParams,
): AggregationResult {
	switch (id) {
		case 'fedavg':
			return fedAvg(updates, weights);
		case 'median':
			return coordinateMedian(updates);
		case 'trimmed_mean':
			return trimmedMean(updates, params.trimBeta);
		case 'krum':
			return multiKrum(updates, params.krumF);
	}
}
