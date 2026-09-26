/**
 * Pure helpers for /whoami ("You are the traffic"). Collection itself lives
 * in collect.ts (it needs the DOM); everything here is deterministic and
 * unit tested.
 *
 * Identifying-power figures are population averages from two published
 * studies, not a measurement of this visitor (this site keeps no data to
 * compare against):
 *  - Eckersley 2010, "How Unique Is Your Web Browser?", PETS, Table 2:
 *    mean surprisal per variable over 470,161 browsers.
 *  - Laperdrix, Rudametkin, Baudry 2016, "Beauty and the Beast", IEEE S&P:
 *    canvas normalized entropy 0.491 over 118,934 fingerprints, i.e.
 *    0.491 * log2(118934) = ~8.3 bits.
 */

export const SOURCES = {
	eckersley: {
		label: 'Eckersley 2010, "How Unique Is Your Web Browser?"',
		url: 'https://coveryourtracks.eff.org/static/browser-uniqueness.pdf',
	},
	amiunique: {
		label: 'Laperdrix et al. 2016, "Beauty and the Beast"',
		url: 'https://hal.science/hal-01285470/document',
	},
} as const;

export type SourceId = keyof typeof SOURCES;

export interface SignalInfo {
	key: string;
	label: string;
	/** Typical identifying power in bits, where a study measured it. */
	bits: number | null;
	/** Plain-language explanation of that figure (or why there isn't one). */
	note: string;
	source: SourceId | null;
}

export const SIGNAL_INFO: SignalInfo[] = [
	{ key: 'userAgent', label: 'User agent', bits: 10.0, note: 'Browser, version and OS in one string.', source: 'eckersley' },
	{
		key: 'clientHints',
		label: 'UA client hints',
		bits: null,
		note: 'The structured, newer form of the user agent; mostly overlaps with it.',
		source: null,
	},
	{
		key: 'language',
		label: 'Languages',
		bits: 6.09,
		note: 'Measured together with the other HTTP Accept headers; language alone is somewhat less.',
		source: 'eckersley',
	},
	{ key: 'timezone', label: 'Time zone', bits: 3.04, note: 'Narrows you to a region.', source: 'eckersley' },
	{
		key: 'screen',
		label: 'Screen and pixel ratio',
		bits: 4.83,
		note: 'Measured as resolution and color depth; pixel ratio adds a little more.',
		source: 'eckersley',
	},
	{ key: 'colorScheme', label: 'Color scheme', bits: null, note: 'Light or dark: at most 1 bit, by definition.', source: null },
	{
		key: 'cpuThreads',
		label: 'CPU threads',
		bits: null,
		note: 'Only a handful of common values, so a few bits at most. Not measured in these studies.',
		source: null,
	},
	{
		key: 'canvas',
		label: 'Canvas rendering',
		bits: 8.3,
		note: 'Tiny differences in how your GPU, drivers and fonts draw the same image.',
		source: 'amiunique',
	},
	{
		key: 'fonts',
		label: 'Installed fonts (short list)',
		bits: null,
		note: 'A full font list measured 13.9 bits (Eckersley); checking a short list like this one reveals far less.',
		source: null,
	},
];

/** Eckersley's measured entropy for the whole fingerprint taken together. */
export const WHOLE_FINGERPRINT_BITS = 18.1;
export const WHOLE_FINGERPRINT_ONE_IN = 286_777;

/** The naive sum of per-signal figures, which overcounts because signals overlap. */
export function naiveBitsSum(infos: SignalInfo[] = SIGNAL_INFO): number {
	return infos.reduce((s, i) => s + (i.bits ?? 0), 0);
}

export function oneIn(bits: number): number {
	return Math.round(2 ** bits);
}

// ------------------------------------------------------------------ fonts

/** Short, cross-platform list. Deliberately excludes this site's own web
 * fonts: naming a font declared with @font-face could trigger a download. */
export const FONT_CANDIDATES = [
	'Arial',
	'Helvetica',
	'Helvetica Neue',
	'Times New Roman',
	'Georgia',
	'Verdana',
	'Tahoma',
	'Trebuchet MS',
	'Courier New',
	'Comic Sans MS',
	'Impact',
	'Palatino',
	'Segoe UI',
	'Calibri',
	'Cambria',
	'Consolas',
	'Menlo',
	'Monaco',
	'Avenir',
	'Futura',
	'Gill Sans',
	'Ubuntu',
	'DejaVu Sans',
	'Liberation Sans',
	'Noto Sans',
	'Roboto',
	'Cantarell',
	'Fira Sans',
];

export const FONT_BASELINES = ['monospace', 'serif', 'sans-serif'] as const;

/**
 * A font is installed if text set in "<font>, <baseline>" measures
 * differently from the baseline alone for any baseline: a missing font
 * falls straight through to the baseline and measures identically.
 */
export function fontDetected(
	baselineWidths: Record<(typeof FONT_BASELINES)[number], number>,
	candidateWidths: Record<(typeof FONT_BASELINES)[number], number>,
): boolean {
	return FONT_BASELINES.some((b) => Math.abs(candidateWidths[b] - baselineWidths[b]) > 0.1);
}

// ------------------------------------------------------------------ record

export interface Signals {
	userAgent: string;
	clientHints: string | null;
	languages: string[];
	timezone: string;
	utcOffsetMinutes: number;
	screen: { width: number; height: number; colorDepth: number; pixelRatio: number };
	colorScheme: 'dark' | 'light';
	cpuThreads: number | null;
	canvasHash: string | null;
	/** True when two identical canvas renders hashed differently. */
	canvasRandomized: boolean;
	fontsDetected: string[];
	fontsChecked: number;
}

export function formatUtcOffset(minutes: number): string {
	const sign = minutes >= 0 ? '+' : '-';
	const abs = Math.abs(minutes);
	return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export interface RecordRow {
	field: string;
	value: string;
	signal: string;
}

/** The visitor, as one flow-log style record. */
export function flowRecord(s: Signals): RecordRow[] {
	return [
		{ field: 'src.user_agent', value: s.userAgent, signal: 'userAgent' },
		{ field: 'src.ua_hints', value: s.clientHints ?? '(not offered by this browser)', signal: 'clientHints' },
		{ field: 'src.languages', value: s.languages.join(', ') || '(none)', signal: 'language' },
		{ field: 'src.timezone', value: `${s.timezone} (${formatUtcOffset(s.utcOffsetMinutes)})`, signal: 'timezone' },
		{
			field: 'src.screen',
			value: `${s.screen.width}x${s.screen.height}, ${s.screen.colorDepth}-bit color, pixel ratio ${s.screen.pixelRatio}`,
			signal: 'screen',
		},
		{ field: 'src.color_scheme', value: s.colorScheme, signal: 'colorScheme' },
		{ field: 'src.cpu_threads', value: s.cpuThreads === null ? '(hidden)' : String(s.cpuThreads), signal: 'cpuThreads' },
		{
			field: 'src.canvas_sha256',
			value: s.canvasHash
				? `${s.canvasHash.slice(0, 16)}...${s.canvasRandomized ? ' (changes on every render: your browser is randomizing it)' : ''}`
				: '(blocked)',
			signal: 'canvas',
		},
		{
			field: 'src.fonts',
			value: `${s.fontsDetected.length} of ${s.fontsChecked} checked: ${s.fontsDetected.join(', ') || 'none detected'}`,
			signal: 'fonts',
		},
	];
}

export interface Verdict {
	label: 'BENIGN';
	rationale: string[];
}

/** Playful, but every reason is drawn from the collected signals. */
export function verdict(s: Signals): Verdict {
	const rationale = ['You asked to be inspected. Malicious traffic rarely volunteers.'];
	if (/HeadlessChrome|PhantomJS|Playwright|puppeteer/i.test(s.userAgent)) {
		rationale.push('Your user agent says headless browser. Hello, test harness; still benign.');
	} else {
		rationale.push('Your user agent looks like an ordinary, interactive browser, not a scanner.');
	}
	if (s.canvasRandomized || s.canvasHash === null) {
		rationale.push('Your browser is resisting canvas fingerprinting. Suspiciously well-behaved.');
	} else if (s.fontsDetected.length > 0) {
		rationale.push(`It renders like a real desktop or phone: a working canvas and ${s.fontsDetected.length} common fonts installed.`);
	}
	return { label: 'BENIGN', rationale };
}
