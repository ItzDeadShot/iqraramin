/**
 * Pure math for Piece 2 ("Evade my detector"): a toy logistic regression
 * trained offline on a subset of NSL-KDD (see scripts/prepare_ids_dataset.py
 * and src/content/data/ids/). Every function here is deterministic and has
 * no dependency on the DOM, so it runs identically at build time (for the
 * static first paint) and in the browser (for live slider updates), and is
 * unit tested directly in detector.test.ts.
 */

export type Transform = 'log1p' | 'none';

export interface FeatureSpec {
	key: string;
	label: string;
	unit: string;
	description: string;
	min: number;
	max: number;
	transform: Transform;
}

export interface ScalerParams {
	featureOrder: string[];
	mean: number[];
	std: number[];
	benignMean: number[];
}

export interface ModelParams {
	featureOrder: string[];
	weights: number[];
	bias: number;
	testAccuracy: number;
	testSetSize: number;
	testBenign: number;
	testMalicious: number;
}

export interface FeatureNote {
	locked: boolean;
	reason?: string;
	cost?: string;
}

export interface SampleFlow {
	attackType: string;
	category: string;
	features: Record<string, number>;
	modelProbability: number;
	featureNotes: Record<string, FeatureNote>;
}

export interface DeltaResult {
	featuresChanged: number;
	distanceMoved: number;
}

export interface CounterfactualResult extends DeltaResult {
	rawFeatures: Record<string, number>;
	/** False when even saturating every unlocked feature at its plausible
	 * bound can't reach targetLogit; rawFeatures then holds that saturated
	 * (closest-possible) point instead, and achievedProbability says how
	 * close it actually gets. */
	feasible: boolean;
	achievedProbability: number;
}

/** A change smaller than this in standardized (z) space does not count as a
 * "changed" feature for display purposes; floating point drift and truly
 * untouched features both land far below it. */
const CHANGE_EPSILON = 1e-3;

export function applyTransform(value: number, transform: Transform): number {
	return transform === 'log1p' ? Math.log1p(value) : value;
}

export function inverseTransform(value: number, transform: Transform): number {
	return transform === 'log1p' ? Math.expm1(value) : value;
}

export function sigmoid(z: number): number {
	return 1 / (1 + Math.exp(-z));
}

function specFor(features: FeatureSpec[], key: string): FeatureSpec {
	const spec = features.find((f) => f.key === key);
	if (!spec) throw new Error(`No feature spec for "${key}"`);
	return spec;
}

/** Raw feature record -> standardized vector, in scaler.featureOrder order. */
export function toZ(
	rawFeatures: Record<string, number>,
	features: FeatureSpec[],
	scaler: ScalerParams,
): number[] {
	return scaler.featureOrder.map((key, i) => {
		const spec = specFor(features, key);
		const t = applyTransform(rawFeatures[key], spec.transform);
		return (t - scaler.mean[i]) / scaler.std[i];
	});
}

/** The benign-mean baseline, expressed in the same standardized space as
 * toZ() output, per feature (scaler.featureOrder order). */
export function baselineZ(scaler: ScalerParams): number[] {
	return scaler.featureOrder.map((_, i) => (scaler.benignMean[i] - scaler.mean[i]) / scaler.std[i]);
}

export function dot(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
	return sum;
}

export function computeLogit(z: number[], model: ModelParams): number {
	return dot(z, model.weights) + model.bias;
}

export function computeProbability(
	rawFeatures: Record<string, number>,
	features: FeatureSpec[],
	scaler: ScalerParams,
	model: ModelParams,
): number {
	return sigmoid(computeLogit(toZ(rawFeatures, features, scaler), model));
}

/** Per-feature attribution w_i * (z_i - baseline_z_i), keyed by feature key.
 * These sum exactly to (current logit - baseline logit): a linear model's
 * attribution is just a decomposition of that difference, term by term. */
export function computeAttributions(
	rawFeatures: Record<string, number>,
	features: FeatureSpec[],
	scaler: ScalerParams,
	model: ModelParams,
): Record<string, number> {
	const z = toZ(rawFeatures, features, scaler);
	const zBase = baselineZ(scaler);
	const result: Record<string, number> = {};
	scaler.featureOrder.forEach((key, i) => {
		result[key] = model.weights[i] * (z[i] - zBase[i]);
	});
	return result;
}

/** How far `current` has moved from `original`, in the model's own
 * standardized-feature geometry (not raw units, which aren't
 * scale-comparable across features measured in seconds vs bytes vs
 * fractions). */
export function computeDelta(
	original: Record<string, number>,
	current: Record<string, number>,
	features: FeatureSpec[],
	scaler: ScalerParams,
): DeltaResult {
	const zOriginal = toZ(original, features, scaler);
	const zCurrent = toZ(current, features, scaler);
	let changed = 0;
	let distanceSq = 0;
	zOriginal.forEach((v, i) => {
		const d = zCurrent[i] - v;
		if (Math.abs(d) > CHANGE_EPSILON) changed += 1;
		distanceSq += d * d;
	});
	return { featuresChanged: changed, distanceMoved: Math.sqrt(distanceSq) };
}

function featureZBounds(spec: FeatureSpec, scaler: ScalerParams, i: number): [number, number] {
	const zMin = (applyTransform(spec.min, spec.transform) - scaler.mean[i]) / scaler.std[i];
	const zMax = (applyTransform(spec.max, spec.transform) - scaler.mean[i]) / scaler.std[i];
	return zMin <= zMax ? [zMin, zMax] : [zMax, zMin];
}

/**
 * The minimum-L2-norm perturbation (in standardized space) of the
 * *unlocked* features that pushes the logit to `targetLogit` (0 by
 * default, i.e. probability 0.5), subject to every feature's plausible
 * [min, max] raw range (an attacker can dial a feature anywhere within its
 * realistic range, not to an arbitrary real number).
 *
 * With no bounds, minimizing ||dz_U||^2 subject to sum_i w_i*dz_i = delta
 * has the closed-form solution dz_i = w_i * delta / sum_j(w_j^2) (a
 * standard Lagrange-multiplier / minimum-norm result). Bounds turn this
 * into a small active-set problem: solve the unconstrained closed form
 * over the current free set, clamp any feature whose solution falls
 * outside its bound to that bound and move it to a fixed set, then re-solve
 * over the remaining free features with the fixed ones' contribution
 * already accounted for. This terminates in at most one pass per feature
 * since the free set strictly shrinks each time it repeats.
 *
 * feasible is false when every unlocked feature ends up saturated at a
 * bound and the target still isn't reached; rawFeatures then holds that
 * saturated point (the closest this sample can get) and
 * achievedProbability reports how close.
 */
export function computeMinimalCounterfactual(
	rawFeatures: Record<string, number>,
	features: FeatureSpec[],
	scaler: ScalerParams,
	model: ModelParams,
	lockedKeys: ReadonlySet<string>,
	targetLogit = 0,
): CounterfactualResult | null {
	const z = toZ(rawFeatures, features, scaler);
	const currentLogit = computeLogit(z, model);

	const free = new Set(
		scaler.featureOrder.map((_, i) => i).filter((i) => !lockedKeys.has(scaler.featureOrder[i])),
	);
	if (free.size === 0) return null;

	const newZ = [...z];
	let fixedContribution = 0;
	let feasible = false;

	for (let pass = 0; pass <= free.size; pass++) {
		const remaining = targetLogit - currentLogit - fixedContribution;
		const sumWSq = [...free].reduce((s, i) => s + model.weights[i] ** 2, 0);
		if (sumWSq < 1e-12) break;

		const violations: Array<{ i: number; bound: number }> = [];
		for (const i of free) {
			const dz = (model.weights[i] * remaining) / sumWSq;
			const candidate = z[i] + dz;
			const [zMin, zMax] = featureZBounds(specFor(features, scaler.featureOrder[i]), scaler, i);
			newZ[i] = candidate;
			if (candidate < zMin) violations.push({ i, bound: zMin });
			else if (candidate > zMax) violations.push({ i, bound: zMax });
		}

		if (violations.length === 0) {
			feasible = true;
			break;
		}
		for (const { i, bound } of violations) {
			fixedContribution += model.weights[i] * (bound - z[i]);
			newZ[i] = bound;
			free.delete(i);
		}
	}

	const newRaw: Record<string, number> = { ...rawFeatures };
	let changed = 0;
	let distanceSq = 0;
	scaler.featureOrder.forEach((key, i) => {
		if (lockedKeys.has(key)) return;
		const spec = specFor(features, key);
		const transformedNew = newZ[i] * scaler.std[i] + scaler.mean[i];
		newRaw[key] = inverseTransform(transformedNew, spec.transform);
		const dz = newZ[i] - z[i];
		if (Math.abs(dz) > CHANGE_EPSILON) changed += 1;
		distanceSq += dz * dz;
	});

	const achievedLogit = computeLogit(newZ, model);

	return {
		rawFeatures: newRaw,
		featuresChanged: changed,
		distanceMoved: Math.sqrt(distanceSq),
		feasible,
		achievedProbability: sigmoid(achievedLogit),
	};
}

/** Human-readable rendering of a raw feature value, unit-aware. Shared by
 * the server-rendered initial state and the client-side live updates so
 * the two never drift apart. */
export function formatFeatureValue(spec: FeatureSpec, raw: number): string {
	switch (spec.unit) {
		case 'boolean':
			return raw >= 0.5 ? 'yes' : 'no';
		case 'fraction':
			return raw.toFixed(2);
		case 'bytes':
			return `${Math.round(raw).toLocaleString('en-US')} bytes`;
		case 'seconds':
			return `${raw.toFixed(1)}s`;
		case 'connections':
			return `${Math.round(raw)}`;
		default:
			return `${raw}`;
	}
}

/** Plain-language rendering of a counterfactual result, shared by the
 * server-rendered initial state and the client so the wording never drifts
 * between the two, and so it's covered by the same tests as the math. */
export function describeCounterfactual(
	counterfactual: CounterfactualResult | null,
	features: FeatureSpec[],
	lockedKeys: ReadonlySet<string>,
): string {
	if (!counterfactual) {
		return 'Every feature is locked for this sample, so there is nothing left to adjust.';
	}
	const hasFractionalBoolean = features.some((spec) => {
		if (spec.unit !== 'boolean' || lockedKeys.has(spec.key)) return false;
		const value = counterfactual.rawFeatures[spec.key];
		return Math.abs(value - Math.round(value)) > 1e-6;
	});
	const caveat = hasFractionalBoolean
		? " (this idealized minimum nudges a yes/no feature partway, which isn't realizable in an actual flow)"
		: '';

	if (counterfactual.feasible) {
		return (
			`The smallest realistic change that flips this: adjust ${counterfactual.featuresChanged} ` +
			`feature${counterfactual.featuresChanged === 1 ? '' : 's'}, moving ${counterfactual.distanceMoved.toFixed(2)} ` +
			`units in the model's standardized feature space${caveat}.`
		);
	}
	return (
		`Even at the most extreme plausible value for every adjustable feature, this flow cannot be pushed ` +
		`below the detection threshold: the best reachable confidence is ` +
		`${(counterfactual.achievedProbability * 100).toFixed(1)}%. The features locked for this attack type ` +
		`are carrying too much of the signal here.`
	);
}

export function lockedKeysFor(sample: SampleFlow): Set<string> {
	return new Set(
		Object.entries(sample.featureNotes)
			.filter(([, note]) => note.locked)
			.map(([key]) => key),
	);
}
