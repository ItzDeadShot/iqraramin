import { describe, expect, it } from 'vitest';
import { buildToc } from './toc';

const h = (depth: number, text: string) => ({ depth, text, slug: text.toLowerCase() });

describe('buildToc', () => {
	it('nests each h3 under the h2 before it', () => {
		expect(buildToc([h(2, 'A'), h(3, 'A1'), h(3, 'A2'), h(2, 'B')])).toEqual([
			{ slug: 'a', text: 'A', children: [{ slug: 'a1', text: 'A1' }, { slug: 'a2', text: 'A2' }] },
			{ slug: 'b', text: 'B', children: [] },
		]);
	});

	it('keeps an h3 that comes before any h2, and drops h4 and deeper', () => {
		expect(buildToc([h(3, 'Intro'), h(2, 'A'), h(4, 'Deep')])).toEqual([
			{ slug: 'intro', text: 'Intro', children: [] },
			{ slug: 'a', text: 'A', children: [] },
		]);
	});
});
