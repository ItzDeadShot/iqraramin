/**
 * ATT&CK coverage matrix, computed from the compact ATT&CK data and the
 * site's works (projects + publications). Pure: used at build time for the
 * static page and in the browser when filters change, and unit tested.
 */

export const RELATIONS = ['detects', 'mitigates', 'studies'] as const;
export type Relation = (typeof RELATIONS)[number];

export const WORK_TYPES = ['research', 'engineering', 'tool', 'publication'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export interface AttackData {
	version: string;
	attribution: string;
	trademark: string;
	tactics: { id: string; shortname: string; name: string }[];
	/** [id, name, tactic shortnames] */
	techniques: [string, string, string[]][];
	/** [id, name] */
	subtechniques: [string, string][];
}

export interface WorkLink {
	label: string;
	url: string;
}

export interface Work {
	/** Unique across projects and publications, e.g. "project:federated-ids". */
	key: string;
	title: string;
	type: WorkType;
	year: number;
	links: WorkLink[];
	attack: { id: string; relation: Relation }[];
}

/** One work's claim about one technique (possibly via a sub-technique). */
export interface Coverage {
	workKey: string;
	relation: Relation;
	/** The ID the work actually named: the technique itself or a sub-technique. */
	via: string;
}

export interface Cell {
	id: string;
	name: string;
	coverage: Coverage[];
}

export interface Column {
	tactic: AttackData['tactics'][number];
	cells: Cell[];
}

export interface Filters {
	relations: ReadonlySet<Relation>;
	types: ReadonlySet<WorkType>;
}

export const ALL_FILTERS: Filters = { relations: new Set(RELATIONS), types: new Set(WORK_TYPES) };

export function techniqueIndex(data: AttackData) {
	const techniques = new Map(data.techniques.map(([id, name, tactics]) => [id, { name, tactics }]));
	const subtechniques = new Map(data.subtechniques.map(([id, name]) => [id, name]));
	return {
		isKnown: (id: string) => techniques.has(id) || subtechniques.has(id),
		nameOf: (id: string) => techniques.get(id)?.name ?? subtechniques.get(id),
		techniques,
	};
}

export const parentId = (id: string) => id.split('.')[0];

export function techniqueUrl(id: string): string {
	const [parent, sub] = id.split('.');
	return `https://attack.mitre.org/techniques/${parent}/${sub ? `${sub}/` : ''}`;
}

/** Every covered technique appears in every tactic column it belongs to,
 * as in ATT&CK Navigator; sub-technique claims roll up to the parent cell. */
export function buildMatrix(data: AttackData, works: Work[]): Column[] {
	const index = techniqueIndex(data);
	const coverageByTechnique = new Map<string, Coverage[]>();
	for (const work of works) {
		for (const link of work.attack) {
			if (!index.isKnown(link.id)) {
				throw new Error(`${work.key} links unknown ATT&CK technique "${link.id}" (Enterprise v${data.version})`);
			}
			const parent = parentId(link.id);
			const list = coverageByTechnique.get(parent) ?? [];
			list.push({ workKey: work.key, relation: link.relation, via: link.id });
			coverageByTechnique.set(parent, list);
		}
	}

	return data.tactics.map((tactic) => ({
		tactic,
		cells: data.techniques
			.filter(([, , tactics]) => tactics.includes(tactic.shortname))
			.map(([id, name]) => ({ id, name, coverage: coverageByTechnique.get(id) ?? [] }))
			.sort((a, b) => a.name.localeCompare(b.name)),
	}));
}

export function visibleCoverage(cell: Cell, works: Map<string, Work>, filters: Filters): Coverage[] {
	return cell.coverage.filter((c) => {
		const work = works.get(c.workKey);
		return work !== undefined && filters.relations.has(c.relation) && filters.types.has(work.type);
	});
}

/** Intensity is the number of distinct works, not claims: one paper that
 * both detects and studies a technique is still one work. */
export function workCount(coverage: Coverage[]): number {
	return new Set(coverage.map((c) => c.workKey)).size;
}

export function relationCounts(coverage: Coverage[]): Record<Relation, number> {
	const counts = { detects: 0, mitigates: 0, studies: 0 };
	for (const relation of RELATIONS) {
		counts[relation] = new Set(coverage.filter((c) => c.relation === relation).map((c) => c.workKey)).size;
	}
	return counts;
}

/** 0 = uncovered, then 1, 2, 3+ works. */
export function intensityLevel(count: number): 0 | 1 | 2 | 3 {
	return count >= 3 ? 3 : (count as 0 | 1 | 2);
}
