/**
 * Light/dark theme choice. With no choice stored the site follows the
 * system (prefers-color-scheme in global.css); a choice sets
 * <html data-theme>, which global.css already honours.
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'q-site-theme';

/**
 * Runs inline in <head>, before first paint, so a stored choice never
 * flashes the other theme. The CSP allows exactly this text by its
 * SHA-256 (see BaseLayout), so keep it one line with no surrounding
 * whitespace. data-js lets CSS show the toggle from the first frame.
 */
export const THEME_INIT_SCRIPT = `document.documentElement.dataset.js='';try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

/** CSP source expression ('sha256-...') for an inline script's exact text. */
export async function cspHash(source: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
	return `'sha256-${btoa(String.fromCharCode(...digest))}'`;
}

/**
 * The next state after a toggle. A choice that matches the system is not
 * stored (null), so the site goes back to following the system.
 */
export function nextTheme(current: Theme, system: Theme): { theme: Theme; store: Theme | null } {
	const theme: Theme = current === 'dark' ? 'light' : 'dark';
	return { theme, store: theme === system ? null : theme };
}
