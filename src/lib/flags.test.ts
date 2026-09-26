import { describe, expect, it } from 'vitest';
import { FLAG_PATTERN, hintViews, looksLikeSecret, matchFlag, normalizeFlag, sha256Hex, type FlagSlot } from './flags';
import { buildSecurityTxt, validateSecurityTxt } from './security-txt';

describe('sha256Hex', () => {
	it('matches the FIPS 180-2 test vectors', async () => {
		expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	});
});

describe('matchFlag', () => {
	const slots = async (): Promise<FlagSlot[]> => [
		{ id: 'a', title: 'A', hash: await sha256Hex('Q{first_flag}'), hints: [] },
		{ id: 'b', title: 'B', hash: await sha256Hex('Q{second_flag}'), hints: [] },
	];

	it('finds the slot whose hash matches', async () => {
		expect((await matchFlag('Q{second_flag}', await slots()))?.id).toBe('b');
	});

	it('forgives whitespace and quotes from copy-paste, but not case', async () => {
		expect((await matchFlag('  "Q{first_flag}"\n', await slots()))?.id).toBe('a');
		expect(await matchFlag('`Q{first_flag}`', await slots())).not.toBeNull();
		expect(await matchFlag('Q{FIRST_FLAG}', await slots())).toBeNull();
	});

	it('rejects near misses', async () => {
		expect(await matchFlag('Q{first_flag', await slots())).toBeNull();
		expect(await matchFlag('q{first_flag}', await slots())).toBeNull();
	});

	it('normalizes only the edges', () => {
		expect(normalizeFlag(" 'Q{a_b}' ")).toBe('Q{a_b}');
	});
});

describe('hintViews', () => {
	const slot: FlagSlot = {
		id: 'x',
		title: 'X',
		hash: '',
		hints: [
			{ after: 0, text: 'vague' },
			{ after: 2, text: 'specific' },
		],
	};

	it('unlocks hints as more flags are found', () => {
		expect(hintViews(slot, 0)).toEqual([{ text: 'vague', locked: false }, { locked: true, remaining: 2 }]);
		expect(hintViews(slot, 1)[1]).toEqual({ locked: true, remaining: 1 });
		expect(hintViews(slot, 2)[1]).toEqual({ text: 'specific', locked: false });
	});
});

describe('flag format and credential lookalikes', () => {
	it('accepts plain lowercase-word flags', () => {
		for (const f of ['Q{robots_txt_is_a_map_not_a_lock}', 'Q{thanks_for_reading_rfc_9116}']) {
			expect(FLAG_PATTERN.test(f)).toBe(true);
			expect(looksLikeSecret(f)).toBe(false);
		}
	});

	it('rejects anything shaped like a real token or key', () => {
		for (const f of [
			'AKIAIOSFODNN7EXAMPLE',
			'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
			'sk-abcdefghijklmnop',
			'xoxb-123-456',
			'-----BEGIN PRIVATE KEY-----',
			'Q{9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08}',
			'Q{aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3}',
		]) {
			expect(looksLikeSecret(f), f).toBe(true);
		}
		expect(FLAG_PATTERN.test('Q{Has_Capitals}')).toBe(false);
	});
});

describe('security.txt', () => {
	const now = new Date('2026-09-26T00:00:00Z');
	const good = buildSecurityTxt({
		contact: ['https://github.com/example'],
		expires: new Date('2027-09-25T00:00:00Z'),
		canonical: 'https://example.github.io/.well-known/security.txt',
		preferredLanguages: 'en',
		comments: ['Q{a_flag_in_a_comment}'],
	});

	it('builds a file that passes the RFC 9116 checks, with the flag only in a comment', () => {
		expect(validateSecurityTxt(good, now)).toEqual([]);
		const flagLines = good.split('\n').filter((l) => l.includes('Q{'));
		expect(flagLines).toEqual(['# Q{a_flag_in_a_comment}']);
	});

	it('flags missing or malformed required fields', () => {
		expect(validateSecurityTxt('Expires: 2027-01-01T00:00:00Z\n', now)).toContain('Contact is required');
		expect(validateSecurityTxt('Contact: https://x.y\n', now)).toContain('Expires must appear exactly once (found 0)');
		expect(validateSecurityTxt('Contact: someone@example.com\nExpires: 2027-01-01T00:00:00Z\n', now)[0]).toMatch(/mailto:/);
		expect(validateSecurityTxt('Contact: https://x.y\nExpires: 2026-01-01T00:00:00Z\n', now)).toContain('Expires is in the past');
		expect(validateSecurityTxt('Contact: https://x.y\nExpires: 2029-01-01T00:00:00Z\n', now)).toContain('Expires should be less than a year away');
		expect(validateSecurityTxt('Contact: https://x.y\nExpires: 2027-01-01T00:00:00Z\nQ{not_a_comment}\n', now)[0]).toMatch(/neither a comment/);
	});
});
