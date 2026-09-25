// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://itzdeadshot.github.io',
	output: 'static',
	vite: {
		build: {
			// Astro inlines any script under this size, and the CSP
			// (script-src 'self', no 'unsafe-inline') would then block it.
			// 0 keeps every script a same-origin file.
			assetsInlineLimit: 0,
		},
	},
});
