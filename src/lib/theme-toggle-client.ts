import { THEME_STORAGE_KEY, nextTheme, type Theme } from './theme';

export function initThemeToggle(button: HTMLButtonElement) {
	const root = document.documentElement;
	const media = window.matchMedia('(prefers-color-scheme: dark)');
	const system = (): Theme => (media.matches ? 'dark' : 'light');
	const current = (): Theme => {
		const t = root.dataset.theme;
		return t === 'light' || t === 'dark' ? t : system();
	};

	const sync = () => button.setAttribute('aria-pressed', String(current() === 'dark'));

	button.addEventListener('click', () => {
		const { store } = nextTheme(current(), system());
		if (store) root.dataset.theme = store;
		else delete root.dataset.theme;
		try {
			if (store) localStorage.setItem(THEME_STORAGE_KEY, store);
			else localStorage.removeItem(THEME_STORAGE_KEY);
		} catch {
			// Storage blocked: the choice still applies to this page.
		}
		sync();
	});

	// Following the system: its changes show on the button. Another tab's
	// choice: apply it here too.
	media.addEventListener('change', sync);
	window.addEventListener('storage', (e) => {
		if (e.key !== THEME_STORAGE_KEY) return;
		if (e.newValue === 'light' || e.newValue === 'dark') root.dataset.theme = e.newValue;
		else delete root.dataset.theme;
		sync();
	});

	sync();
}
