import type { APIRoute } from 'astro';
import { flagFor } from '../../lib/flag-entries';

// A real same-origin file (not an inline script, which the CSP would block),
// loaded on every page. The only place the "console" flag exists.
export const GET: APIRoute = async () => {
	const flag = await flagFor('console');
	const js = `console.log(
  '%c CASE FILE %c Hello, fellow devtools opener. ${flag}\\nMore flags: /flags',
  'border:2px solid #a8281c;color:#a8281c;font:600 12px monospace;padding:2px 6px',
  'font:12px monospace;padding-left:6px'
);
`;
	return new Response(js, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
};
