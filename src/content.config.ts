import { defineCollection } from 'astro:content';
import { glob, file, type Loader } from 'astro/loaders';
import { z } from 'astro/zod';
import attackData from './content/data/attack/enterprise.json';
// Imported as text through Vite (no Node fs, no @types/node); editing the
// .bib file invalidates this config and re-runs the loader.
import publicationsBib from './content/data/publications.bib?raw';
import { cleanValue, parseAttackField, parseBibtex } from './lib/bibtex';
import { FLAG_LOCATIONS, FLAG_PATTERN, looksLikeSecret } from './lib/flags';

const ATTACK_IDS = new Set([...attackData.techniques.map((t) => t[0] as string), ...attackData.subtechniques.map((s) => s[0])]);

/** A work's claim about an ATT&CK technique. Unknown, revoked or deprecated
 * IDs fail the build, naming the ID and the pinned ATT&CK version. */
const attackLink = z.object({
	id: z
		.string()
		.regex(/^T\d{4}(\.\d{3})?$/, 'ATT&CK technique IDs look like T1046 or T1110.001')
		.refine((id) => ATTACK_IDS.has(id), {
			error: (issue) =>
				`Unknown ATT&CK technique "${String(issue.input)}": not an active technique or sub-technique in Enterprise ATT&CK v${attackData.version} (typo, or revoked/deprecated?)`,
		}),
	relation: z.enum(['detects', 'mitigates', 'studies']),
});

const projects = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
	schema: z.object({
		title: z.string(),
		type: z.enum(['research', 'engineering', 'tool']),
		status: z.enum(['active', 'completed', 'archived']),
		year: z.number().int(),
		tags: z.array(z.string()).default([]),
		links: z
			.object({
				repo: z.url().optional(),
				paper: z.url().optional(),
				demo: z.url().optional(),
			})
			.default({}),
		featured: z.boolean().default(false),
		summary: z.string(),
		attack: z.array(attackLink).default([]),
	}),
});

/** Loads publications.bib through the site's own small BibTeX reader
 * (src/lib/bibtex.ts); every entry is then validated by the schema below. */
function bibtexLoader(source: string): Loader {
	return {
		name: 'bibtex',
		load: async ({ store, parseData, logger }) => {
			const entries = parseBibtex(source);
			store.clear();
			for (const entry of entries) {
				const f = entry.fields;
				const data = await parseData({
					id: entry.key,
					data: {
						type: entry.type,
						title: cleanValue(f.title ?? ''),
						authors: cleanValue(f.author ?? ''),
						year: Number(f.year),
						venue: cleanValue(f.journal ?? f.booktitle ?? ''),
						doi: f.doi && f.doi !== 'TBD' ? cleanValue(f.doi) : undefined,
						url: f.url ? cleanValue(f.url) : undefined,
						attack: parseAttackField(f.attack, entry.key),
					},
				});
				store.set({ id: entry.key, data });
			}
			logger.info(`Loaded ${entries.length} publications from publications.bib`);
		},
	};
}

const publications = defineCollection({
	loader: bibtexLoader(publicationsBib),
	schema: z.object({
		type: z.string(),
		title: z.string().min(1),
		authors: z.string(),
		year: z.number().int().min(1900).max(2100),
		venue: z.string(),
		doi: z.string().optional(),
		url: z.url().optional(),
		attack: z.array(attackLink).default([]),
	}),
});

const blog = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
	schema: z.object({
		title: z.string(),
		date: z.coerce.date(),
		tags: z.array(z.string()).default([]),
		draft: z.boolean().default(false),
		summary: z.string(),
	}),
});

const certifications = defineCollection({
	loader: file('./src/content/data/certifications.yaml'),
	schema: z.object({
		id: z.string(),
		name: z.string(),
		issuer: z.string(),
		date: z.coerce.date(),
		credentialUrl: z.url().optional(),
	}),
});

const talks = defineCollection({
	loader: file('./src/content/data/talks.yaml'),
	schema: z.object({
		id: z.string(),
		title: z.string(),
		event: z.string(),
		date: z.coerce.date(),
		location: z.string().optional(),
		link: z.url().optional(),
	}),
});

const news = defineCollection({
	loader: file('./src/content/data/news.yaml'),
	schema: z.object({
		id: z.string(),
		date: z.coerce.date(),
		text: z.string(),
		link: z.url().optional(),
	}),
});

const now = defineCollection({
	loader: file('./src/content/data/now.yaml'),
	schema: z.object({
		id: z.string(),
		updated: z.coerce.date(),
		items: z.array(
			z.object({
				category: z.string(),
				text: z.string(),
			}),
		),
	}),
});

const pieces = defineCollection({
	loader: file('./src/content/data/pieces.yaml'),
	schema: z.object({
		id: z.string(),
		title: z.string(),
		toyModelNote: z.string(),
		intro: z.string(),
		explainerTitle: z.string(),
		explainerBody: z.string(),
	}),
});

const site = defineCollection({
	loader: file('./src/content/data/site.yaml'),
	schema: z.object({
		id: z.string(),
		name: z.string(),
		tagline: z.string(),
		wordmark: z.string().min(1),
		wordmarkLatin: z.string().min(1),
		focus: z.array(z.string()).default([]),
		securityContact: z.string().regex(/^(mailto:|https:\/\/|tel:)/, 'security.txt Contact must be a mailto:, https:// or tel: URI'),
	}),
});

const u16 = z.number().int().min(0).max(65535);

const about = defineCollection({
	loader: file('./src/content/data/about.yaml'),
	schema: z.object({
		id: z.string(),
		bio: z.array(z.string().trim().min(1)).min(1),
		packet: z.object({
			ethernet: z.object({
				src: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i, 'MAC must look like de:ad:be:ef:13:37'),
				dst: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i, 'MAC must look like de:ad:be:ef:13:37'),
			}),
			ipv4: z.object({
				src: z.ipv4(),
				dst: z.ipv4(),
				ttl: z.number().int().min(1).max(255),
				identification: u16,
				dscp: z.number().int().min(0).max(63).default(0),
				dontFragment: z.boolean().default(true),
			}),
			tcp: z.object({
				srcPort: u16,
				dstPort: u16,
				seq: z.number().int().min(0).max(0xffffffff),
				ack: z.number().int().min(0).max(0xffffffff),
				flags: z.array(z.enum(['CWR', 'ECE', 'URG', 'ACK', 'PSH', 'RST', 'SYN', 'FIN'])).min(1),
				window: u16,
				urgentPointer: u16.default(0),
			}),
		}),
	}),
});

const flags = defineCollection({
	loader: file('./src/content/data/flags.yaml'),
	schema: z.object({
		id: z.string(),
		location: z.enum(FLAG_LOCATIONS),
		flag: z
			.string()
			.regex(FLAG_PATTERN, 'Flags look like Q{lowercase_words_and_digits}')
			.refine((f) => !looksLikeSecret(f), 'This flag looks like a real credential; scanners would flag it. Use plain words.'),
		title: z.string(),
		hints: z.array(z.object({ after: z.number().int().min(0).max(5), text: z.string() })).min(1),
	}),
});

const copy = defineCollection({
	loader: file('./src/content/data/copy.yaml'),
	schema: z.object({
		id: z.string(),
		title: z.string(),
		lead: z.string(),
		paragraphs: z.array(z.string()).default([]),
		link: z.object({ label: z.string(), url: z.url() }).optional(),
	}),
});

const lab = defineCollection({
	loader: file('./src/content/data/lab.yaml'),
	schema: z.object({
		id: z.string(),
		order: z.number().int(),
		title: z.string(),
		blurb: z.string(),
		href: z.string().startsWith('/', 'Lab links must be site-relative paths'),
	}),
});

export const collections = { projects, publications, blog, certifications, talks, news, now, pieces, site, about, flags, copy, lab };
