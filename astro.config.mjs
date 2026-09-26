// @ts-check
import { defineConfig } from 'astro/config';

// The light theme's comment grey (#6E7781) is 4.31:1 on the site's paper
// surface, under WCAG AA; this is the same hue darkened to 5.79:1. Every
// other token color clears AA in both themes.
const readableComments = {
	name: 'site:readable-comments',
	/** @param {{ properties: Record<string, unknown> }} node a token's hast span */
	span(node) {
		const style = node.properties.style;
		if (typeof style === 'string') node.properties.style = style.replace(/color:#6E7781/i, 'color:#59636E');
	},
};

// https://astro.build/config
export default defineConfig({
	site: 'https://itzdeadshot.github.io',
	output: 'static',
	markdown: {
		// Blog code blocks. Shiki colors tokens with inline styles (allowed by
		// the CSP's style-src). Both themes are emitted; global.css switches
		// to the dark one with the site's own light/dark rules.
		shikiConfig: {
			themes: { light: 'github-light-default', dark: 'github-dark-default' },
			transformers: [readableComments],
		},
	},
	vite: {
		build: {
			// Astro inlines any script under this size, and the CSP
			// (script-src 'self', no 'unsafe-inline') would then block it.
			// 0 keeps every script a same-origin file.
			assetsInlineLimit: 0,
		},
	},
});
