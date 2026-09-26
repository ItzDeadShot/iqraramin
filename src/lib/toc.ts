export interface Heading {
	depth: number;
	slug: string;
	text: string;
}

export interface TocEntry {
	slug: string;
	text: string;
	children: { slug: string; text: string }[];
}

/**
 * A post's h2s, each with the h3s under it. h3s before the first h2 become
 * top-level entries so nothing is dropped; deeper headings are left out.
 */
export function buildToc(headings: Heading[]): TocEntry[] {
	const toc: TocEntry[] = [];
	for (const { depth, slug, text } of headings) {
		if (depth === 2 || (depth === 3 && toc.length === 0)) toc.push({ slug, text, children: [] });
		else if (depth === 3) toc[toc.length - 1].children.push({ slug, text });
	}
	return toc;
}
