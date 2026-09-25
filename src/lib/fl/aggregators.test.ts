import { describe, expect, it } from 'vitest';
import { coordinateMedian, fedAvg, multiKrum, trimmedMean } from './aggregators';

const v = (...xs: number[]) => Float64Array.from(xs);

describe('fedAvg', () => {
	it('is the sample-count weighted mean', () => {
		const result = fedAvg([v(1, 0), v(3, 4)], [1, 3]);
		expect(Array.from(result.update)).toEqual([2.5, 3]);
		expect(result.rejected).toEqual([false, false]);
	});
});

describe('coordinateMedian', () => {
	it('takes the middle value per coordinate (odd n)', () => {
		const result = coordinateMedian([v(1, 9), v(2, 8), v(100, -50)]);
		expect(Array.from(result.update)).toEqual([2, 8]);
	});

	it('averages the two middle values per coordinate (even n)', () => {
		const result = coordinateMedian([v(1), v(2), v(3), v(1000)]);
		expect(Array.from(result.update)).toEqual([2.5]);
		expect(result.rejected.every((r) => !r)).toBe(true);
		// Client with 1000 never lands in the middle.
		expect(result.excludedFraction[3]).toBe(1);
	});
});

describe('trimmedMean', () => {
	it('drops floor(beta*n) values from each end per coordinate', () => {
		// n=4, beta=0.25 -> trim 1 each end: [1,2,3,1000] -> mean(2,3) = 2.5
		const result = trimmedMean([v(1), v(2), v(3), v(1000)], 0.25);
		expect(Array.from(result.update)).toEqual([2.5]);
		expect(result.excludedFraction).toEqual([1, 0, 0, 1]);
	});

	it('flags a client as rejected only when trimmed in most coordinates', () => {
		const updates = [v(0, 0, 0), v(1, 1, 1), v(2, 2, 2), v(1000, 1000, -1)];
		const result = trimmedMean(updates, 0.25);
		// Client 3 is the top value in 2 of 3 coordinates and bottom in the
		// third: trimmed in all 3.
		expect(result.rejected[3]).toBe(true);
		expect(result.rejected[1]).toBe(false);
	});

	it('beta = 0 is the plain mean', () => {
		const result = trimmedMean([v(1), v(2), v(6)], 0);
		expect(result.update[0]).toBeCloseTo(3, 12);
	});
});

describe('multiKrum', () => {
	it('rejects the f furthest-out updates and averages the rest', () => {
		const updates = [v(0, 0), v(0.1, 0), v(0, 0.1), v(0.1, 0.1), v(0.05, 0.05), v(50, 50)];
		const result = multiKrum(updates, 1);
		expect(result.rejected).toEqual([false, false, false, false, false, true]);
		expect(result.update[0]).toBeCloseTo(0.05, 12);
		expect(result.update[1]).toBeCloseTo(0.05, 12);
	});

	it('refuses configurations where n <= 2f + 2', () => {
		expect(() => multiKrum([v(0), v(1), v(2), v(3)], 1)).toThrow();
	});
});
