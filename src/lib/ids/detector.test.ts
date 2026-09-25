import { describe, expect, it } from 'vitest';
import {
	applyTransform,
	baselineZ,
	computeAttributions,
	computeDelta,
	computeLogit,
	computeMinimalCounterfactual,
	computeProbability,
	inverseTransform,
	lockedKeysFor,
	sigmoid,
	toZ,
	type FeatureSpec,
	type ModelParams,
	type ScalerParams,
} from './detector';
import { FEATURES, MODEL, SAMPLES, SCALER } from './data';

describe('sigmoid', () => {
	it('is 0.5 at z=0', () => {
		expect(sigmoid(0)).toBeCloseTo(0.5, 10);
	});
	it('approaches 0 and 1 at the extremes', () => {
		expect(sigmoid(-50)).toBeCloseTo(0, 6);
		expect(sigmoid(50)).toBeCloseTo(1, 6);
	});
});

describe('transform round-trip', () => {
	it('log1p/expm1 round-trips', () => {
		for (const v of [0, 1, 42, 12345.678]) {
			expect(inverseTransform(applyTransform(v, 'log1p'), 'log1p')).toBeCloseTo(v, 6);
		}
	});
	it('none is the identity', () => {
		expect(inverseTransform(applyTransform(3.14, 'none'), 'none')).toBe(3.14);
	});
});

// A tiny synthetic 2-feature model so the closed-form math can be checked
// against hand-computed expectations, independent of the real dataset.
const toyFeatures: FeatureSpec[] = [
	{ key: 'a', label: 'A', unit: 'x', description: '', min: 0, max: 10, transform: 'none' },
	{ key: 'b', label: 'B', unit: 'x', description: '', min: 0, max: 10, transform: 'none' },
];
const toyScaler: ScalerParams = {
	featureOrder: ['a', 'b'],
	mean: [0, 0],
	std: [1, 1],
	benignMean: [0, 0],
};
const toyModel: ModelParams = {
	featureOrder: ['a', 'b'],
	weights: [1, 1],
	bias: 0,
	testAccuracy: 1,
	testSetSize: 0,
	testBenign: 0,
	testMalicious: 0,
};

describe('toZ / computeLogit (toy model, identity scaler)', () => {
	it('z equals the raw value when mean=0, std=1', () => {
		expect(toZ({ a: 3, b: 4 }, toyFeatures, toyScaler)).toEqual([3, 4]);
	});
	it('logit is the dot product plus bias', () => {
		const z = toZ({ a: 3, b: 4 }, toyFeatures, toyScaler);
		expect(computeLogit(z, toyModel)).toBe(7);
	});
});

describe('computeAttributions', () => {
	it('sums exactly to (current logit - baseline logit)', () => {
		const raw = { a: 3, b: -2 };
		const z = toZ(raw, toyFeatures, toyScaler);
		const currentLogit = computeLogit(z, toyModel);
		const baselineLogit = computeLogit(baselineZ(toyScaler), toyModel);
		const attributions = computeAttributions(raw, toyFeatures, toyScaler, toyModel);
		const sum = Object.values(attributions).reduce((s, v) => s + v, 0);
		expect(sum).toBeCloseTo(currentLogit - baselineLogit, 10);
	});

	it('holds for the real trained model and every preselected sample', () => {
		for (const sample of SAMPLES) {
			const z = toZ(sample.features, FEATURES, SCALER);
			const currentLogit = computeLogit(z, MODEL);
			const baselineLogit = computeLogit(baselineZ(SCALER), MODEL);
			const attributions = computeAttributions(sample.features, FEATURES, SCALER, MODEL);
			const sum = Object.values(attributions).reduce((s, v) => s + v, 0);
			expect(sum).toBeCloseTo(currentLogit - baselineLogit, 8);
		}
	});
});

describe('computeProbability against the real model', () => {
	it('agrees with the offline-computed probability for every preselected sample', () => {
		for (const sample of SAMPLES) {
			const p = computeProbability(sample.features, FEATURES, SCALER, MODEL);
			// samples.json stores raw features rounded to 3 decimals and a
			// probability computed from full-precision features, so this is a
			// recomputation from slightly rounded inputs, not a bit-identical
			// replay; a loose tolerance still catches any real math error.
			expect(p).toBeCloseTo(sample.modelProbability, 1);
		}
	});

	it('flags at least one sample with high confidence and spans a difficulty range', () => {
		const probs = SAMPLES.map((s) => s.modelProbability);
		expect(Math.max(...probs)).toBeGreaterThanOrEqual(0.9);
		expect(Math.max(...probs) - Math.min(...probs)).toBeGreaterThan(0.1);
	});
});

describe('computeDelta', () => {
	it('is zero for an unchanged flow', () => {
		const sample = SAMPLES[0];
		const delta = computeDelta(sample.features, sample.features, FEATURES, SCALER);
		expect(delta.featuresChanged).toBe(0);
		expect(delta.distanceMoved).toBeCloseTo(0, 10);
	});

	it('counts exactly the features that actually moved', () => {
		const sample = SAMPLES[0];
		const changedKey = FEATURES.find((f) => !sample.featureNotes[f.key].locked)!.key;
		const modified = { ...sample.features, [changedKey]: sample.features[changedKey] + 50 };
		const delta = computeDelta(sample.features, modified, FEATURES, SCALER);
		expect(delta.featuresChanged).toBe(1);
		expect(delta.distanceMoved).toBeGreaterThan(0);
	});
});

describe('computeMinimalCounterfactual', () => {
	it('never moves a locked feature', () => {
		for (const sample of SAMPLES) {
			const locked = lockedKeysFor(sample);
			const result = computeMinimalCounterfactual(sample.features, FEATURES, SCALER, MODEL, locked);
			expect(result).not.toBeNull();
			for (const key of locked) {
				expect(result!.rawFeatures[key]).toBe(sample.features[key]);
			}
		}
	});

	it('is feasible within plausible bounds and reaches the decision boundary for every preselected sample', () => {
		// This is the finding that drove the bound-constrained rewrite: the
		// original unconstrained closed form solved for values outside a
		// feature's realistic [min, max] (e.g. wanting dst_host_count above
		// its max), which looked "infeasible" once naively clamped even
		// though a real, in-bounds solution exists once the excess is
		// redistributed onto the other free features. All 4 real samples
		// are genuinely evadable within their sliders' plausible ranges.
		for (const sample of SAMPLES) {
			const locked = lockedKeysFor(sample);
			const result = computeMinimalCounterfactual(sample.features, FEATURES, SCALER, MODEL, locked);
			expect(result).not.toBeNull();
			expect(result!.feasible).toBe(true);
			for (const spec of FEATURES) {
				if (locked.has(spec.key)) continue;
				expect(result!.rawFeatures[spec.key]).toBeGreaterThanOrEqual(spec.min - 1e-6);
				expect(result!.rawFeatures[spec.key]).toBeLessThanOrEqual(spec.max + 1e-6);
			}
			const p = computeProbability(result!.rawFeatures, FEATURES, SCALER, MODEL);
			expect(p).toBeCloseTo(0.5, 3);
			expect(result!.achievedProbability).toBeCloseTo(0.5, 3);
		}
	});

	it('returns null when every feature is locked', () => {
		const allLocked = new Set(FEATURES.map((f) => f.key));
		const result = computeMinimalCounterfactual(SAMPLES[0].features, FEATURES, SCALER, MODEL, allLocked);
		expect(result).toBeNull();
	});

	it('matches a hand-computed closed form on the toy model when bounds are wide enough', () => {
		// w=[1,1], b=0, raw=(3,4) with identity scaler => z=(3,4), logit=7.
		// Locking 'a' leaves only 'b' free: need w_b*dz_b = 0-7 = -7, so
		// dz_b = -7 (since w_b=1), new z=(3,-3), logit=0. Bounds wide enough
		// that -3 doesn't get clamped.
		const wideFeatures: FeatureSpec[] = [
			{ ...toyFeatures[0], min: -100, max: 100 },
			{ ...toyFeatures[1], min: -100, max: 100 },
		];
		const result = computeMinimalCounterfactual(
			{ a: 3, b: 4 },
			wideFeatures,
			toyScaler,
			toyModel,
			new Set(['a']),
		);
		expect(result).not.toBeNull();
		expect(result!.feasible).toBe(true);
		expect(result!.rawFeatures.a).toBe(3);
		expect(result!.rawFeatures.b).toBeCloseTo(-3, 10);
		expect(result!.distanceMoved).toBeCloseTo(7, 10);
		expect(result!.featuresChanged).toBe(1);
	});

	it('clamps to the bound and reports infeasible when the target is out of reach', () => {
		// Same toy model, but toyFeatures' bound on 'b' is [0, 10]: the
		// unconstrained solution (-3) falls outside it, so it should clamp to
		// 0 and honestly report infeasible, not silently overshoot the bound.
		const result = computeMinimalCounterfactual(
			{ a: 3, b: 4 },
			toyFeatures,
			toyScaler,
			toyModel,
			new Set(['a']),
		);
		expect(result).not.toBeNull();
		expect(result!.feasible).toBe(false);
		expect(result!.rawFeatures.a).toBe(3);
		expect(result!.rawFeatures.b).toBe(0);
		expect(result!.featuresChanged).toBe(1);
		expect(result!.distanceMoved).toBeCloseTo(4, 10);
		// Best achievable logit is a(3) + b(0) = 3, not the target 0.
		expect(result!.achievedProbability).toBeCloseTo(1 / (1 + Math.exp(-3)), 10);
	});
});
