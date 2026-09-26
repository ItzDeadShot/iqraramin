import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, formatHeadersFile, headerRules } from './csp';
import { THEME_INIT_SCRIPT, cspHash } from './theme';

describe('contentSecurityPolicy', () => {
	it('allows the theme init script by hash, and no other inline script', async () => {
		const csp = await contentSecurityPolicy({ header: false });
		expect(csp).toContain(`script-src 'self' ${await cspHash(THEME_INIT_SCRIPT)}`);
		expect(csp.match(/script-src[^;]*/)![0]).not.toContain('unsafe-inline');
	});

	it('adds frame-ancestors only to the header (ignored in a meta tag)', async () => {
		expect(await contentSecurityPolicy({ header: false })).not.toContain('frame-ancestors');
		expect(await contentSecurityPolicy({ header: true })).toContain("frame-ancestors 'none'");
	});
});

describe('_headers file', () => {
	it('is a pattern line followed by indented headers, rules separated by a blank line', async () => {
		const text = formatHeadersFile(await headerRules());
		const blocks = text.trimEnd().split('\n\n');
		expect(blocks[0].split('\n')[0]).toBe('/*');
		for (const block of blocks) {
			const [pattern, ...lines] = block.split('\n');
			expect(pattern).toMatch(/^\//);
			for (const line of lines) expect(line).toMatch(/^ {2}[A-Za-z-]+: \S/);
		}
		expect(text).toContain("  Content-Security-Policy: default-src 'self';");
		expect(text).toContain('  Strict-Transport-Security: max-age=31536000\n');
	});
});
