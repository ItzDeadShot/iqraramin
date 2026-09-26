import {
	RELATIONS,
	intensityLevel,
	relationCounts,
	visibleCoverage,
	workCount,
	type Coverage,
	type Filters,
	type Relation,
	type Work,
	type WorkType,
} from './matrix';

interface ClientData {
	works: Work[];
	cells: Record<string, { name: string; url: string; tactics: string[]; coverage: Coverage[] }>;
	subNames: Record<string, string>;
}

const LETTER: Record<Relation, string> = { detects: 'D', mitigates: 'M', studies: 'S' };
const TYPE_LABEL: Record<WorkType, string> = { research: 'Research', engineering: 'Engineering', tool: 'Tool', publication: 'Publication' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, text?: string) {
	const node = document.createElement(tag);
	Object.assign(node, props);
	if (text !== undefined) node.textContent = text;
	return node;
}

function badge(relation: Relation, text: string): HTMLSpanElement {
	const b = el('span', { className: 'badge' }, text);
	b.dataset.relation = relation;
	return b;
}

export function initCoverage(root: HTMLElement): void {
	const dataEl = root.querySelector('#cov-data');
	const detail = root.querySelector<HTMLElement>('[data-detail]');
	const summary = root.querySelector<HTMLElement>('[data-summary]');
	if (!dataEl?.textContent || !detail || !summary) return;

	const data = JSON.parse(dataEl.textContent) as ClientData;
	const works = new Map(data.works.map((w) => [w.key, w]));
	const relationInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="cov-relation"]'));
	const typeInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="cov-type"]'));
	const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.cov-cell button'));
	const columns = Array.from(root.querySelectorAll<HTMLElement>('.cov-col'));
	const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>('[data-row]'));
	const emptyDetail = detail.innerHTML;
	let selected: string | null = null;

	root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-requires-js]').forEach((c) => (c.disabled = false));

	const filters = (): Filters => ({
		relations: new Set(relationInputs.filter((i) => i.checked).map((i) => i.value as Relation)),
		types: new Set(typeInputs.filter((i) => i.checked).map((i) => i.value as WorkType)),
	});

	const visibleFor = (id: string, f: Filters) => {
		const cell = data.cells[id];
		return cell ? visibleCoverage({ id, name: cell.name, coverage: cell.coverage }, works, f) : [];
	};

	function renderDetail(id: string | null): void {
		if (!id) {
			detail!.innerHTML = emptyDetail;
			return;
		}
		const cell = data.cells[id];
		const visible = visibleFor(id, filters());
		const meta = el('p', { className: 'detail-meta' }, `${id} · ${cell.tactics.join(', ')} · `);
		meta.append(el('a', { href: cell.url }, 'ATT&CK page'));

		const byWork = new Map<string, Coverage[]>();
		for (const c of visible) byWork.set(c.workKey, [...(byWork.get(c.workKey) ?? []), c]);

		const list = el('ul');
		for (const [key, claims] of byWork) {
			const work = works.get(key)!;
			const li = el('li');
			li.append(el('span', { className: 'work-title' }, work.title));
			const workMeta = el('span', { className: 'work-meta' }, `${TYPE_LABEL[work.type]} · ${work.year}`);
			for (const claim of claims) {
				workMeta.append(badge(claim.relation, LETTER[claim.relation]), el('span', {}, claim.relation));
				if (claim.via !== id) workMeta.append(el('span', {}, `via ${claim.via} ${data.subNames[claim.via] ?? ''}`.trim()));
			}
			li.append(workMeta);
			const links = el('span', { className: 'work-links' });
			if (work.links.length) for (const link of work.links) links.append(el('a', { href: link.url }, link.label));
			else links.append(el('span', {}, 'No public link yet'));
			li.append(links);
			list.append(li);
		}

		detail!.replaceChildren(
			el('h2', {}, cell.name),
			meta,
			byWork.size ? list : el('p', { className: 'cov-detail-empty' }, 'No works match the current filters.'),
		);
	}

	function update(): void {
		const f = filters();
		const coveredIds = new Set<string>();
		const worksShown = new Set<string>();

		for (const button of buttons) {
			const li = button.closest<HTMLElement>('.cov-cell')!;
			const id = li.dataset.technique!;
			const visible = visibleFor(id, f);
			const count = workCount(visible);
			li.dataset.level = String(intensityLevel(count));
			const countEl = li.querySelector('[data-count]');
			if (countEl) countEl.textContent = `${count} ${count === 1 ? 'work' : 'works'}`;
			const counts = relationCounts(visible);
			li.querySelector('[data-badges]')?.replaceChildren(
				...RELATIONS.filter((r) => counts[r] > 0).map((r) => badge(r, `${LETTER[r]}${counts[r]}`)),
			);
			if (count) {
				coveredIds.add(id);
				visible.forEach((c) => worksShown.add(c.workKey));
			}
		}

		let tactics = 0;
		for (const col of columns) {
			const cells = col.querySelectorAll('.cov-cell');
			const covered = Array.from(cells).filter((c) => (c as HTMLElement).dataset.level !== '0').length;
			col.dataset.coveredCount = String(covered);
			const label = col.querySelector('[data-col-count]');
			if (label) label.textContent = `${covered} of ${cells.length}`;
			if (covered) tactics++;
		}

		for (const row of rows) {
			row.hidden = !f.relations.has(row.dataset.relation as Relation) || !f.types.has(row.dataset.type as WorkType);
		}

		summary!.textContent = coveredIds.size
			? `${coveredIds.size} technique${coveredIds.size === 1 ? '' : 's'} across ${tactics} of ${columns.length} tactics, from ${worksShown.size} work${worksShown.size === 1 ? '' : 's'}.`
			: 'No techniques match the current filters.';

		if (selected) renderDetail(selected);
	}

	function select(id: string | null): void {
		selected = id;
		for (const b of buttons) b.setAttribute('aria-pressed', String(b.closest<HTMLElement>('.cov-cell')!.dataset.technique === id));
		renderDetail(id);
	}

	for (const button of buttons) {
		button.addEventListener('click', () => {
			const id = button.closest<HTMLElement>('.cov-cell')!.dataset.technique!;
			select(selected === id ? null : id);
			// Below 900px the panel sits under the matrix; bring it into view.
			if (selected && window.matchMedia('(max-width: 900px)').matches) {
				const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				detail.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
			}
		});
	}
	[...relationInputs, ...typeInputs].forEach((input) => input.addEventListener('change', update));
	root.addEventListener('keydown', (evt) => {
		if (evt.key === 'Escape' && selected) select(null);
	});

	update();
}
