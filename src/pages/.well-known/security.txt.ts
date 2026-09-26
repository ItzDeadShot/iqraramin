import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { flagFor } from '../../lib/flag-entries';
import { buildSecurityTxt, validateSecurityTxt } from '../../lib/security-txt';

export const GET: APIRoute = async ({ site }) => {
	const config = await getEntry('site', 'site');
	if (!config) throw new Error('Missing "site" entry in src/content/data/site.yaml');
	const now = new Date();
	// RFC 9116 recommends Expires under a year out; each build refreshes it.
	const expires = new Date(now.getTime() + 364 * 24 * 3600 * 1000);
	expires.setUTCHours(0, 0, 0, 0);
	const text = buildSecurityTxt({
		contact: [config.data.securityContact],
		expires,
		canonical: new URL('/.well-known/security.txt', site).href,
		preferredLanguages: 'en',
		comments: [
			'Security contact for this site, per RFC 9116.',
			'This is a static site with no accounts or user data; reports are still welcome.',
			`Since you read this far: ${await flagFor('security-txt')}`,
		],
	});
	const problems = validateSecurityTxt(text, now);
	if (problems.length) throw new Error(`security.txt is not RFC 9116 compliant: ${problems.join('; ')}`);
	return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
