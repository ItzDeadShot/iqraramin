import { describe, expect, it } from 'vitest';
import MODEL from '../../content/data/ids/model.json';
import { loadDataset } from './data';
import {
	DEFAULT_TRAINING,
	defaultConfig,
	evaluate,
	initialState,
	localTrain,
	poisonUpdate,
	runRound,
	trainCentralized,
	type RoundResult,
	type SimConfig,
	type SimState,
} from './sim';

const dataset = loadDataset();

function runRounds(
	config: SimConfig,
	rounds: number,
	start: SimState = initialState(dataset),
): { state: SimState; results: RoundResult[] } {
	let state = start;
	const results: RoundResult[] = [];
	for (let r = 0; r < rounds; r++) {
		const out = runRound(state, dataset, config);
		state = out.state;
		results.push(out.result);
	}
	return { state, results };
}

const boostedClient4 = (config: SimConfig): SimConfig => {
	config.attacks[3] = { type: 'boost', factor: 10, sigma: 1 };
	return config;
};

describe('TS/Python parity', () => {
	it('centralized TS training lands within a few points of the offline Python model', () => {
		// Same algorithm, init, learning rate, L2 and iteration count as
		// scripts/prepare_ids_dataset.py; the only difference is that the TS
		// side reads raw features rounded to 3 decimals from the JSON.
		const params = trainCentralized(dataset.poolX, dataset.poolY);
		const { accuracy } = evaluate(params, dataset.testX, dataset.testY);
		expect(Math.abs(accuracy - MODEL.testAccuracy)).toBeLessThan(0.03);
	});
});

describe('local training', () => {
	it('is deterministic for a given seed', () => {
		const start = initialState(dataset).global;
		const idx = dataset.partitions.iid[0];
		const a = localTrain(start, dataset.poolX, dataset.poolY, idx, DEFAULT_TRAINING, 99);
		const b = localTrain(start, dataset.poolX, dataset.poolY, idx, DEFAULT_TRAINING, 99);
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it('improves test accuracy over the untrained start', () => {
		const start = initialState(dataset).global;
		const trained = localTrain(start, dataset.poolX, dataset.poolY, dataset.partitions.iid[0], {
			...DEFAULT_TRAINING,
			localEpochs: 5,
		}, 1);
		expect(evaluate(trained, dataset.testX, dataset.testY).accuracy).toBeGreaterThan(
			evaluate(start, dataset.testX, dataset.testY).accuracy,
		);
	});
});

describe('poisonUpdate', () => {
	const u = Float64Array.from([1, -2, 0.5]);
	it('boost scales by the factor', () => {
		expect(Array.from(poisonUpdate(u, { type: 'boost', factor: 10, sigma: 1 }, 0))).toEqual([10, -20, 5]);
	});
	it('sign flip negates and scales', () => {
		expect(Array.from(poisonUpdate(u, { type: 'sign_flip', factor: 2, sigma: 1 }, 0))).toEqual([-2, 4, -1]);
	});
	it('noise is seeded', () => {
		const a = poisonUpdate(u, { type: 'noise', factor: 1, sigma: 1 }, 5);
		const b = poisonUpdate(u, { type: 'noise', factor: 1, sigma: 1 }, 5);
		expect(Array.from(a)).toEqual(Array.from(b));
		expect(Array.from(a)).not.toEqual(Array.from(u));
	});
});

describe('acceptance criteria', () => {
	it('honest FedAvg converges within ~20 rounds', () => {
		const start = evaluate(initialState(dataset).global, dataset.testX, dataset.testY).accuracy;
		const { results } = runRounds(defaultConfig(), 20);
		expect(start).toBeLessThan(0.6);
		expect(results[19].accuracy).toBeGreaterThan(0.78);
	});

	it('is reproducible: the same config replays to identical numbers', () => {
		const a = runRounds(boostedClient4(defaultConfig()), 10).results.map((r) => r.accuracy);
		const b = runRounds(boostedClient4(defaultConfig()), 10).results.map((r) => r.accuracy);
		expect(a).toEqual(b);
	});

	it('one boosted client visibly degrades FedAvg', () => {
		const honest = runRounds(defaultConfig(), 20).results[19];
		const attacked = runRounds(boostedClient4(defaultConfig()), 20).results[19];
		expect(attacked.accuracy).toBeLessThan(honest.accuracy - 0.1);
		expect(attacked.missRate).toBeGreaterThan(honest.missRate + 0.3);
	});

	for (const recovery of ['krum', 'median'] as const) {
		it(`switching to ${recovery} mid-run recovers it`, () => {
			const config = boostedClient4(defaultConfig());
			const degraded = runRounds(config, 20);
			config.aggregator = recovery;
			const recovered = runRounds(config, 15, degraded.state);
			const final = recovered.results[14];
			expect(final.accuracy).toBeGreaterThan(degraded.results[19].accuracy + 0.1);
			expect(final.accuracy).toBeGreaterThan(0.76);
		});
	}

	it('Multi-Krum rejects the attacker in every round', () => {
		const config = boostedClient4(defaultConfig());
		config.aggregator = 'krum';
		const { results } = runRounds(config, 15);
		for (const r of results) expect(r.clients[3].rejected).toBe(true);
	});

	it('trimmed mean rejects the attacker under non-IID data too', () => {
		const config = boostedClient4(defaultConfig());
		config.aggregator = 'trimmed_mean';
		config.distribution = 'non_iid';
		const { results } = runRounds(config, 10);
		for (const r of results) expect(r.clients[3].rejected).toBe(true);
	});
});
