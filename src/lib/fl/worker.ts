/// <reference lib="webworker" />
import { loadDataset } from './data';
import { defaultConfig, evaluate, initialState, runRound, type SimConfig, type SimState } from './sim';

export type WorkerRequest =
	| { type: 'init'; config: SimConfig }
	| { type: 'config'; config: SimConfig }
	| { type: 'step' }
	| { type: 'reset' };

export type WorkerResponse =
	| { type: 'reset'; accuracy: number; missRate: number }
	| { type: 'round'; result: import('./sim').RoundResult };

const dataset = loadDataset();
let config: SimConfig = defaultConfig();
let state: SimState = initialState(dataset);

function postReset(): void {
	state = initialState(dataset);
	const { accuracy, missRate } = evaluate(state.global, dataset.testX, dataset.testY);
	self.postMessage({ type: 'reset', accuracy, missRate } satisfies WorkerResponse);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const msg = event.data;
	switch (msg.type) {
		case 'init':
			config = msg.config;
			postReset();
			break;
		case 'config':
			config = msg.config;
			break;
		case 'reset':
			postReset();
			break;
		case 'step': {
			const out = runRound(state, dataset, config);
			state = out.state;
			self.postMessage({ type: 'round', result: out.result } satisfies WorkerResponse);
			break;
		}
	}
};
