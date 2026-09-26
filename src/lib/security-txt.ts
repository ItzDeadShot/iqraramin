/**
 * Builds /.well-known/security.txt and checks it against the parts of RFC
 * 9116 that can be checked mechanically. Comments (lines starting with "#")
 * are allowed anywhere, which is where the CTF flag lives.
 */

export interface SecurityTxtInput {
	contact: string[];
	expires: Date;
	canonical: string;
	preferredLanguages: string;
	comments: string[];
}

export function buildSecurityTxt(input: SecurityTxtInput): string {
	const lines = [
		...input.comments.map((c) => `# ${c}`),
		...input.contact.map((c) => `Contact: ${c}`),
		`Expires: ${input.expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
		`Preferred-Languages: ${input.preferredLanguages}`,
		`Canonical: ${input.canonical}`,
	];
	return lines.join('\n') + '\n';
}

const KNOWN_FIELDS = ['acknowledgments', 'canonical', 'contact', 'encryption', 'expires', 'hiring', 'policy', 'preferred-languages', 'csaf'];

/** Returns the problems found; an empty array means it passes. */
export function validateSecurityTxt(text: string, now = new Date()): string[] {
	const problems: string[] = [];
	const fields = new Map<string, string[]>();
	text.split('\n').forEach((line, i) => {
		if (line.trim() === '' || line.startsWith('#')) return;
		const m = /^([A-Za-z0-9-]+): (.+)$/.exec(line);
		if (!m) {
			problems.push(`line ${i + 1} is neither a comment nor a "Field: value" line`);
			return;
		}
		const name = m[1].toLowerCase();
		if (!KNOWN_FIELDS.includes(name)) problems.push(`line ${i + 1}: unknown field "${m[1]}"`);
		fields.set(name, [...(fields.get(name) ?? []), m[2].trim()]);
	});

	const contact = fields.get('contact') ?? [];
	if (contact.length === 0) problems.push('Contact is required');
	for (const c of contact) if (!/^(mailto:|https:\/\/|tel:)/.test(c)) problems.push(`Contact must be a mailto:, https:// or tel: URI, got "${c}"`);

	const expires = fields.get('expires') ?? [];
	if (expires.length !== 1) problems.push(`Expires must appear exactly once (found ${expires.length})`);
	else {
		const value = expires[0];
		if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) problems.push(`Expires must be an RFC 3339 UTC timestamp, got "${value}"`);
		const date = new Date(value);
		if (!(date > now)) problems.push('Expires is in the past');
		if (date.getTime() - now.getTime() > 366 * 24 * 3600 * 1000) problems.push('Expires should be less than a year away');
	}

	if ((fields.get('preferred-languages') ?? []).length > 1) problems.push('Preferred-Languages may appear at most once');
	for (const c of fields.get('canonical') ?? []) if (!c.startsWith('https://')) problems.push(`Canonical must be an https:// URI, got "${c}"`);
	return problems;
}
