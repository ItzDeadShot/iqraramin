import { describe, expect, it } from 'vitest';
import { pca2d } from './pca';
import { deriveSeed, gaussian, mulberry32, shuffle } from './prng';

describe('mulberry32 / deriveSeed', () => {
	it('is deterministic for a seed and stays in [0, 1)', () => {
		const a = mulberry32(123);
		const b = mulberry32(123);
		for (let i = 0; i < 1000; i++) {
			const x = a();
			expect(x).toBe(b());
			expect(x).toBeGreaterThanOrEqual(0);
			expect(x).toBeLessThan(1);
		}
	});

	it('gives different streams for different (round, client) parts', () => {
		expect(deriveSeed(42, 1, 3, 1)).not.toBe(deriveSeed(42, 1, 4, 1));
		expect(deriveSeed(42, 1, 3, 1)).not.toBe(deriveSeed(42, 2, 3, 1));
		expect(deriveSeed(42, 1, 3, 1)).toBe(deriveSeed(42, 1, 3, 1));
	});

	it('gaussian samples have roughly zero mean and unit variance', () => {
		const rand = mulberry32(7);
		const xs = Array.from({ length: 20000 }, () => gaussian(rand));
		const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
		const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
		expect(Math.abs(mean)).toBeLessThan(0.03);
		expect(Math.abs(variance - 1)).toBeLessThan(0.05);
	});

	it('shuffle is a seeded permutation', () => {
		const a = shuffle([0, 1, 2, 3, 4, 5, 6, 7], mulberry32(1));
		const b = shuffle([0, 1, 2, 3, 4, 5, 6, 7], mulberry32(1));
		expect(a).toEqual(b);
		expect([...a].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
	});
});

describe('pca2d', () => {
	const v = (...xs: number[]) => Float64Array.from(xs);

	it('puts all variance on one component for collinear points', () => {
		const pts = [v(0, 0, 0), v(1, 2, 3), v(2, 4, 6), v(-1, -2, -3)];
		const result = pca2d(pts);
		expect(result.explained[0]).toBeCloseTo(1, 6);
		expect(result.explained[1]).toBeCloseTo(0, 6);
		for (const [, y] of result.points) expect(Math.abs(y)).toBeLessThan(1e-6);
		// Distances along PC1 match distances in the original space.
		const dist = Math.hypot(result.points[1][0] - result.points[0][0], result.points[1][1] - result.points[0][1]);
		expect(dist).toBeCloseTo(Math.hypot(1, 2, 3), 6);
	});

	it('preserves pairwise distances for data that is exactly 2D', () => {
		const pts = [v(0, 0, 5), v(3, 0, 5), v(0, 4, 5), v(3, 4, 5)];
		const result = pca2d(pts);
		const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
		expect(d(result.points[0], result.points[3])).toBeCloseTo(5, 6);
		expect(d(result.points[1], result.points[2])).toBeCloseTo(5, 6);
	});

	it('projects extra vectors onto the same axes', () => {
		const pts = [v(0, 0), v(2, 0), v(4, 0)];
		const result = pca2d(pts, [v(2, 0)]);
		// (2,0) is the mean, so it projects to the origin.
		expect(Math.abs(result.extraPoints[0][0])).toBeLessThan(1e-9);
	});

	it('keeps axis signs stable when given the previous basis', () => {
		const pts = [v(0, 0), v(1, 0.1), v(2, -0.1), v(-3, 0)];
		const first = pca2d(pts);
		const flipped = first.basis.map((u) => u.map((x) => -x));
		const second = pca2d(pts, [], flipped);
		// Aligned to the flipped basis, the scores flip too.
		expect(second.points[3][0]).toBeCloseTo(-first.points[3][0], 6);
	});
});
