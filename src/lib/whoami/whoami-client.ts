import { collectSignals } from './collect';
import { WHOLE_FINGERPRINT_BITS, WHOLE_FINGERPRINT_ONE_IN, flowRecord, naiveBitsSum, verdict, type Signals } from './signals';

/**
 * Wires the /whoami page. Loading this module reads nothing: signals are
 * collected only inside the click handler, kept in memory, never sent or
 * stored, and wiped when the visitor presses "Forget this" or leaves.
 */
export function initWhoAmI(root: HTMLElement): void {
	const need = <T extends HTMLElement>(selector: string): T => {
		const el = root.querySelector<T>(selector);
		if (!el) throw new Error(`whoami: missing ${selector}`);
		return el;
	};
	const inspectBtn = need<HTMLButtonElement>('[data-inspect]');
	const forgetBtn = need<HTMLButtonElement>('[data-forget]');
	const status = need('[data-status]');
	const header = need('[data-record-header]');
	const exampleTag = root.querySelector<HTMLElement>('[data-example-tag]');
	const verdictEl = need('[data-verdict]');
	const verdictReasons = need('[data-verdict-reasons]');
	const estimate = need('[data-estimate]');

	const valueCells = new Map(
		Array.from(root.querySelectorAll<HTMLElement>('[data-value-for]')).map((el) => [el.dataset.valueFor!, el]),
	);
	const initial = {
		header: header.textContent ?? '',
		values: new Map([...valueCells].map(([k, el]) => [k, el.textContent ?? ''])),
		estimate: estimate.innerHTML,
	};

	function clear(message = ''): void {
		header.textContent = initial.header;
		for (const [key, el] of valueCells) {
			el.textContent = initial.values.get(key) ?? '';
			el.classList.remove('is-live');
		}
		if (exampleTag) exampleTag.hidden = false;
		verdictEl.hidden = true;
		verdictReasons.replaceChildren();
		estimate.innerHTML = initial.estimate;
		forgetBtn.hidden = true;
		inspectBtn.disabled = false;
		inspectBtn.textContent = 'Inspect my traffic';
		status.textContent = message;
	}

	function render(signals: Signals): void {
		const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
		header.textContent = `FLOW 0001  ts=${now}  src=you  dst=${location.host}  proto=${location.protocol.replace(':', '')}  verdict=BENIGN`;
		for (const row of flowRecord(signals)) {
			const cell = valueCells.get(row.signal);
			if (!cell) continue;
			cell.textContent = row.value;
			cell.classList.add('is-live');
		}
		if (exampleTag) exampleTag.hidden = true;

		const v = verdict(signals);
		verdictReasons.replaceChildren(
			...v.rationale.map((r) => {
				const li = document.createElement('li');
				li.textContent = r;
				return li;
			}),
		);
		verdictEl.hidden = false;

		const hidden = [
			signals.canvasRandomized || signals.canvasHash === null ? 'randomizes or blocks the canvas readout' : '',
			signals.cpuThreads === null ? 'hides your CPU thread count' : '',
			signals.clientHints === null ? "doesn't offer UA client hints" : '',
		].filter(Boolean);
		const p1 = document.createElement('p');
		p1.textContent =
			`Approximate, from published averages rather than a measurement of you: the per-signal figures above add up to about ` +
			`${naiveBitsSum().toFixed(1)} bits, but that overcounts, because the signals overlap (your user agent already implies much of the rest). ` +
			`Measured as a whole, a 2010 browser fingerprint carried about ${WHOLE_FINGERPRINT_BITS} bits: enough to pick one browser out of ` +
			`roughly ${WHOLE_FINGERPRINT_ONE_IN.toLocaleString('en-US')}.`;
		const p2 = document.createElement('p');
		p2.textContent = hidden.length
			? `Your browser ${hidden.join(', ')}, which makes you harder to single out than those averages suggest.`
			: 'Your browser handed over every signal on the list without resistance.';
		estimate.replaceChildren(p1, p2);
	}

	inspectBtn.addEventListener('click', async () => {
		inspectBtn.disabled = true;
		inspectBtn.textContent = 'Inspecting...';
		try {
			const signals = await collectSignals();
			render(signals);
			forgetBtn.hidden = false;
			inspectBtn.textContent = 'Inspect again';
			status.textContent = 'Inspection complete. Nine signals read, shown below. Nothing was sent or stored.';
		} catch {
			clear('Something went wrong reading the signals. Nothing was sent or stored.');
			return;
		}
		inspectBtn.disabled = false;
	});

	forgetBtn.addEventListener('click', () => {
		clear('Forgotten. The page is back to showing an example record.');
		inspectBtn.focus();
	});

	// Wipe on navigation, including when the page is kept in the
	// back/forward cache, so returning never shows old readings.
	window.addEventListener('pagehide', () => clear());
	window.addEventListener('pageshow', (evt) => {
		if (evt.persisted) clear();
	});

	root.querySelectorAll<HTMLButtonElement>('[data-requires-js]').forEach((b) => (b.disabled = false));
	status.textContent = '';
}
