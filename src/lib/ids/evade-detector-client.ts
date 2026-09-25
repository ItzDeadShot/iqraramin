import { FEATURES, MODEL, SAMPLES, SCALER } from './data';
import {
	applyTransform,
	computeDelta,
	computeMinimalCounterfactual,
	computeProbability,
	computeAttributions,
	describeCounterfactual,
	formatFeatureValue,
	inverseTransform,
	lockedKeysFor,
	type CounterfactualResult,
} from './detector';

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function initEvadeDetector(root: HTMLElement): void {
	const sliders = new Map<string, HTMLInputElement>();
	const valueEls = new Map<string, HTMLElement>();
	const barEls = new Map<string, HTMLElement>();

	root.querySelectorAll<HTMLInputElement>('[data-feature-key]').forEach((el) => {
		sliders.set(el.dataset.featureKey!, el);
	});
	root.querySelectorAll<HTMLElement>('[data-value-for]').forEach((el) => {
		valueEls.set(el.dataset.valueFor!, el);
	});
	root.querySelectorAll<HTMLElement>('[data-bar-for]').forEach((el) => {
		barEls.set(el.dataset.barFor!, el);
	});

	const verdictEl = root.querySelector<HTMLElement>('[data-verdict]');
	const probabilityEl = root.querySelector<HTMLElement>('[data-probability]');
	const attackTypeEl = root.querySelector<HTMLElement>('[data-attack-type]');
	const hintPanel = root.querySelector<HTMLElement>('[data-minimal-path]');
	const hintText = root.querySelector<HTMLElement>('[data-minimal-path-text]');
	const resultPanel = root.querySelector<HTMLElement>('[data-evasion-result]');
	const userDeltaEl = root.querySelector<HTMLElement>('[data-user-delta]');
	const newSampleBtn = root.querySelector<HTMLButtonElement>('[data-new-sample]');

	if (!verdictEl || !probabilityEl || !attackTypeEl || !hintPanel || !hintText || !resultPanel || !userDeltaEl) {
		return;
	}

	let sampleIndex = 0;
	let originalFeatures: Record<string, number> = {};
	let currentFeatures: Record<string, number> = {};
	let lockedKeys: Set<string> = new Set();
	let cachedCounterfactual: CounterfactualResult | null = null;

	function render(): void {
		const probability = computeProbability(currentFeatures, FEATURES, SCALER, MODEL);
		const attributions = computeAttributions(currentFeatures, FEATURES, SCALER, MODEL);
		const scaleMax = Math.max(1e-6, ...Object.values(attributions).map((v) => Math.abs(v)));

		FEATURES.forEach((spec) => {
			const raw = currentFeatures[spec.key];
			const valueEl = valueEls.get(spec.key);
			if (valueEl) valueEl.textContent = formatFeatureValue(spec, raw);

			const bar = barEls.get(spec.key);
			if (bar) {
				const frac = clamp(attributions[spec.key] / scaleMax, -1, 1);
				bar.style.setProperty('--pct', String(frac));
				bar.dataset.sign = frac >= 0 ? 'positive' : 'negative';
			}
		});

		probabilityEl!.textContent = `${(probability * 100).toFixed(1)}%`;
		const malicious = probability >= 0.5;
		verdictEl!.textContent = malicious ? 'Flagged: malicious' : 'Cleared: benign';
		verdictEl!.dataset.state = malicious ? 'malicious' : 'benign';

		hintPanel!.hidden = !malicious;
		resultPanel!.hidden = malicious;
		if (!malicious) {
			const userDelta = computeDelta(originalFeatures, currentFeatures, FEATURES, SCALER);
			userDeltaEl!.textContent =
				`You changed ${userDelta.featuresChanged} feature${userDelta.featuresChanged === 1 ? '' : 's'}, ` +
				`moving ${userDelta.distanceMoved.toFixed(2)} units in the model's standardized feature space. ` +
				describeCounterfactual(cachedCounterfactual, FEATURES, lockedKeys);
		}
	}

	function loadSample(index: number): void {
		const sample = SAMPLES[index];
		originalFeatures = { ...sample.features };
		currentFeatures = { ...sample.features };
		lockedKeys = lockedKeysFor(sample);
		cachedCounterfactual = computeMinimalCounterfactual(originalFeatures, FEATURES, SCALER, MODEL, lockedKeys);
		hintText!.textContent = describeCounterfactual(cachedCounterfactual, FEATURES, lockedKeys);

		attackTypeEl!.textContent = `${sample.attackType} (${sample.category})`;

		FEATURES.forEach((spec) => {
			const raw = sample.features[spec.key];
			const slider = sliders.get(spec.key);
			if (!slider) return;
			const isLog = spec.transform === 'log1p';
			const step = spec.unit === 'boolean' || spec.unit === 'connections' ? '1' : isLog ? 'any' : '0.01';

			slider.min = String(isLog ? applyTransform(spec.min, 'log1p') : spec.min);
			slider.max = String(isLog ? applyTransform(spec.max, 'log1p') : spec.max);
			slider.step = step;
			slider.value = String(isLog ? applyTransform(raw, 'log1p') : raw);
			slider.disabled = lockedKeys.has(spec.key);
			slider.setAttribute('aria-valuetext', formatFeatureValue(spec, raw));
		});

		render();
	}

	sliders.forEach((slider, key) => {
		slider.addEventListener('input', () => {
			const spec = FEATURES.find((f) => f.key === key)!;
			const sliderValue = Number(slider.value);
			const raw = spec.transform === 'log1p' ? inverseTransform(sliderValue, 'log1p') : sliderValue;
			currentFeatures[key] = raw;
			slider.setAttribute('aria-valuetext', formatFeatureValue(spec, raw));
			render();
		});
	});

	newSampleBtn?.addEventListener('click', () => {
		sampleIndex = (sampleIndex + 1) % SAMPLES.length;
		loadSample(sampleIndex);
	});

	// Re-derive from sample 0 rather than reading the server-rendered DOM
	// back into state: cheap, deterministic, and guarantees the client never
	// silently disagrees with what was actually rendered.
	loadSample(0);
}
