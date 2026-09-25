/**
 * Markup for the federated sandbox's three visuals (client ring, PCA
 * scatter, accuracy chart) plus its plain-language status line. Pure
 * string builders, shared by the build-time static snapshot and the live
 * client so the two can never drift. Every value interpolated here is a
 * number or a fixed label from this file, never user or external input.
 */

import type { AggregatorId } from './aggregators';
import type { AttackType, ClientAttack, Distribution, RoundResult, SimConfig } from './sim';

export const MAX_ROUNDS = 60;

export const AGGREGATOR_LABELS: Record<AggregatorId, string> = {
	fedavg: 'FedAvg',
	median: 'Coordinate-wise median',
	trimmed_mean: 'Trimmed mean',
	krum: 'Multi-Krum',
};

export const AGGREGATOR_SHORT: Record<AggregatorId, string> = {
	fedavg: 'FedAvg',
	median: 'Median',
	trimmed_mean: 'Trimmed',
	krum: 'Krum',
};

export const ATTACK_LABELS: Record<AttackType, string> = {
	none: 'Honest',
	label_flip: 'Label flipping',
	boost: 'Boosted label flip',
	sign_flip: 'Sign flipping',
	noise: 'Gaussian noise',
};

export const ATTACK_SHORT: Record<AttackType, string> = {
	none: 'honest',
	label_flip: 'flip',
	boost: 'boost',
	sign_flip: 'sign',
	noise: 'noise',
};

export function attackSummary(attack: ClientAttack): string {
	switch (attack.type) {
		case 'boost':
			return `Boosted label flip, x${attack.factor}`;
		case 'sign_flip':
			return `Sign flipping, x${attack.factor}`;
		case 'noise':
			return `Gaussian noise, sigma ${attack.sigma}`;
		default:
			return ATTACK_LABELS[attack.type];
	}
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (x: number) => (Math.abs(x) < 1e-9 ? '0' : x.toFixed(2));

// ---------------------------------------------------------------- ring

export const RING = { size: 300, center: 150, radius: 118, server: 34 };

export function clientPosition(i: number, n = 8): { x: number; y: number } {
	const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
	return {
		x: RING.center + RING.radius * Math.cos(angle),
		y: RING.center + RING.radius * Math.sin(angle),
	};
}

export interface RingClient {
	malicious: boolean;
	rejected: boolean;
}

export function renderRing(
	clients: RingClient[],
	aggregator: AggregatorId,
	packets: { durationMs: number } | null,
): string {
	const { center, server } = RING;
	const links = clients
		.map((c, i) => {
			const p = clientPosition(i, clients.length);
			const cls = ['fl-link', c.malicious ? 'fl-link--malicious' : '', c.rejected ? 'fl-link--rejected' : '']
				.filter(Boolean)
				.join(' ');
			let packet = '';
			if (packets) {
				const path = `M${fmt(p.x)},${fmt(p.y)} L${center},${center}`;
				const pcls = c.malicious ? 'fl-packet fl-packet--malicious' : 'fl-packet';
				packet =
					`<circle class="${pcls}" r="3.5"><animateMotion dur="${packets.durationMs}ms" ` +
					`path="${path}" fill="freeze" /></circle>`;
			}
			const cross = c.rejected
				? (() => {
						const t = 0.42;
						const x = center + (p.x - center) * t;
						const y = center + (p.y - center) * t;
						return `<g class="fl-reject-mark" transform="translate(${fmt(x)} ${fmt(y)})"><line x1="-5" y1="-5" x2="5" y2="5"/><line x1="-5" y1="5" x2="5" y2="-5"/></g>`;
					})()
				: '';
			return `<line class="${cls}" x1="${fmt(p.x)}" y1="${fmt(p.y)}" x2="${center}" y2="${center}"/>${packet}${cross}`;
		})
		.join('');

	return (
		links +
		`<rect class="fl-server" x="${center - server}" y="${center - server}" width="${server * 2}" height="${server * 2}"/>` +
		`<text class="fl-server-label" x="${center}" y="${center - 4}">Server</text>` +
		`<text class="fl-server-agg" x="${center}" y="${center + 12}">${AGGREGATOR_SHORT[aggregator]}</text>`
	);
}

// ---------------------------------------------------------------- scatter

export const SCATTER = { width: 320, height: 240, pad: 28 };

export function scatterScale(result: RoundResult): (p: [number, number]) => { x: number; y: number } {
	const all = [...result.clients.map((c) => c.point), result.aggregatePoint];
	const extent = Math.max(1e-12, ...all.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])) * 1.15;
	const { width, height, pad } = SCATTER;
	const half = Math.min(width, height) / 2 - pad;
	return ([x, y]) => ({ x: width / 2 + (x / extent) * half, y: height / 2 - (y / extent) * half });
}

export function renderScatter(result: RoundResult | null, attacks: ClientAttack[]): string {
	const { width, height, pad } = SCATTER;
	const axes =
		`<line class="fl-axis" x1="${pad}" y1="${height / 2}" x2="${width - pad}" y2="${height / 2}"/>` +
		`<line class="fl-axis" x1="${width / 2}" y1="${pad / 2}" x2="${width / 2}" y2="${height - pad / 2}"/>`;
	if (!result) {
		return (
			axes +
			`<text class="fl-empty" x="${width / 2}" y="${height / 2 - 12}">Client updates appear here after round 1</text>`
		);
	}
	const scale = scatterScale(result);
	const [e1, e2] = result.explained;
	// Axis captions sit in the corners, outside the band points can occupy
	// (scatterScale keeps every point within `pad` of the edges), so a point
	// or its label can never land on top of them.
	const axisLabels =
		`<text class="fl-axis-label" x="${width - 2}" y="${height - 3}" text-anchor="end">horizontal: PC1, ${Math.round(e1 * 100)}% of variance</text>` +
		`<text class="fl-axis-label" x="2" y="9">vertical: PC2, ${Math.round(e2 * 100)}%</text>`;

	const agg = scale(result.aggregatePoint);
	const aggregateMark =
		`<g class="fl-point fl-point--aggregate" data-point="aggregate" transform="translate(${fmt(agg.x)} ${fmt(agg.y)})">` +
		`<rect x="-5" y="-5" width="10" height="10" transform="rotate(45)"/></g>` +
		`<text class="fl-point-label" x="${fmt(agg.x + 9)}" y="${fmt(agg.y + 14)}">aggregate</text>`;

	// Draw honest first, attackers on top.
	const order = [...result.clients].sort((a, b) => Number(attacks[a.id]?.type !== 'none') - Number(attacks[b.id]?.type !== 'none'));
	const points = order
		.map((c) => {
			const { x, y } = scale(c.point);
			const malicious = (attacks[c.id]?.type ?? 'none') !== 'none';
			const cls = ['fl-point', malicious ? 'fl-point--malicious' : 'fl-point--honest', c.rejected ? 'fl-point--rejected' : '']
				.filter(Boolean)
				.join(' ');
			const shape = malicious ? `<rect x="-5" y="-5" width="10" height="10"/>` : `<circle r="5"/>`;
			const label =
				malicious || c.rejected
					? `<text class="fl-point-label" x="${fmt(x + 9)}" y="${fmt(y - 7)}">C${c.id + 1}${c.rejected ? ' rejected' : ''}</text>`
					: '';
			return `<g class="${cls}" data-point="${c.id}" transform="translate(${fmt(x)} ${fmt(y)})">${shape}</g>${label}`;
		})
		.join('');

	// Unlabelled (honest, kept) updates often land on top of each other,
	// e.g. when one boosted attacker stretches the scale: say so instead of
	// letting 7 points silently read as 1.
	const unlabelled = result.clients.filter((c) => (attacks[c.id]?.type ?? 'none') === 'none' && !c.rejected);
	const groups: { x: number; y: number; ids: number[] }[] = [];
	for (const c of unlabelled) {
		const p = scale(c.point);
		const group = groups.find((g) => Math.hypot(g.x - p.x, g.y - p.y) < 6);
		if (group) group.ids.push(c.id);
		else groups.push({ x: p.x, y: p.y, ids: [c.id] });
	}
	const overlapLabels = groups
		.filter((g) => g.ids.length > 1)
		.map((g) => {
			// Centred above the cluster, clamped so it never runs off either edge.
			const x = Math.min(width * 0.72, Math.max(width * 0.28, g.x));
			const y = g.y - 12 < 22 ? g.y + 22 : g.y - 12;
			return `<text class="fl-point-label fl-point-label--muted" x="${fmt(x)}" y="${fmt(y)}" text-anchor="middle">${g.ids.length} honest updates overlap</text>`;
		})
		.join('');

	// Aggregate last so it's never hidden under the cluster it summarizes.
	return axes + axisLabels + points + overlapLabels + aggregateMark;
}

export function describeScatterPoint(result: RoundResult, index: number | 'aggregate', attacks: ClientAttack[]): string {
	if (index === 'aggregate') {
		return `Aggregated update (${AGGREGATOR_LABELS[result.aggregator]}), what the server actually applied this round`;
	}
	const c = result.clients[index];
	const attack = attacks[c.id] ?? { type: 'none', factor: 1, sigma: 1 };
	return `Client ${c.id + 1}, ${attackSummary(attack).toLowerCase()}. Update size ${c.updateNorm.toFixed(3)}. ${serverDecision(result, index)}`;
}

export function serverDecision(result: RoundResult, index: number): string {
	const c = result.clients[index];
	if (result.aggregator === 'krum') return c.rejected ? 'Rejected by the server.' : 'Kept.';
	if (result.aggregator === 'fedavg') return 'Averaged in.';
	const coords = Math.round(c.excludedFraction * 13);
	if (result.aggregator === 'median') return `Not at the median in ${coords} of 13 coordinates.`;
	return `${c.rejected ? 'Rejected: ' : ''}trimmed in ${coords} of 13 coordinates.`;
}

// ---------------------------------------------------------------- chart

export const CHART = { width: 360, height: 210, left: 34, right: 70, top: 26, bottom: 26 };

export interface HistoryPoint {
	round: number;
	accuracy: number;
	missRate: number;
}

export interface ChartEvent {
	round: number;
	label: string;
}

export function chartX(round: number): number {
	const { width, left, right } = CHART;
	return left + (round / MAX_ROUNDS) * (width - left - right);
}

export function chartY(value: number): number {
	const { height, top, bottom } = CHART;
	return top + (1 - value) * (height - top - bottom);
}

export function renderChart(history: HistoryPoint[], events: ChartEvent[]): string {
	const { width, height, left, right, bottom } = CHART;
	const grid = [0, 0.25, 0.5, 0.75, 1]
		.map(
			(v) =>
				`<line class="fl-grid" x1="${left}" y1="${fmt(chartY(v))}" x2="${width - right}" y2="${fmt(chartY(v))}"/>` +
				`<text class="fl-tick" x="${left - 6}" y="${fmt(chartY(v) + 3.5)}" text-anchor="end">${v * 100}%</text>`,
		)
		.join('');
	const xTicks = [0, 10, 20, 30, 40, 50, 60]
		.map((r) => `<text class="fl-tick" x="${fmt(chartX(r))}" y="${height - bottom + 14}" text-anchor="middle">${r}</text>`)
		.join('');
	const xLabel = `<text class="fl-tick" x="${width - right}" y="${height - 2}" text-anchor="end">round</text>`;

	const markers = events
		.map((e, i) => {
			const x = chartX(e.round);
			const y = 10 + (i % 2) * 10;
			return (
				`<line class="fl-event" x1="${fmt(x)}" y1="${y + 2}" x2="${fmt(x)}" y2="${fmt(chartY(0))}"/>` +
				`<text class="fl-event-label" x="${fmt(x + 3)}" y="${y + 4}">${e.label}</text>`
			);
		})
		.join('');

	let series = '';
	if (history.length > 0) {
		const line = (key: 'accuracy' | 'missRate') =>
			history.map((h, i) => `${i === 0 ? 'M' : 'L'}${fmt(chartX(h.round))},${fmt(chartY(h[key]))}`).join(' ');
		const last = history[history.length - 1];
		const accY = chartY(last.accuracy);
		const missY = chartY(last.missRate);
		// Keep the two end labels from colliding when the lines converge.
		let accLabelY = accY + 4;
		let missLabelY = missY + 4;
		if (Math.abs(accLabelY - missLabelY) < 12) {
			if (accLabelY <= missLabelY) missLabelY = accLabelY + 12;
			else accLabelY = missLabelY + 12;
		}
		const endX = chartX(last.round);
		series =
			`<path class="fl-line fl-line--miss" d="${line('missRate')}"/>` +
			`<path class="fl-line fl-line--accuracy" d="${line('accuracy')}"/>` +
			`<circle class="fl-end fl-end--miss" cx="${fmt(endX)}" cy="${fmt(missY)}" r="4"/>` +
			`<circle class="fl-end fl-end--accuracy" cx="${fmt(endX)}" cy="${fmt(accY)}" r="4"/>` +
			`<text class="fl-end-label" x="${fmt(endX + 8)}" y="${fmt(accLabelY)}">${pct(last.accuracy)}</text>` +
			`<text class="fl-end-label fl-end-label--muted" x="${fmt(endX + 8)}" y="${fmt(missLabelY)}">${pct(last.missRate)}</text>`;
	}

	return grid + xTicks + xLabel + markers + series + `<g class="fl-crosshair" data-crosshair></g>`;
}

export function renderCrosshair(point: HistoryPoint): string {
	const x = chartX(point.round);
	return (
		`<line class="fl-crosshair-line" x1="${fmt(x)}" y1="${fmt(chartY(1))}" x2="${fmt(x)}" y2="${fmt(chartY(0))}"/>` +
		`<circle class="fl-end fl-end--miss" cx="${fmt(x)}" cy="${fmt(chartY(point.missRate))}" r="4"/>` +
		`<circle class="fl-end fl-end--accuracy" cx="${fmt(x)}" cy="${fmt(chartY(point.accuracy))}" r="4"/>`
	);
}

// ---------------------------------------------------------------- status

function listClients(ids: number[]): string {
	const names = ids.map((i) => `${i + 1}`);
	if (names.length === 1) return `client ${names[0]}`;
	return `clients ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One plain-language sentence about what the server just did. Built only
 * from computed results; nothing here is scripted per scenario. */
export function describeRound(result: RoundResult, previous: HistoryPoint | null, attacks: ClientAttack[]): string {
	const attackers = attacks.map((a, i) => (a.type !== 'none' ? i : -1)).filter((i) => i >= 0);
	const rejected = result.clients.filter((c) => c.rejected).map((c) => c.id);
	const rejectedHonest = rejected.filter((i) => !attackers.includes(i));
	const missedAttackers = attackers.filter((i) => !rejected.includes(i));
	const name = AGGREGATOR_LABELS[result.aggregator];

	let action: string;
	if (result.aggregator === 'fedavg') {
		action =
			attackers.length > 0
				? `FedAvg averaged all 8 updates, including ${listClients(attackers)}'s poisoned ${attackers.length === 1 ? 'one' : 'ones'}`
				: 'FedAvg averaged all 8 updates';
	} else if (result.aggregator === 'median') {
		action = `the coordinate-wise median ignored outlying values${attackers.length ? ` from ${listClients(attackers)}` : ''}`;
	} else if (rejected.length === 0) {
		action = `${name} kept every update`;
	} else {
		action = `${name} rejected ${listClients(rejected)}`;
		if (rejectedHonest.length > 0 && rejectedHonest.length === rejected.length) action += ' (honest)';
		else if (rejectedHonest.length > 0) action += ` (${listClients(rejectedHonest)} honest)`;
		if (missedAttackers.length > 0) action += ` but let ${listClients(missedAttackers)} through`;
	}

	let change = '';
	if (previous) {
		const delta = (result.accuracy - previous.accuracy) * 100;
		if (Math.abs(delta) >= 0.05) change = `, ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} points`;
	}
	return `Round ${result.round}: ${action}; accuracy ${pct(result.accuracy)}${change}; ${pct(result.missRate)} of attacks missed.`;
}

export function configEventLabel(before: SimConfig, after: SimConfig): string | null {
	const parts: string[] = [];
	if (before.aggregator !== after.aggregator) parts.push(AGGREGATOR_SHORT[after.aggregator]);
	if (before.distribution !== after.distribution) parts.push(after.distribution === 'iid' ? 'IID' : 'non-IID');
	after.attacks.forEach((a, i) => {
		const b = before.attacks[i];
		if (a.type !== b.type) parts.push(a.type === 'none' ? `C${i + 1} honest` : `C${i + 1} ${ATTACK_SHORT[a.type]}`);
	});
	return parts.length ? parts.join(', ') : null;
}

export function distributionLabel(d: Distribution): string {
	return d === 'iid' ? 'IID' : 'Non-IID (by attack type)';
}
