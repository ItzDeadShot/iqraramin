import { describe, expect, it } from 'vitest';
import { ATTACK } from './data';
import {
	ALL_FILTERS,
	buildMatrix,
	intensityLevel,
	relationCounts,
	techniqueIndex,
	techniqueUrl,
	visibleCoverage,
	workCount,
	type AttackData,
	type Work,
} from './matrix';

const data: AttackData = {
	version: 'test',
	attribution: '',
	trademark: '',
	tactics: [
		{ id: 'TA0001', shortname: 'initial-access', name: 'Initial Access' },
		{ id: 'TA0006', shortname: 'credential-access', name: 'Credential Access' },
	],
	techniques: [
		['T1078', 'Valid Accounts', ['initial-access', 'credential-access']],
		['T1110', 'Brute Force', ['credential-access']],
		['T1190', 'Exploit Public-Facing Application', ['initial-access']],
	],
	subtechniques: [['T1110.001', 'Password Guessing']],
};

const work = (key: string, type: Work['type'], attack: Work['attack']): Work => ({ key, title: key, type, year: 2025, links: [], attack });

describe('buildMatrix', () => {
	const works = [
		work('a', 'research', [{ id: 'T1110.001', relation: 'detects' }]),
		work('b', 'publication', [
			{ id: 'T1110', relation: 'studies' },
			{ id: 'T1078', relation: 'mitigates' },
		]),
	];
	const matrix = buildMatrix(data, works);
	const cell = (tactic: string, id: string) => matrix.find((c) => c.tactic.shortname === tactic)!.cells.find((x) => x.id === id)!;

	it('keeps tactic order and puts each technique under every tactic it belongs to', () => {
		expect(matrix.map((c) => c.tactic.shortname)).toEqual(['initial-access', 'credential-access']);
		expect(cell('initial-access', 'T1078').coverage).toHaveLength(1);
		expect(cell('credential-access', 'T1078').coverage).toHaveLength(1);
	});

	it('rolls sub-technique claims up to the parent, remembering the sub-technique', () => {
		const bruteForce = cell('credential-access', 'T1110');
		expect(bruteForce.coverage).toEqual([
			{ workKey: 'a', relation: 'detects', via: 'T1110.001' },
			{ workKey: 'b', relation: 'studies', via: 'T1110' },
		]);
	});

	it('leaves untouched techniques uncovered', () => {
		expect(cell('initial-access', 'T1190').coverage).toEqual([]);
	});

	it('refuses unknown technique IDs', () => {
		expect(() => buildMatrix(data, [work('x', 'tool', [{ id: 'T9999', relation: 'detects' }])])).toThrow(/x links unknown ATT&CK technique "T9999"/);
	});
});

describe('filters and counts', () => {
	const works = [
		work('a', 'research', [{ id: 'T1110', relation: 'detects' }]),
		work('b', 'publication', [
			{ id: 'T1110', relation: 'detects' },
			{ id: 'T1110.001', relation: 'studies' },
		]),
		work('c', 'tool', [{ id: 'T1110', relation: 'mitigates' }]),
	];
	const byKey = new Map(works.map((w) => [w.key, w]));
	const bruteForce = buildMatrix(data, works)[1].cells.find((c) => c.id === 'T1110')!;

	it('counts distinct works, not claims', () => {
		expect(workCount(bruteForce.coverage)).toBe(3);
		expect(relationCounts(bruteForce.coverage)).toEqual({ detects: 2, mitigates: 1, studies: 1 });
	});

	it('filters by relation and by work type', () => {
		const onlyDetects = visibleCoverage(bruteForce, byKey, { ...ALL_FILTERS, relations: new Set(['detects'] as const) });
		expect(workCount(onlyDetects)).toBe(2);
		const onlyPublications = visibleCoverage(bruteForce, byKey, { ...ALL_FILTERS, types: new Set(['publication'] as const) });
		expect(workCount(onlyPublications)).toBe(1);
		expect(relationCounts(onlyPublications)).toEqual({ detects: 1, mitigates: 0, studies: 1 });
	});

	it('maps counts to intensity levels', () => {
		expect([0, 1, 2, 3, 7].map(intensityLevel)).toEqual([0, 1, 2, 3, 3]);
	});
});

describe('the pinned ATT&CK release', () => {
	const index = techniqueIndex(ATTACK);

	it('has tactics in matrix order and every technique under at least one', () => {
		expect(ATTACK.tactics[0].name).toBe('Reconnaissance');
		expect(ATTACK.tactics.at(-1)!.name).toBe('Impact');
		for (const [id, , tactics] of ATTACK.techniques) expect(tactics.length, id).toBeGreaterThan(0);
	});

	it('knows current IDs and sub-techniques', () => {
		expect(index.nameOf('T1046')).toBe('Network Service Discovery');
		expect(index.isKnown('T1110.001')).toBe(true);
		expect(index.isKnown('T9999')).toBe(false);
	});

	it('builds ATT&CK site URLs for techniques and sub-techniques', () => {
		expect(techniqueUrl('T1046')).toBe('https://attack.mitre.org/techniques/T1046/');
		expect(techniqueUrl('T1110.001')).toBe('https://attack.mitre.org/techniques/T1110/001/');
	});
});
