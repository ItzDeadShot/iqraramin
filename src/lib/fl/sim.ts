/**
 * Federated learning simulation for Piece 1: 8 clients, each holding a
 * partition of the NSL-KDD training pool, train a logistic regression
 * locally with seeded mini-batch SGD; the server aggregates their updates
 * with a chosen rule; the new global model is scored on the held-out test
 * set. Pure and deterministic: the same config, seed and sequence of
 * steps always produce the same numbers, which is what makes Reset
 * reproducible and the logic unit-testable. Runs in a Web Worker in the
 * browser and at build time for the static snapshot.
 */

import { applyTransform, type FeatureSpec, type ScalerParams } from '../ids/detector';
import { aggregate, type AggregatorId } from './aggregators';
import { pca2d } from './pca';
import { deriveSeed, gaussian, mulberry32, shuffle } from './prng';

export const N_CLIENTS = 8;

export type AttackType = 'none' | 'label_flip' | 'boost' | 'sign_flip' | 'noise';
export type Distribution = 'iid' | 'non_iid';

export interface ClientAttack {
	type: AttackType;
	/** Multiplier for 'boost' and 'sign_flip'. */
	factor: number;
	/** Standard deviation for 'noise', in model-parameter units. */
	sigma: number;
}

export interface SimConfig {
	aggregator: AggregatorId;
	trimBeta: number;
	krumF: number;
	distribution: Distribution;
	attacks: ClientAttack[];
}

export interface TrainingParams {
	localEpochs: number;
	learningRate: number;
	batchSize: number;
	l2: number;
	/** Standard deviation of the seeded Gaussian initial weights. */
	initScale: number;
	seed: number;
}

export const DEFAULT_TRAINING: TrainingParams = {
	localEpochs: 1,
	learningRate: 0.05,
	batchSize: 25,
	l2: 1e-3,
	initScale: 1,
	seed: 42,
};

export const HONEST: ClientAttack = { type: 'none', factor: 10, sigma: 1 };

export function defaultConfig(): SimConfig {
	return {
		aggregator: 'fedavg',
		trimBeta: 0.125,
		krumF: 1,
		distribution: 'iid',
		attacks: Array.from({ length: N_CLIENTS }, () => ({ ...HONEST })),
	};
}

export interface Dataset {
	poolX: Float64Array[];
	poolY: Uint8Array;
	testX: Float64Array[];
	testY: Uint8Array;
	partitions: Record<Distribution, number[][]>;
	nParams: number;
}

export interface RawSplit {
	columns: string[];
	rows: number[][];
}

export interface RawPartitions {
	iid: number[][];
	nonIid: number[][];
}

/** Raw rows (12 raw features, label, category) -> transformed, standardized
 * feature vectors, using the same scaler the offline pipeline fit on the
 * training pool. All clients share that preprocessing: a simplification
 * (real federated deployments can't usually pool statistics like this),
 * kept so the only thing that differs between clients is their data. */
export function standardizeRows(split: RawSplit, features: FeatureSpec[], scaler: ScalerParams): Float64Array[] {
	const colIndex = scaler.featureOrder.map((key) => split.columns.indexOf(key));
	const specs = scaler.featureOrder.map((key) => {
		const spec = features.find((f) => f.key === key);
		if (!spec) throw new Error(`No feature spec for "${key}"`);
		return spec;
	});
	return split.rows.map((row) => {
		const x = new Float64Array(scaler.featureOrder.length);
		scaler.featureOrder.forEach((_, i) => {
			const t = applyTransform(row[colIndex[i]], specs[i].transform);
			x[i] = (t - scaler.mean[i]) / scaler.std[i];
		});
		return x;
	});
}

export function prepareDataset(
	pool: RawSplit,
	test: RawSplit,
	partitions: RawPartitions,
	features: FeatureSpec[],
	scaler: ScalerParams,
): Dataset {
	const labelCol = pool.columns.indexOf('label');
	return {
		poolX: standardizeRows(pool, features, scaler),
		poolY: Uint8Array.from(pool.rows.map((r) => r[labelCol])),
		testX: standardizeRows(test, features, scaler),
		testY: Uint8Array.from(test.rows.map((r) => r[test.columns.indexOf('label')])),
		partitions: { iid: partitions.iid, non_iid: partitions.nonIid },
		nParams: scaler.featureOrder.length + 1,
	};
}

/** Numerically stable logistic function. */
export function sigmoid(z: number): number {
	if (z >= 0) return 1 / (1 + Math.exp(-z));
	const e = Math.exp(z);
	return e / (1 + e);
}

/** params = [w_0 .. w_{d-1}, bias] */
export function predictProbability(params: Float64Array, x: Float64Array): number {
	let z = params[params.length - 1];
	for (let k = 0; k < x.length; k++) z += params[k] * x[k];
	return sigmoid(z);
}

export interface Evaluation {
	accuracy: number;
	/** Share of malicious test flows the model calls benign. */
	missRate: number;
}

export function evaluate(params: Float64Array, X: Float64Array[], Y: Uint8Array): Evaluation {
	let correct = 0;
	let malicious = 0;
	let missed = 0;
	X.forEach((x, i) => {
		const predicted = predictProbability(params, x) >= 0.5 ? 1 : 0;
		if (predicted === Y[i]) correct++;
		if (Y[i] === 1) {
			malicious++;
			if (predicted === 0) missed++;
		}
	});
	return { accuracy: correct / X.length, missRate: malicious === 0 ? 0 : missed / malicious };
}

/**
 * E epochs of seeded mini-batch SGD with L2, starting from `start`.
 * flipMalicious relabels every malicious (1) row as benign (0): a targeted
 * label-flipping attack whose goal is to make attacks look benign.
 */
export function localTrain(
	start: Float64Array,
	X: Float64Array[],
	Y: Uint8Array,
	indices: number[],
	training: TrainingParams,
	seed: number,
	flipMalicious = false,
): Float64Array {
	const params = Float64Array.from(start);
	const d = params.length - 1;
	const rand = mulberry32(seed);
	const grad = new Float64Array(params.length);

	for (let epoch = 0; epoch < training.localEpochs; epoch++) {
		const order = shuffle([...indices], rand);
		for (let startIdx = 0; startIdx < order.length; startIdx += training.batchSize) {
			const batch = order.slice(startIdx, startIdx + training.batchSize);
			grad.fill(0);
			for (const i of batch) {
				const y = flipMalicious && Y[i] === 1 ? 0 : Y[i];
				const err = predictProbability(params, X[i]) - y;
				for (let k = 0; k < d; k++) grad[k] += err * X[i][k];
				grad[d] += err;
			}
			for (let k = 0; k <= d; k++) {
				const reg = k < d ? training.l2 * params[k] : 0;
				params[k] -= training.learningRate * (grad[k] / batch.length + reg);
			}
		}
	}
	return params;
}

/** Attacks that poison the client's training data before it computes its
 * update. 'boost' is explicit boosting (Bhagoji et al., 2019): the attacker
 * trains toward a malicious objective (here, malicious flows labelled
 * benign), then scales that update so it survives being averaged with
 * honest ones. Scaling an *honest* update does no harm (it just takes a
 * bigger step in the right direction), which is why boost includes the
 * flip. */
export function flipsLabels(attack: ClientAttack): boolean {
	return attack.type === 'label_flip' || attack.type === 'boost';
}

/** Applies a model-poisoning attack to the update the client computed. */
export function poisonUpdate(update: Float64Array, attack: ClientAttack, seed: number): Float64Array {
	switch (attack.type) {
		case 'boost':
			return update.map((v) => v * attack.factor);
		case 'sign_flip':
			return update.map((v) => -v * attack.factor);
		case 'noise': {
			const rand = mulberry32(seed);
			return update.map((v) => v + attack.sigma * gaussian(rand));
		}
		default:
			return update;
	}
}

export interface ClientRoundResult {
	id: number;
	attack: AttackType;
	rejected: boolean;
	excludedFraction: number;
	updateNorm: number;
	point: [number, number];
}

export interface RoundResult {
	round: number;
	accuracy: number;
	missRate: number;
	aggregator: AggregatorId;
	clients: ClientRoundResult[];
	aggregatePoint: [number, number];
	explained: [number, number];
}

export interface SimState {
	round: number;
	global: Float64Array;
	prevBasis?: number[][];
}

/**
 * Seeded Gaussian initial weights. From all-zero weights the very first
 * gradient step already points the right way, and accuracy only cares
 * about direction, so the curve would jump to its plateau in round 1 and
 * there'd be no learning to watch. A random start makes round 0 a genuinely
 * untrained model and the rise over the next rounds genuine training.
 */
export function initialState(dataset: Dataset, training: TrainingParams = DEFAULT_TRAINING): SimState {
	const rand = mulberry32(deriveSeed(training.seed, 0, 0, 0));
	const global = new Float64Array(dataset.nParams).map(() => training.initScale * gaussian(rand));
	return { round: 0, global };
}

function norm(v: Float64Array): number {
	let s = 0;
	for (const x of v) s += x * x;
	return Math.sqrt(s);
}

export function runRound(
	state: SimState,
	dataset: Dataset,
	config: SimConfig,
	training: TrainingParams = DEFAULT_TRAINING,
): { state: SimState; result: RoundResult } {
	const round = state.round + 1;
	const partition = dataset.partitions[config.distribution];

	const updates: Float64Array[] = [];
	const weights: number[] = [];
	for (let c = 0; c < N_CLIENTS; c++) {
		const attack = config.attacks[c] ?? HONEST;
		const local = localTrain(
			state.global,
			dataset.poolX,
			dataset.poolY,
			partition[c],
			training,
			deriveSeed(training.seed, round, c, 1),
			flipsLabels(attack),
		);
		const honestUpdate = local.map((v, k) => v - state.global[k]);
		updates.push(poisonUpdate(honestUpdate, attack, deriveSeed(training.seed, round, c, 2)));
		weights.push(partition[c].length);
	}

	const agg = aggregate(config.aggregator, updates, weights, {
		trimBeta: config.trimBeta,
		krumF: config.krumF,
	});
	const global = state.global.map((v, k) => v + agg.update[k]);
	const evaluation = evaluate(global, dataset.testX, dataset.testY);
	const pca = pca2d(updates, [agg.update], state.prevBasis);

	const clients: ClientRoundResult[] = updates.map((u, c) => ({
		id: c,
		attack: (config.attacks[c] ?? HONEST).type,
		rejected: agg.rejected[c],
		excludedFraction: agg.excludedFraction[c],
		updateNorm: norm(u),
		point: pca.points[c],
	}));

	return {
		state: { round, global, prevBasis: pca.basis },
		result: {
			round,
			accuracy: evaluation.accuracy,
			missRate: evaluation.missRate,
			aggregator: config.aggregator,
			clients,
			aggregatePoint: pca.extraPoints[0],
			explained: pca.explained,
		},
	};
}

/**
 * Centralized full-batch gradient descent, mirroring the offline Python
 * pipeline's train_logistic_regression() exactly (same init, lr, l2,
 * iteration count). Used by the TS/Python parity test.
 */
export function trainCentralized(
	X: Float64Array[],
	Y: Uint8Array,
	iterations = 3000,
	learningRate = 0.5,
	l2 = 1e-3,
): Float64Array {
	const d = X[0].length;
	const params = new Float64Array(d + 1);
	const grad = new Float64Array(d + 1);
	const n = X.length;
	for (let it = 0; it < iterations; it++) {
		grad.fill(0);
		for (let i = 0; i < n; i++) {
			const err = predictProbability(params, X[i]) - Y[i];
			for (let k = 0; k < d; k++) grad[k] += err * X[i][k];
			grad[d] += err;
		}
		for (let k = 0; k < d; k++) params[k] -= learningRate * (grad[k] / n + l2 * params[k]);
		params[d] -= learningRate * (grad[d] / n);
	}
	return params;
}
