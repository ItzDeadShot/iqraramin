/**
 * Two-component PCA of a handful of vectors (the 8 client updates), done by
 * hand. With n points in d dimensions (n=8, d=13 here), the eigenvectors of
 * the n x n Gram matrix of centered rows give the principal-component
 * scores directly (score_i = u[i] * sqrt(lambda)), which is cheaper and
 * simpler than the d x d covariance. Two eigenpairs via power iteration
 * with deflation.
 */

export interface PcaResult {
	/** 2D score per input vector. */
	points: [number, number][];
	/** Extra vectors (e.g. the aggregated update) projected onto the same axes. */
	extraPoints: [number, number][];
	/** Gram eigenvectors, in "client space" (length n each). Feed back in as
	 * prevBasis next round so axis signs stay put between rounds. */
	basis: number[][];
	/** Share of total variance each component explains. */
	explained: [number, number];
}

function dotN(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

function normalize(v: number[]): number[] {
	const norm = Math.sqrt(dotN(v, v));
	return norm < 1e-15 ? v.map(() => 0) : v.map((x) => x / norm);
}

function powerIteration(matrix: number[][], iterations = 300): { vector: number[]; value: number } {
	const n = matrix.length;
	// Deterministic, non-symmetric start so it isn't accidentally orthogonal
	// to the leading eigenvector for symmetric-looking inputs.
	let v = normalize(Array.from({ length: n }, (_, i) => 1 + i / n));
	for (let it = 0; it < iterations; it++) {
		const next = matrix.map((row) => dotN(row, v));
		const normalized = normalize(next);
		if (normalized.every((x) => x === 0)) return { vector: normalized, value: 0 };
		v = normalized;
	}
	const mv = matrix.map((row) => dotN(row, v));
	return { vector: v, value: Math.max(0, dotN(v, mv)) };
}

export function pca2d(vectors: Float64Array[], extra: Float64Array[] = [], prevBasis?: number[][]): PcaResult {
	const n = vectors.length;
	const d = vectors[0]?.length ?? 0;

	const mean = new Float64Array(d);
	for (const v of vectors) for (let k = 0; k < d; k++) mean[k] += v[k] / n;
	const centered = vectors.map((v) => v.map((x, k) => x - mean[k]));

	let gram = centered.map((a) => centered.map((b) => dotN(a, b)));
	const totalVariance = gram.reduce((s, row, i) => s + row[i], 0);

	const basis: number[][] = [];
	const values: number[] = [];
	for (let c = 0; c < 2; c++) {
		let { vector, value } = powerIteration(gram);
		const prev = prevBasis?.[c];
		if (prev && prev.length === n) {
			if (dotN(vector, prev) < 0) vector = vector.map((x) => -x);
		} else {
			const pivot = vector.reduce((best, x, i) => (Math.abs(x) > Math.abs(vector[best]) ? i : best), 0);
			if (vector[pivot] < 0) vector = vector.map((x) => -x);
		}
		basis.push(vector);
		values.push(value);
		gram = gram.map((row, i) => row.map((g, j) => g - value * vector[i] * vector[j]));
	}

	const points = vectors.map((_, i) => [0, 1].map((c) => basis[c][i] * Math.sqrt(values[c])) as [number, number]);

	// Feature-space direction of each component, to project extra vectors:
	// v_c = X^T u_c / sqrt(lambda_c).
	const directions = [0, 1].map((c) => {
		const dir = new Float64Array(d);
		if (values[c] < 1e-15) return dir;
		const scale = 1 / Math.sqrt(values[c]);
		centered.forEach((row, i) => {
			for (let k = 0; k < d; k++) dir[k] += row[k] * basis[c][i] * scale;
		});
		return dir;
	});
	const extraPoints = extra.map(
		(e) => [0, 1].map((c) => dotN(e.map((x, k) => x - mean[k]), directions[c])) as [number, number],
	);

	const explained: [number, number] =
		totalVariance < 1e-15 ? [0, 0] : [values[0] / totalVariance, values[1] / totalVariance];

	return { points, extraPoints, basis, explained };
}
