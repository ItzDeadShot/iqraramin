import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT, cspHash, nextTheme } from './theme';

describe('nextTheme', () => {
	it('flips the theme', () => {
		expect(nextTheme('light', 'light').theme).toBe('dark');
		expect(nextTheme('dark', 'light').theme).toBe('light');
	});

	it('stores only a choice that differs from the system', () => {
		expect(nextTheme('light', 'light')).toEqual({ theme: 'dark', store: 'dark' });
		expect(nextTheme('dark', 'light')).toEqual({ theme: 'light', store: null });
		expect(nextTheme('dark', 'dark')).toEqual({ theme: 'light', store: 'light' });
		expect(nextTheme('light', 'dark')).toEqual({ theme: 'dark', store: null });
	});
});

describe('cspHash', () => {
	it('is base64 SHA-256 in CSP syntax (known vectors)', async () => {
		expect(await cspHash('')).toBe("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
		expect(await cspHash('abc')).toBe("'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='");
	});

	it('the init script is a single line with no surrounding whitespace', () => {
		expect(THEME_INIT_SCRIPT).toBe(THEME_INIT_SCRIPT.trim());
		expect(THEME_INIT_SCRIPT).not.toContain('\n');
	});
});
