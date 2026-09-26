import type { APIRoute } from 'astro';
import { formatHeadersFile, headerRules } from '../lib/csp';

// Builds dist/_headers, the HTTP headers Cloudflare sends for the site.
// Generated rather than hand-written so the CSP (and the theme script's
// hash in it) always matches the <meta> CSP. A route file can't start with
// "_" (Astro ignores those), hence the parameter.
export function getStaticPaths() {
	return [{ params: { headers: '_headers' } }];
}

export const GET: APIRoute = async () => new Response(formatHeadersFile(await headerRules()), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
