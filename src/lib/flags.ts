/**
 * The site's small capture-the-flag: pure helpers shared by the build (which
 * hashes the flags from src/content/data/flags.yaml) and the /flags page
 * (which only ever sees those hashes, never the plaintext).
 */

export const FLAG_PATTERN = /^Q\{[a-z0-9_]{4,60}\}$/;

export const FLAG_LOCATIONS = ['robots', 'console', 'html-comment', 'security-txt', 'honeypot', 'not-found'] as const;
export type FlagLocation = (typeof FLAG_LOCATIONS)[number];

export interface FlagHint {
	/** Number of flags found before this hint unlocks. */
	after: number;
	text: string;
}

export interface FlagSlot {
	id: string;
	title: string;
	hash: string;
	hints: FlagHint[];
}

/** SHA-256 as lowercase hex via Web Crypto (browsers and Node 22 alike). */
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Forgive surrounding whitespace and quotes/backticks from copy-paste. */
export function normalizeFlag(input: string): string {
	return input.trim().replace(/^[`'"]+|[`'"]+$/g, '').trim();
}

export async function matchFlag(input: string, slots: FlagSlot[]): Promise<FlagSlot | null> {
	const hash = await sha256Hex(normalizeFlag(input));
	return slots.find((s) => s.hash === hash) ?? null;
}

export type HintView = { text: string; locked: false } | { locked: true; remaining: number };

export function hintViews(slot: FlagSlot, foundCount: number): HintView[] {
	return slot.hints.map((h) =>
		foundCount >= h.after ? { text: h.text, locked: false } : { locked: true, remaining: h.after - foundCount },
	);
}

/**
 * Nothing here may look like a real credential: GitHub secret scanning and
 * other scanners would (rightly) flag it. Checks common token prefixes and
 * long high-entropy runs; the flags are plain lowercase words instead.
 */
export function looksLikeSecret(value: string): boolean {
	const prefixes = [/AKIA[0-9A-Z]{8}/, /ASIA[0-9A-Z]{8}/, /gh[pousr]_[A-Za-z0-9]{8}/, /github_pat_/, /glpat-/, /sk-[A-Za-z0-9]{8}/, /xox[abprs]-/, /AIza[0-9A-Za-z_-]{8}/, /-----BEGIN [A-Z ]*KEY-----/];
	if (prefixes.some((re) => re.test(value))) return true;
	if (/[0-9a-f]{32,}/i.test(value)) return true;
	return /[A-Za-z0-9+/=_-]{32,}/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
}
