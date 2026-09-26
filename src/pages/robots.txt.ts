import type { APIRoute } from 'astro';

// The Disallow path is real: it points at /field-notes/, where the
// "robots" flag lives (see src/content/data/flags.yaml).
export const GET: APIRoute = () =>
	new Response(
		[
			'# Hello, human. Crawlers, please respect the rules below.',
			'User-agent: *',
			'Allow: /',
			'Disallow: /field-notes/',
			'',
		].join('\n'),
		{ headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
	);
