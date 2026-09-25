import type { AggregatorId } from './aggregators';
import {
	ATTACK_LABELS,
	ATTACK_SHORT,
	CHART,
	MAX_ROUNDS,
	SCATTER,
	attackSummary,
	chartX,
	configEventLabel,
	describeRound,
	describeScatterPoint,
	renderChart,
	renderCrosshair,
	renderRing,
	renderScatter,
	scatterScale,
	serverDecision,
	type ChartEvent,
	type HistoryPoint,
} from './render';
import { HONEST, defaultConfig, type AttackType, type ClientAttack, type Distribution, type RoundResult, type SimConfig } from './sim';
import type { WorkerRequest, WorkerResponse } from './worker';

const SPEEDS: Record<string, number> = { slow: 1000, normal: 400, fast: 150 };
const DEFAULT_ATTACK: ClientAttack = { type: 'boost', factor: 10, sigma: 1 };
const FACTORS = [2, 5, 10, 20];
const SIGMAS = [0.5, 1, 2];

function cloneConfig(c: SimConfig): SimConfig {
	return { ...c, attacks: c.attacks.map((a) => ({ ...a })) };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, text?: string) {
	const node = document.createElement(tag);
	Object.assign(node, props);
	if (text !== undefined) node.textContent = text;
	return node;
}

export function initFederatedSandbox(root: HTMLElement): void {
	const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
	const ringSvg = q<SVGSVGElement>('[data-ring]');
	const scatterSvg = q<SVGSVGElement>('[data-scatter]');
	const chartSvg = q<SVGSVGElement>('[data-chart]');
	const scatterTip = q('[data-scatter-tip]');
	const chartTip = q('[data-chart-tip]');
	const statusEl = q('[data-status]');
	const roundEl = q('[data-round]');
	const snapshotNote = q('[data-snapshot-note]');
	const playBtn = q<HTMLButtonElement>('[data-play]');
	const stepBtn = q<HTMLButtonElement>('[data-step]');
	const resetBtn = q<HTMLButtonElement>('[data-reset]');
	const speedSel = q<HTMLSelectElement>('[data-speed]');
	const aggSel = q<HTMLSelectElement>('[data-aggregator]');
	const trimField = q('[data-trim-field]');
	const trimSel = q<HTMLSelectElement>('[data-trim-beta]');
	const krumField = q('[data-krum-field]');
	const krumSel = q<HTMLSelectElement>('[data-krum-f]');
	const attackersList = q('[data-attackers]');
	const clientTable = q('[data-client-table]');
	const historyTable = q('[data-history-table]');
	const clientButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-client]'));
	const distRadios = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="fl-distribution"]'));

	if (!ringSvg || !scatterSvg || !chartSvg || !statusEl || !playBtn || !stepBtn || !resetBtn || !aggSel || !attackersList) {
		return;
	}

	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const config = defaultConfig();
	let history: HistoryPoint[] = [];
	let events: ChartEvent[] = [];
	let lastResult: RoundResult | null = null;
	let playing = false;
	let pending = false;
	let timer: number | undefined;
	let crosshairIndex: number | null = null;
	let scatterIndex: number | null = null;

	const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
	const send = (msg: WorkerRequest) => worker.postMessage(msg);

	const interval = () => SPEEDS[speedSel?.value ?? 'normal'] ?? 400;
	const currentRound = () => lastResult?.round ?? 0;

	// ------------------------------------------------------------ rendering

	function renderRingNow(animate: boolean): void {
		const clients = config.attacks.map((a, i) => ({
			malicious: a.type !== 'none',
			rejected: lastResult?.clients[i]?.rejected ?? false,
		}));
		const packets = animate && !reducedMotion ? { durationMs: Math.min(600, interval() * 0.8) } : null;
		ringSvg!.innerHTML = renderRing(clients, config.aggregator, packets);

		clientButtons.forEach((btn) => {
			const i = Number(btn.dataset.client);
			const attack = config.attacks[i];
			const malicious = attack.type !== 'none';
			const rejected = lastResult?.clients[i]?.rejected ?? false;
			btn.setAttribute('aria-pressed', String(malicious));
			btn.dataset.malicious = String(malicious);
			btn.dataset.rejected = String(rejected);
			// The accessible name starts with the visible text ("C4 boost
			// rejected") so voice-control users can say what they see.
			const visible = `C${i + 1} ${ATTACK_SHORT[attack.type]}${rejected ? ' rejected' : ''}`;
			btn.setAttribute(
				'aria-label',
				`${visible}. Client ${i + 1} is ${malicious ? `sending ${attackSummary(attack).toLowerCase()}` : 'honest'}` +
					`${rejected ? ' and was rejected last round' : ''}; press to make it ${malicious ? 'honest' : 'malicious'}.`,
			);
			const sub = btn.querySelector('[data-client-sub]');
			if (sub) sub.textContent = ATTACK_SHORT[attack.type];
			const tag = btn.querySelector<HTMLElement>('[data-client-tag]');
			if (tag) tag.hidden = !rejected;
		});
	}

	function renderScatterNow(): void {
		scatterSvg!.innerHTML = renderScatter(lastResult, config.attacks);
		const summary = lastResult
			? `Projection of round ${lastResult.round} client updates. ` +
				lastResult.clients.map((c) => `Client ${c.id + 1}: ${serverDecision(lastResult!, c.id)}`).join(' ')
			: 'No client updates yet.';
		scatterSvg!.setAttribute('aria-label', summary);
		if (scatterIndex !== null) showScatterTip(scatterIndex);
	}

	function renderChartNow(): void {
		chartSvg!.innerHTML = renderChart(history, events);
		const last = history[history.length - 1];
		chartSvg!.setAttribute(
			'aria-label',
			last
				? `Test accuracy and missed-attack rate by round. Round ${last.round}: accuracy ${(last.accuracy * 100).toFixed(1)}%, ${(last.missRate * 100).toFixed(1)}% of attacks missed. Use left and right arrow keys to read earlier rounds.`
				: 'Test accuracy by round; no rounds yet.',
		);
		if (crosshairIndex !== null) showCrosshair(Math.min(crosshairIndex, history.length - 1));
	}

	function renderTables(): void {
		if (clientTable) {
			clientTable.replaceChildren(
				...config.attacks.map((attack, i) => {
					const c = lastResult?.clients[i];
					const tr = el('tr');
					tr.append(
						el('td', {}, `Client ${i + 1}`),
						el('td', {}, attackSummary(attack)),
						el('td', { className: 'num' }, c ? c.updateNorm.toFixed(3) : '-'),
						el('td', {}, lastResult ? serverDecision(lastResult, i) : '-'),
					);
					return tr;
				}),
			);
		}
		if (historyTable) {
			historyTable.replaceChildren(
				...history.map((h) => {
					const tr = el('tr');
					tr.append(
						el('td', { className: 'num' }, String(h.round)),
						el('td', { className: 'num' }, `${(h.accuracy * 100).toFixed(1)}%`),
						el('td', { className: 'num' }, `${(h.missRate * 100).toFixed(1)}%`),
					);
					return tr;
				}),
			);
		}
	}

	function renderAttackers(): void {
		const focused = document.activeElement as HTMLElement | null;
		const focusKey = focused && attackersList!.contains(focused) ? focused.dataset.focusKey : undefined;

		const rows = config.attacks
			.map((attack, i) => ({ attack, i }))
			.filter(({ attack }) => attack.type !== 'none')
			.map(({ attack, i }) => {
				const li = el('li', { className: 'attacker' });
				li.append(el('span', { className: 'mono attacker-name' }, `Client ${i + 1}`));

				const typeLabel = el('label', { className: 'attacker-field' });
				typeLabel.append(el('span', { className: 'visually-hidden' }, `Client ${i + 1} attack`));
				const typeSel = el('select');
				typeSel.dataset.focusKey = `type-${i}`;
				(['label_flip', 'boost', 'sign_flip', 'noise'] as AttackType[]).forEach((t) =>
					typeSel.append(el('option', { value: t, selected: t === attack.type }, ATTACK_LABELS[t])),
				);
				typeSel.addEventListener('change', () =>
					changeConfig((c) => (c.attacks[i] = { ...c.attacks[i], type: typeSel.value as AttackType })),
				);
				typeLabel.append(typeSel);
				li.append(typeLabel);

				if (attack.type === 'boost' || attack.type === 'sign_flip' || attack.type === 'noise') {
					const paramLabel = el('label', { className: 'attacker-field' });
					const isNoise = attack.type === 'noise';
					paramLabel.append(el('span', { className: 'mono attacker-param' }, isNoise ? 'sigma' : 'scale'));
					const paramSel = el('select');
					paramSel.dataset.focusKey = `param-${i}`;
					(isNoise ? SIGMAS : FACTORS).forEach((v) =>
						paramSel.append(
							el('option', { value: String(v), selected: v === (isNoise ? attack.sigma : attack.factor) }, isNoise ? String(v) : `x${v}`),
						),
					);
					paramSel.addEventListener('change', () =>
						changeConfig((c) => {
							const value = Number(paramSel.value);
							c.attacks[i] = isNoise ? { ...c.attacks[i], sigma: value } : { ...c.attacks[i], factor: value };
						}),
					);
					paramLabel.append(paramSel);
					li.append(paramLabel);
				}

				const honestBtn = el('button', { type: 'button', className: 'small-btn' }, 'Make honest');
				honestBtn.dataset.focusKey = `honest-${i}`;
				honestBtn.addEventListener('click', () => {
					changeConfig((c) => (c.attacks[i] = { ...HONEST }));
					clientButtons[i]?.focus();
				});
				li.append(honestBtn);
				return li;
			});

		attackersList!.replaceChildren(
			...(rows.length
				? rows
				: [el('li', { className: 'attacker attacker--empty' }, 'No attackers. Select a client on the ring to make it malicious.')]),
		);

		if (focusKey) attackersList!.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
	}

	function renderControls(): void {
		playBtn!.textContent = playing ? 'Pause' : currentRound() >= MAX_ROUNDS ? 'Done' : 'Play';
		playBtn!.setAttribute('aria-pressed', String(playing));
		playBtn!.disabled = currentRound() >= MAX_ROUNDS;
		stepBtn!.disabled = playing || currentRound() >= MAX_ROUNDS;
		aggSel!.value = config.aggregator;
		if (trimField) trimField.hidden = config.aggregator !== 'trimmed_mean';
		if (krumField) krumField.hidden = config.aggregator !== 'krum';
		if (trimSel) trimSel.value = String(config.trimBeta);
		if (krumSel) krumSel.value = String(config.krumF);
		distRadios.forEach((r) => (r.checked = r.value === config.distribution));
		if (roundEl) roundEl.textContent = `Round ${currentRound()} of ${MAX_ROUNDS}`;
	}

	function renderAll(animate = false): void {
		renderRingNow(animate);
		renderScatterNow();
		renderChartNow();
		renderTables();
		renderControls();
	}

	// ------------------------------------------------------------ config

	function changeConfig(mutate: (c: SimConfig) => void): void {
		const before = cloneConfig(config);
		mutate(config);
		const label = configEventLabel(before, config);
		if (label && history.length > 0) {
			const round = currentRound();
			const existing = events.find((e) => e.round === round);
			if (existing) existing.label = `${existing.label}, ${label}`;
			else events.push({ round, label });
		}
		send({ type: 'config', config: cloneConfig(config) });
		renderAttackers();
		renderAll();
	}

	function toggleClient(i: number): void {
		const wasMalicious = config.attacks[i].type !== 'none';
		changeConfig((c) => (c.attacks[i] = wasMalicious ? { ...HONEST } : { ...DEFAULT_ATTACK }));
		statusEl!.textContent = wasMalicious
			? `Client ${i + 1} is honest again, from the next round.`
			: `Client ${i + 1} is now malicious (${attackSummary(DEFAULT_ATTACK).toLowerCase()}) from the next round. Its settings are in the attackers list.`;
	}

	// ------------------------------------------------------------ loop

	function schedule(): void {
		window.clearTimeout(timer);
		if (!playing) return;
		timer = window.setTimeout(step, interval());
	}

	function step(): void {
		if (pending || currentRound() >= MAX_ROUNDS) return;
		if (document.visibilityState === 'hidden') {
			schedule();
			return;
		}
		pending = true;
		send({ type: 'step' });
	}

	function setPlaying(next: boolean): void {
		playing = next && currentRound() < MAX_ROUNDS;
		renderControls();
		if (playing) step();
		else window.clearTimeout(timer);
	}

	worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
		const msg = event.data;
		if (msg.type === 'reset') {
			history = [{ round: 0, accuracy: msg.accuracy, missRate: msg.missRate }];
			events = [];
			lastResult = null;
			crosshairIndex = null;
			scatterIndex = null;
			statusEl!.textContent = `Round 0: untrained global model (seeded random weights), accuracy ${(msg.accuracy * 100).toFixed(1)}%. ${reducedMotion ? 'Use Step to run one round at a time.' : ''}`.trim();
			renderAll();
			return;
		}
		pending = false;
		const previous = history[history.length - 1] ?? null;
		lastResult = msg.result;
		history.push({ round: msg.result.round, accuracy: msg.result.accuracy, missRate: msg.result.missRate });
		statusEl!.textContent = describeRound(msg.result, previous, config.attacks);
		if (msg.result.round >= MAX_ROUNDS) {
			playing = false;
			statusEl!.textContent += ` Reached ${MAX_ROUNDS} rounds; Reset to run again.`;
		}
		renderAll(true);
		schedule();
	};

	// ------------------------------------------------------------ tooltips

	function toSvgPoint(svg: SVGSVGElement, evt: PointerEvent, width: number, height: number) {
		const rect = svg.getBoundingClientRect();
		return { x: ((evt.clientX - rect.left) / rect.width) * width, y: ((evt.clientY - rect.top) / rect.height) * height };
	}

	function placeTip(tip: HTMLElement, svg: SVGSVGElement, x: number, y: number, width: number, height: number) {
		const rect = svg.getBoundingClientRect();
		const px = (x / width) * rect.width;
		const py = (y / height) * rect.height;
		tip.style.left = `${px}px`;
		tip.style.top = `${py}px`;
		tip.dataset.side = px > rect.width * 0.6 ? 'left' : 'right';
		tip.hidden = false;
	}

	function showCrosshair(index: number): void {
		const point = history[index];
		if (!point || !chartTip) return;
		crosshairIndex = index;
		const layer = chartSvg!.querySelector('[data-crosshair]');
		if (layer) layer.innerHTML = renderCrosshair(point);
		chartTip.replaceChildren(
			el('strong', {}, `${(point.accuracy * 100).toFixed(1)}%`),
			el('span', {}, ' accuracy'),
			el('br'),
			el('strong', {}, `${(point.missRate * 100).toFixed(1)}%`),
			el('span', {}, ' attacks missed'),
			el('br'),
			el('span', { className: 'tip-muted' }, `round ${point.round}`),
		);
		placeTip(chartTip, chartSvg!, chartX(point.round), CHART.top, CHART.width, CHART.height);
	}

	function hideCrosshair(): void {
		crosshairIndex = null;
		const layer = chartSvg!.querySelector('[data-crosshair]');
		if (layer) layer.innerHTML = '';
		if (chartTip) chartTip.hidden = true;
	}

	chartSvg.addEventListener('pointermove', (evt) => {
		if (history.length === 0) return;
		const { x } = toSvgPoint(chartSvg, evt, CHART.width, CHART.height);
		let best = 0;
		history.forEach((h, i) => {
			if (Math.abs(chartX(h.round) - x) < Math.abs(chartX(history[best].round) - x)) best = i;
		});
		showCrosshair(best);
	});
	chartSvg.addEventListener('pointerleave', hideCrosshair);
	chartSvg.addEventListener('focus', () => history.length && showCrosshair(history.length - 1));
	chartSvg.addEventListener('blur', hideCrosshair);
	chartSvg.addEventListener('keydown', (evt) => {
		if (history.length === 0) return;
		const i = crosshairIndex ?? history.length - 1;
		const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: history.length - 1 }[evt.key];
		if (next === undefined) return;
		evt.preventDefault();
		showCrosshair(Math.max(0, Math.min(history.length - 1, next)));
	});

	const scatterTargets = () => (lastResult ? [...lastResult.clients.map((c) => c.id), -1] : []);

	function showScatterTip(index: number): void {
		if (!lastResult || !scatterTip) return;
		scatterIndex = index;
		const scale = scatterScale(lastResult);
		const point = index === -1 ? lastResult.aggregatePoint : lastResult.clients[index].point;
		const { x, y } = scale(point);
		scatterSvg!.querySelectorAll('.fl-point').forEach((p) => p.classList.remove('fl-point--active'));
		scatterSvg!.querySelector(`[data-point="${index === -1 ? 'aggregate' : index}"]`)?.classList.add('fl-point--active');
		scatterTip.textContent = describeScatterPoint(lastResult, index === -1 ? 'aggregate' : index, config.attacks);
		placeTip(scatterTip, scatterSvg!, x, y, SCATTER.width, SCATTER.height);
	}

	function hideScatterTip(): void {
		scatterIndex = null;
		scatterSvg!.querySelectorAll('.fl-point').forEach((p) => p.classList.remove('fl-point--active'));
		if (scatterTip) scatterTip.hidden = true;
	}

	scatterSvg.addEventListener('pointermove', (evt) => {
		if (!lastResult) return;
		const { x, y } = toSvgPoint(scatterSvg, evt, SCATTER.width, SCATTER.height);
		const scale = scatterScale(lastResult);
		let best: number | null = null;
		let bestDist = 16; // svg units: hit radius comfortably larger than the 10px mark
		for (const idx of scatterTargets()) {
			const p = scale(idx === -1 ? lastResult.aggregatePoint : lastResult.clients[idx].point);
			const d = Math.hypot(p.x - x, p.y - y);
			if (d < bestDist) {
				bestDist = d;
				best = idx;
			}
		}
		if (best === null) hideScatterTip();
		else showScatterTip(best);
	});
	scatterSvg.addEventListener('pointerleave', hideScatterTip);
	scatterSvg.addEventListener('blur', hideScatterTip);
	scatterSvg.addEventListener('focus', () => lastResult && showScatterTip(0));
	scatterSvg.addEventListener('keydown', (evt) => {
		const targets = scatterTargets();
		if (!targets.length) return;
		const pos = Math.max(0, targets.indexOf(scatterIndex ?? targets[0]));
		const next = { ArrowRight: pos + 1, ArrowDown: pos + 1, ArrowLeft: pos - 1, ArrowUp: pos - 1 }[evt.key];
		if (next === undefined) return;
		evt.preventDefault();
		showScatterTip(targets[(next + targets.length) % targets.length]);
	});

	// ------------------------------------------------------------ wiring

	clientButtons.forEach((btn) => btn.addEventListener('click', () => toggleClient(Number(btn.dataset.client))));
	playBtn.addEventListener('click', () => setPlaying(!playing));
	stepBtn.addEventListener('click', () => step());
	resetBtn.addEventListener('click', () => {
		setPlaying(false);
		pending = false;
		send({ type: 'reset' });
	});
	speedSel?.addEventListener('change', () => schedule());
	aggSel.addEventListener('change', () => changeConfig((c) => (c.aggregator = aggSel.value as AggregatorId)));
	trimSel?.addEventListener('change', () => changeConfig((c) => (c.trimBeta = Number(trimSel.value))));
	krumSel?.addEventListener('change', () => changeConfig((c) => (c.krumF = Number(krumSel.value))));
	distRadios.forEach((r) =>
		r.addEventListener('change', () => r.checked && changeConfig((c) => (c.distribution = r.value as Distribution))),
	);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && playing) schedule();
	});

	// Live mode replaces the build-time snapshot and starts from round 0.
	root
		.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('[data-requires-js]')
		.forEach((control) => (control.disabled = false));
	// Swap the note's text rather than hiding it, so hydration doesn't shift
	// everything below it (it was the page's main layout shift).
	if (snapshotNote) {
		snapshotNote.textContent =
			'Running live in your browser: a Web Worker trains every client each round. Reset replays from round 0 with the same seed, so the same actions give the same numbers.';
	}
	root.dataset.live = 'true';
	renderAttackers();
	send({ type: 'init', config: cloneConfig(config) });
	if (!reducedMotion) setPlaying(true);
	else renderControls();

}
