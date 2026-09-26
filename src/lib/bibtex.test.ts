import { describe, expect, it } from 'vitest';
import publicationsBib from '../content/data/publications.bib?raw';
import { cleanValue, parseAttackField, parseBibtex } from './bibtex';

describe('parseBibtex', () => {
	it('reads braced, quoted and numeric fields, with nested braces', () => {
		const [entry] = parseBibtex(`
			% a comment line
			@Article{key2025,
			  title = {Robust {FedAvg} for {IDS}},
			  author = "Amin, M. I. and {Doe}, J.",
			  year = 2025,
			}
		`);
		expect(entry.type).toBe('article');
		expect(entry.key).toBe('key2025');
		expect(entry.fields.title).toBe('Robust {FedAvg} for {IDS}');
		expect(cleanValue(entry.fields.title)).toBe('Robust FedAvg for IDS');
		expect(entry.fields.author).toBe('Amin, M. I. and {Doe}, J.');
		expect(entry.fields.year).toBe('2025');
	});

	it('skips @comment blocks and text between entries', () => {
		const entries = parseBibtex('stray text\n@comment{ignore {me}}\n@misc{a, title={A}}\n@misc{b, title={B}}');
		expect(entries.map((e) => e.key)).toEqual(['a', 'b']);
	});

	it('reports the line of a duplicate key', () => {
		expect(() => parseBibtex('@misc{a, title={A}}\n\n@misc{a, title={B}}')).toThrow(/line 3: duplicate citation key "a" \(first used on line 1\)/);
	});

	it('rejects unbalanced braces, macros and concatenation with clear errors', () => {
		expect(() => parseBibtex('@misc{a,\n title={oops}')).toThrow(/missing its closing|unbalanced/);
		expect(() => parseBibtex('@string{jnl = {Journal}}')).toThrow(/@string macros are not supported/);
		expect(() => parseBibtex('@misc{a, journal = jnl}')).toThrow(/macros and # concatenation/);
		expect(() => parseBibtex('@misc{a, title = {A} # {B}}')).toThrow(/concatenation/);
	});

	it("parses the site's real publications.bib", () => {
		const entries = parseBibtex(publicationsBib);
		expect(entries.length).toBeGreaterThan(0);
		for (const e of entries) expect(e.fields.title).toBeTruthy();
	});
});

describe('parseAttackField', () => {
	it('splits "ID:relation" pairs', () => {
		expect(parseAttackField('T1046:detects, T1110.001 : studies', 'k')).toEqual([
			{ id: 'T1046', relation: 'detects' },
			{ id: 'T1110.001', relation: 'studies' },
		]);
	});

	it('is empty when the field is absent', () => {
		expect(parseAttackField(undefined, 'k')).toEqual([]);
	});

	it('rejects items without a relation', () => {
		expect(() => parseAttackField('T1046', 'paper1')).toThrow(/"paper1".*must look like "T1046:detects"/);
	});
});
