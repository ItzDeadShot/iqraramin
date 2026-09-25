import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

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

export const collections = { projects, blog, certifications, talks, news, now, pieces, site, about };
