interface Selection {
	start: number;
	/** Exclusive. */
	end: number;
	fields: HTMLElement[];
	label: string;
}

/**
 * Maps payload bytes to UTF-16 positions in the payload text (the bio
 * paragraphs joined by a blank line), so a byte under the pointer can be
 * turned into the word it belongs to and highlighted in the bio itself.
 */
function payloadIndex(paragraphs: string[]) {
	const text = paragraphs.join('\n\n');
	const encoder = new TextEncoder();
	const byteToUnit: number[] = [];
	const unitToByte: number[] = [];
	let unit = 0;
	for (const ch of text) {
		const byteLength = encoder.encode(ch).length;
		unitToByte[unit] = byteToUnit.length;
		for (let b = 0; b < byteLength; b++) byteToUnit.push(unit);
		unit += ch.length;
	}
	unitToByte[text.length] = byteToUnit.length;
	for (let u = text.length - 1; u >= 0; u--) if (unitToByte[u] === undefined) unitToByte[u] = unitToByte[u + 1];
	return { text, byteToUnit, unitToByte };
}

export function initDissector(root: HTMLElement, bioRoot: HTMLElement | null): void {
	const payloadOffset = Number(root.dataset.payloadOffset);
	const fields = Array.from(root.querySelectorAll<HTMLElement>('.pd-tree [data-start]'));
	const hex = root.querySelector<HTMLElement>('[data-hex]');
	const readout = root.querySelector<HTMLElement>('[data-readout]');
	if (!hex) return;

	const cellsByByte = new Map<number, HTMLElement[]>();
	hex.querySelectorAll<HTMLElement>('[data-i]').forEach((cell) => {
		const i = Number(cell.dataset.i);
		cellsByByte.set(i, [...(cellsByByte.get(i) ?? []), cell]);
	});
	const frameLength = cellsByByte.size;
	const range = (el: HTMLElement) => ({ start: Number(el.dataset.start), end: Number(el.dataset.end) });
	const labelOf = (el: HTMLElement) =>
		(el.tagName === 'SUMMARY' ? el : el.firstChild)?.textContent?.trim().replace(/\s+/g, ' ') ?? '';

	const paragraphEls = bioRoot ? Array.from(bioRoot.querySelectorAll<HTMLElement>('[data-bio-paragraph]')) : [];
	const index = payloadIndex(paragraphEls.map((p) => p.textContent ?? ''));
	// Only map bytes onto the bio if the page's text is exactly what was
	// encoded into the frame; otherwise words would light up in the wrong place.
	const textMatchesPayload = new TextEncoder().encode(index.text).length === frameLength - payloadOffset;
	const canHighlight =
		textMatchesPayload && typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

	let pinned: Selection | null = null;
	let hovered: Selection | null = null;
	let lit: HTMLElement[] = [];

	/** The narrowest tree rows containing byte i (e.g. Version and Header
	 * Length share byte 14, so both light up). */
	function fieldsAt(i: number): HTMLElement[] {
		let best = Infinity;
		let found: HTMLElement[] = [];
		for (const el of fields) {
			const { start, end } = range(el);
			if (i < start || i >= end) continue;
			const width = end - start;
			if (width < best) {
				best = width;
				found = [el];
			} else if (width === best) {
				found.push(el);
			}
		}
		return found;
	}

	function wordAt(byte: number): { start: number; end: number; word: string } | null {
		const unit = index.byteToUnit[byte - payloadOffset];
		if (unit === undefined || /\s/.test(index.text[unit])) return null;
		let s = unit;
		let e = unit + 1;
		while (s > 0 && !/\s/.test(index.text[s - 1])) s--;
		while (e < index.text.length && !/\s/.test(index.text[e])) e++;
		return { start: payloadOffset + index.unitToByte[s], end: payloadOffset + index.unitToByte[e], word: index.text.slice(s, e) };
	}

	function highlightBio(start: number, end: number): void {
		if (!canHighlight) return;
		CSS.highlights.delete('pd-bio');
		const s = Math.max(start, payloadOffset) - payloadOffset;
		const e = Math.min(end, frameLength) - payloadOffset;
		if (e <= s) return;
		const unitStart = index.byteToUnit[s];
		const last = index.byteToUnit[e - 1];
		const unitEnd = last + ((index.text.codePointAt(last) ?? 0) > 0xffff ? 2 : 1);
		const ranges: Range[] = [];
		let paragraphStart = 0;
		for (const p of paragraphEls) {
			const node = p.firstChild;
			const length = p.textContent?.length ?? 0;
			const from = Math.max(unitStart, paragraphStart) - paragraphStart;
			const to = Math.min(unitEnd, paragraphStart + length) - paragraphStart;
			if (node && to > from) {
				const r = new Range();
				r.setStart(node, from);
				r.setEnd(node, to);
				ranges.push(r);
			}
			paragraphStart += length + 2; // the "\n\n" between paragraphs
		}
		if (ranges.length) CSS.highlights.set('pd-bio', new Highlight(...ranges));
	}

	function render(): void {
		for (const el of lit) el.classList.remove('is-active');
		lit = [];
		const active = hovered ?? pinned;
		if (canHighlight) CSS.highlights.delete('pd-bio');
		if (!active) {
			if (readout) readout.textContent = readout.dataset.idle ?? readout.textContent;
			return;
		}
		for (let i = active.start; i < active.end; i++) {
			for (const cell of cellsByByte.get(i) ?? []) {
				cell.classList.add('is-active');
				lit.push(cell);
			}
		}
		for (const el of active.fields) {
			// A row inside a collapsed layer can't be seen; light its layer instead.
			const closed = el.closest('details:not([open])');
			const target = closed ? (closed.querySelector('summary') as HTMLElement) : el;
			target.classList.add('is-active');
			lit.push(target);
		}
		highlightBio(active.start, active.end);
		if (readout) {
			const count = active.end - active.start;
			readout.textContent = `Offset 0x${active.start.toString(16).padStart(4, '0')}, ${count} byte${count === 1 ? '' : 's'}: ${active.label}`;
		}
	}

	function selectionForField(el: HTMLElement): Selection {
		return { ...range(el), fields: [el], label: labelOf(el) };
	}

	function selectionForByte(i: number): Selection {
		const owners = fieldsAt(i);
		if (i >= payloadOffset) {
			const word = wordAt(i);
			if (word) return { start: word.start, end: word.end, fields: owners, label: `"${word.word}" in the payload` };
		}
		const r = owners[0] ? range(owners[0]) : { start: i, end: i + 1 };
		return { ...r, fields: owners, label: owners[0] ? labelOf(owners[0]) : `byte ${i}` };
	}

	if (readout) readout.dataset.idle = readout.textContent ?? '';

	for (const el of fields) {
		el.addEventListener('pointerenter', () => {
			hovered = selectionForField(el);
			render();
		});
		el.addEventListener('pointerleave', () => {
			hovered = null;
			render();
		});
		el.addEventListener('focus', () => {
			hovered = selectionForField(el);
			render();
		});
		el.addEventListener('blur', () => {
			hovered = null;
			render();
		});
		if (el.tagName === 'BUTTON') {
			el.addEventListener('click', () => {
				const wasPinned = el.getAttribute('aria-pressed') === 'true';
				fields.forEach((f) => f.setAttribute('aria-pressed', 'false'));
				pinned = wasPinned ? null : selectionForField(el);
				el.setAttribute('aria-pressed', String(!wasPinned));
				render();
			});
		}
	}

	hex.addEventListener('pointerover', (evt) => {
		const cell = (evt.target as HTMLElement).closest<HTMLElement>('[data-i]');
		if (!cell) return;
		hovered = selectionForByte(Number(cell.dataset.i));
		render();
	});
	hex.addEventListener('pointerleave', () => {
		hovered = null;
		render();
	});

	root.addEventListener('keydown', (evt) => {
		if (evt.key !== 'Escape' || !pinned) return;
		pinned = null;
		fields.forEach((f) => f.setAttribute('aria-pressed', 'false'));
		render();
	});
}
