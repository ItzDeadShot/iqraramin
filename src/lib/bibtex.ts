/**
 * A small, strict BibTeX reader for the site's own publications.bib. It
 * covers what that file uses: @type{key, field = {braced} | "quoted" |
 * number, ...}, nested braces, and text outside entries as comments
 * (BibTeX's own rule, so the % lines at the top are fine). @comment and
 * @preamble blocks are skipped. It deliberately rejects @string macros and
 * # concatenation with a clear error rather than half-supporting them.
 * Citation formatting is a separate job (see CLAUDE.md, citation-js).
 */

export interface BibEntry {
	type: string;
	key: string;
	fields: Record<string, string>;
	line: number;
}

export class BibtexError extends Error {
	constructor(message: string, line: number) {
		super(`publications.bib line ${line}: ${message}`);
	}
}

export function parseBibtex(source: string): BibEntry[] {
	const entries: BibEntry[] = [];
	const seen = new Map<string, number>();
	let i = 0;

	const lineAt = (pos: number) => source.slice(0, pos).split('\n').length;
	const skipSpace = () => {
		while (i < source.length && /\s/.test(source[i])) i++;
	};

	function readBraced(): string {
		// source[i] === '{'
		const start = i;
		let depth = 0;
		for (; i < source.length; i++) {
			if (source[i] === '{') depth++;
			else if (source[i] === '}') {
				depth--;
				if (depth === 0) {
					i++;
					return source.slice(start + 1, i - 1);
				}
			}
		}
		throw new BibtexError('unbalanced braces', lineAt(start));
	}

	function readQuoted(): string {
		const start = i;
		i++;
		let depth = 0;
		for (; i < source.length; i++) {
			const ch = source[i];
			if (ch === '{') depth++;
			else if (ch === '}') depth--;
			else if (ch === '"' && depth === 0) {
				i++;
				return source.slice(start + 1, i - 1);
			}
		}
		throw new BibtexError('unterminated quoted value', lineAt(start));
	}

	while (i < source.length) {
		const at = source.indexOf('@', i);
		if (at === -1) break;
		i = at + 1;
		const typeMatch = /^[A-Za-z]+/.exec(source.slice(i));
		if (!typeMatch) throw new BibtexError('expected an entry type after "@"', lineAt(at));
		const type = typeMatch[0].toLowerCase();
		i += type.length;
		skipSpace();
		if (source[i] !== '{' && source[i] !== '(') throw new BibtexError(`expected "{" after @${type}`, lineAt(i));

		if (type === 'comment' || type === 'preamble') {
			if (source[i] === '{') readBraced();
			else i = source.indexOf(')', i) + 1;
			continue;
		}
		if (type === 'string') {
			throw new BibtexError('@string macros are not supported; write the value out in full', lineAt(at));
		}
		if (source[i] === '(') throw new BibtexError('use @type{...} rather than @type(...)', lineAt(i));

		i++; // past "{"
		skipSpace();
		const keyMatch = /^[^,\s}]+/.exec(source.slice(i));
		if (!keyMatch) throw new BibtexError(`@${type} entry has no citation key`, lineAt(i));
		const key = keyMatch[0];
		i += key.length;
		if (seen.has(key)) {
			throw new BibtexError(`duplicate citation key "${key}" (first used on line ${seen.get(key)})`, lineAt(at));
		}
		seen.set(key, lineAt(at));

		const fields: Record<string, string> = {};
		for (;;) {
			skipSpace();
			if (source[i] === ',') {
				i++;
				skipSpace();
			}
			if (source[i] === '}') {
				i++;
				break;
			}
			if (i >= source.length) throw new BibtexError(`entry "${key}" is missing its closing "}"`, lineAt(at));

			const nameMatch = /^[A-Za-z][\w-]*/.exec(source.slice(i));
			if (!nameMatch) throw new BibtexError(`unexpected "${source[i]}" in entry "${key}"`, lineAt(i));
			const name = nameMatch[0].toLowerCase();
			i += name.length;
			skipSpace();
			if (source[i] !== '=') throw new BibtexError(`expected "=" after field "${name}" in "${key}"`, lineAt(i));
			i++;
			skipSpace();

			let value: string;
			if (source[i] === '{') value = readBraced();
			else if (source[i] === '"') value = readQuoted();
			else {
				const num = /^\d+/.exec(source.slice(i));
				if (!num) {
					throw new BibtexError(
						`field "${name}" in "${key}" must be {braced}, "quoted" or a number (macros and # concatenation aren't supported)`,
						lineAt(i),
					);
				}
				value = num[0];
				i += value.length;
			}
			skipSpace();
			if (source[i] === '#') throw new BibtexError(`"#" concatenation isn't supported (field "${name}" in "${key}")`, lineAt(i));
			if (name in fields) throw new BibtexError(`field "${name}" appears twice in "${key}"`, lineAt(i));
			fields[name] = value;
		}

		entries.push({ type, key, fields, line: seen.get(key)! });
	}

	return entries;
}

/** Braces in BibTeX values protect capitalization; for display they go. */
export function cleanValue(value: string): string {
	return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

export interface AttackLinkInput {
	id: string;
	relation: string;
}

/**
 * The custom `attack` field: comma-separated "ID:relation" pairs, e.g.
 * attack = {T1046:detects, T1110.001:studies}. Shape errors fail here;
 * whether the ID exists in ATT&CK is checked by the content schema.
 */
export function parseAttackField(value: string | undefined, key: string): AttackLinkInput[] {
	if (!value || !value.trim()) return [];
	return value.split(',').map((part) => {
		const [id, relation, ...rest] = part.split(':').map((s) => s.trim());
		if (!id || !relation || rest.length) {
			throw new Error(`publications.bib entry "${key}": attack item "${part.trim()}" must look like "T1046:detects"`);
		}
		return { id, relation };
	});
}
