import { THEME_INIT_SCRIPT, cspHash } from './theme';

/**
 * The site's Content Security Policy, shared by the <meta> tag in
 * BaseLayout and the real HTTP header in _headers. The header adds
 * frame-ancestors, which browsers ignore when it arrives in a meta tag.
 */
export async function contentSecurityPolicy({ header }: { header: boolean }): Promise<string> {
	return [
		"default-src 'self'",
		// The one inline script (theme, before first paint) is allowed by its
		// exact hash; everything else must be a same-origin file.
		`script-src 'self' ${await cspHash(THEME_INIT_SCRIPT)}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self'",
		"connect-src 'self'",
		"base-uri 'self'",
		"form-action 'self'",
		...(header ? ["frame-ancestors 'none'"] : []),
	].join('; ');
}

/** Cloudflare `_headers` rules: a path pattern and the headers it gets. */
export type HeaderRules = [pattern: string, headers: Record<string, string>][];

export async function headerRules(): Promise<HeaderRules> {
	return [
		[
			'/*',
			{
				'Content-Security-Policy': await contentSecurityPolicy({ header: true }),
				'Strict-Transport-Security': 'max-age=31536000',
				'X-Content-Type-Options': 'nosniff',
				// Older browsers that predate frame-ancestors.
				'X-Frame-Options': 'DENY',
				'Referrer-Policy': 'strict-origin-when-cross-origin',
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
			},
		],
		// Vite puts a content hash in every file name here, so a changed file
		// always gets a new URL and these can be cached for good.
		['/_astro/*', { 'Cache-Control': 'public, max-age=31536000, immutable' }],
	];
}

/** Cloudflare's _headers format: a pattern line, then indented "Name: value" lines. */
export function formatHeadersFile(rules: HeaderRules): string {
	return rules.map(([pattern, headers]) => [pattern, ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`)].join('\n')).join('\n\n') + '\n';
}
